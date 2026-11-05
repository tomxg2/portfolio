import { useRef, useMemo, useEffect, useState, useCallback, Suspense, createRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line, PerformanceMonitor, useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom, GodRays } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { XR } from '@react-three/xr';
import { motion } from 'framer-motion';
import { Code2, Building2, Globe } from 'lucide-react';
import * as THREE from 'three';
import { NODES } from '../data/nodes.js';
import { xrStore } from '../lib/xrStore.js';
import {
  REAL_PLANET_TEXTURES, EARTH_CLOUDS_URL, SATURN_RING_URL, SUN_URL, loadCachedTexture,
} from '../lib/planetTextures.js';
import Cockpit from '../cockpit/Cockpit.jsx';
import { useShipStore } from '../cockpit/useShipStore.js';
import { IS_MOBILE } from '../lib/device.js';

// Adaptive geometry budget — phones get coarser spheres + fewer stars.
const PLANET_SEGS     = IS_MOBILE ? 24 : 40;
const SUN_SEGS        = IS_MOBILE ? 32 : 48;
const ATMO_SEGS       = IS_MOBILE ? 16 : 24;
const STAR_COUNT      = IS_MOBILE ? 220 : 550;
const RING_SEGS       = IS_MOBILE ? 48 : 80;

// ── Seeded RNG — deterministic textures per planet ────────────────────────────
function makeRng(seed) {
  let s = Math.abs(seed) || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Planet texture URLs + cached loader live in lib/planetTextures.js — shared
// with the cockpit's destination holograms.

// Only Earth gets a Fresnel atmosphere — other bodies kept bare so the surface
// texture reads cleanly. Per user preference.
const REAL_PLANET_ATMOSPHERES = {
  earth: { color: '#7cb3ff', intensity: 0.75 }, // Rayleigh-scattered blue
};

// Build a RingGeometry whose UVs run radially (u=0 inner → u=1 outer) so the
// solarsystemscope ring strip wraps as a true radial profile instead of
// streaking around the circumference.
function makeRadialRingGeometry(innerRadius, outerRadius, segments) {
  const geom = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1);
  const pos = geom.attributes.position;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const u = (v3.length() - innerRadius) / (outerRadius - innerRadius);
    geom.attributes.uv.setXY(i, u, 0.5);
  }
  return geom;
}

// ── Nebula sphere — GPU-rendered animated shader (deep field, evolving) ──────
// One inside-out sphere. The fragment shader runs FBM noise on the view ray
// every frame, so clouds drift, fold and breathe in real time. Way more alive
// than a baked canvas texture, ~free on any modern GPU.
//
// A second smaller, additively-blended sphere with a different noise seed
// gives the parallax depth without doubling the shader cost.
const NEBULA_VERT = `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const NEBULA_FRAG = `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3  uColorA; // dominant deep purple-blue
  uniform vec3  uColorB; // steel blue mid
  uniform vec3  uColorC; // dusty rose accent
  uniform vec3  uBg;     // background (sets the floor)
  uniform float uIntensity;

  // ── Hash + noise (cheap, GLSL1-safe) ────────────────────────────────────
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + uSeed);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
                   mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
                   mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Fractal Brownian Motion — 3 octaves keeps mobile iGPUs happy and the
  // visual loss is negligible against the scale we render this sphere at.
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p *= 2.07;
      a *= 0.52;
    }
    return v;
  }

  // Tiny star points sprinkled into the deep field
  float stars(vec3 p) {
    vec3 cell = floor(p * 60.0);
    float h = hash(cell + 7.3);
    float threshold = 0.997;
    if (h < threshold) return 0.0;
    vec3 jitter = (vec3(hash(cell + 1.1), hash(cell + 2.2), hash(cell + 3.3)) - 0.5) / 60.0;
    vec3 starPos = (cell + 0.5) / 60.0 + jitter;
    float d = length(p - starPos);
    return smoothstep(0.0035, 0.0, d) * (0.6 + 0.4 * h);
  }

  void main() {
    // Direction from origin to this fragment (sphere is inside-out, so this
    // is effectively the view ray). Normalising makes the noise solid-angle uniform.
    vec3 dir = normalize(vWorldPos);

    // Slow drift in two axes
    vec3 q = dir * 1.4 + vec3(uTime * 0.012, uTime * 0.006, uTime * 0.009);

    // Single FBM pass — cheap. The dropped curl offset cost 3 extra FBMs.
    float cloud = pow(fbm(q), 1.5);
    cloud = smoothstep(0.05, 0.95, cloud);

    // Pole fade — multiply with vertical falloff so the UV singularity is dark
    float poleFade = 1.0 - smoothstep(0.78, 0.97, abs(dir.y));

    // Three-stop color ramp through the cloud density
    vec3 col = mix(uColorA, uColorB, smoothstep(0.20, 0.60, cloud));
    col = mix(col, uColorC, smoothstep(0.70, 0.95, cloud) * 0.5);
    col *= cloud * poleFade * 0.9;

    // Add stars (mostly visible in low-density / void areas)
    float s = stars(dir + vec3(0.0, uTime * 0.0008, 0.0));
    col += vec3(s * 0.9, s * 0.9, s);

    // Floor — deep navy where the cloud density goes to zero
    col = mix(uBg, col, cloud * poleFade + 0.06);

    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

function Nebula() {
  const ref = useRef();
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: {
      uTime:      { value: 0 },
      uSeed:      { value: 0.42 },
      uColorA:    { value: new THREE.Color('#3a3d75') },
      uColorB:    { value: new THREE.Color('#5570a8') },
      uColorC:    { value: new THREE.Color('#a07090') },
      uBg:        { value: new THREE.Color('#04060e') },
      uIntensity: { value: 1.0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }), []);
  useFrame((_, delta) => {
    mat.uniforms.uTime.value += delta;
    if (ref.current) ref.current.rotation.y += delta * 0.012;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[120, 48, 32]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// ── Shooting stars — periodic comet streaks across the sky ────────────────────
function ShootingStars({ enabled = true }) {
  const [streaks, setStreaks] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let timeoutId;
    const spawn = () => {
      // Random arc — start somewhere in upper hemisphere, fly across the sky
      const startTheta = Math.random() * Math.PI * 2;
      const startPhi   = Math.random() * Math.PI * 0.45 + 0.15;
      const dist       = 70;
      const startPos = new THREE.Vector3(
        dist * Math.sin(startPhi) * Math.cos(startTheta),
        dist * Math.cos(startPhi),
        dist * Math.sin(startPhi) * Math.sin(startTheta)
      );
      // Direction: roughly diagonal across the sky
      const endPos = startPos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 50 - 25,
        -(8 + Math.random() * 12),
        (Math.random() - 0.5) * 50 - 25,
      ));
      const id = Math.random().toString(36).slice(2);
      setStreaks((s) => [...s, { id, startPos, endPos, born: performance.now() }]);
      // Schedule next streak
      timeoutId = setTimeout(spawn, 7000 + Math.random() * 9000);
    };
    timeoutId = setTimeout(spawn, 3000 + Math.random() * 4000);
    return () => clearTimeout(timeoutId);
  }, [enabled]);

  // GC finished streaks every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setStreaks((s) => s.filter((st) => performance.now() - st.born < 2200));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <>{streaks.map((s) => <ShootingStar key={s.id} {...s} />)}</>
  );
}

function ShootingStar({ startPos, endPos, born }) {
  const headRef = useRef();
  const tailRef = useRef();
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const DUR = 1.7; // seconds
  useFrame(() => {
    const t = (performance.now() - born) / 1000 / DUR;
    if (t < 0 || t > 1) {
      if (headRef.current) headRef.current.visible = false;
      if (tailRef.current) tailRef.current.visible = false;
      return;
    }
    // Ease-out: fast start, gentle end
    const e = 1 - Math.pow(1 - t, 2.2);
    tmpPos.lerpVectors(startPos, endPos, e);
    if (headRef.current) {
      headRef.current.visible = true;
      headRef.current.position.copy(tmpPos);
      // Fade in fast, out slow
      const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      headRef.current.material.opacity = Math.max(0, a);
    }
    if (tailRef.current) {
      tailRef.current.visible = true;
      // Tail points back along the trajectory
      const tailStart = tmpPos.clone();
      const tailEnd   = tmpPos.clone().sub(endPos.clone().sub(startPos).normalize().multiplyScalar(3.5));
      tailRef.current.geometry.setFromPoints([tailStart, tailEnd]);
      const a = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      tailRef.current.material.opacity = Math.max(0, a * 0.7);
    }
  });
  return (
    <>
      <mesh ref={headRef}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} toneMapped={false} />
      </mesh>
      <line ref={tailRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#aaddff" transparent opacity={0} toneMapped={false} />
      </line>
    </>
  );
}

// ── Player ship — CC0 fighter (Quaternius) cruising the outer system ──────────
// This is "your" ship: clicking it boards the flight deck, tying the solar
// overview and cockpit mode into one narrative. Hidden while you're inside it.
const SHIP_URL = '/models/player_ship.glb';
const SHIP_ORBIT_R = 27;
const SHIP_ORBIT_SPEED = 0.045;
// Big enough to read as a ship (not a speck) from the home view.
const SHIP_SIZE = 3.4;

function PlayerShip({ onBoard, hideLabel }) {
  const { scene: shipScene } = useGLTF(SHIP_URL);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef();
  const innerRef = useRef();
  const angleRef = useRef(0.4); // start in view of the default camera
  const scaleVec = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const mode = useShipStore((s) => s.mode);

  // Normalize whatever size the GLB comes in at to ~SHIP_SIZE scene units and
  // recentre it, then give the materials the same emissive floor the planets
  // use so the dark side stays readable.
  const ship = useMemo(() => {
    const s = shipScene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    const scale = SHIP_SIZE / Math.max(size.x, size.y, size.z);
    s.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    s.position.sub(center);
    s.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        if (o.material.map) {
          o.material.emissiveMap = o.material.map;
          o.material.emissive = new THREE.Color('#ffffff');
          o.material.emissiveIntensity = 0.22;
        } else if (o.material.color) {
          o.material.emissive = o.material.color.clone();
          o.material.emissiveIntensity = 0.18;
        }
      }
    });
    return s;
  }, [shipScene]);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    angleRef.current += delta * SHIP_ORBIT_SPEED;
    const a = angleRef.current;
    g.position.set(Math.sin(a) * SHIP_ORBIT_R, 2.2, Math.cos(a) * SHIP_ORBIT_R);
    g.rotation.y = a + Math.PI / 2; // nose along the direction of travel
    const inner = innerRef.current;
    if (inner) {
      const t = state.clock.elapsedTime;
      inner.position.y = Math.sin(t * 0.9) * 0.18;   // idle bob
      inner.rotation.z = Math.sin(t * 0.55) * 0.07;  // gentle banking
      scaleVec.setScalar(hovered ? 1.12 : 1);
      inner.scale.lerp(scaleVec, 6 * delta);
    }
  });

  const inSolar = mode === 'solar';

  return (
    <group ref={groupRef} visible={inSolar}>
      <group ref={innerRef}>
        <primitive
          object={ship}
          onClick={(e) => { if (!inSolar) return; e.stopPropagation(); onBoard?.(); }}
          onPointerOver={(e) => { if (!inSolar) return; e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
        />
        {/* generous hit sphere for gestures + easier clicking */}
        <mesh userData={{ nodeId: 'ship' }}
          onClick={(e) => { if (!inSolar) return; e.stopPropagation(); onBoard?.(); }}>
          <sphereGeometry args={[2.4, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Always labelled like the planets so it's discoverable; hover spells out the action */}
        {inSolar && !hideLabel && (
          <group position={[0, -1.8, 0]}>
            <Html center zIndexRange={[9, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <SceneLabel text={hovered ? 'My ship · click to board' : 'My ship'} color="#ffb454" active={hovered} />
            </Html>
          </group>
        )}
      </group>
    </group>
  );
}

useGLTF.preload(SHIP_URL);

// ── Asteroid belt — instanced rock field between Experience and Projects ──────
// One InstancedMesh = one draw call. Rotations/scales are baked at build time;
// only the parent group spins, so the per-frame cost is a single matrix update.
const BELT_COUNT = IS_MOBILE ? 120 : 380;
const BELT_INNER = 12.9;
const BELT_OUTER = 13.9;

// Rocks shrink to nothing as the camera closes in (vertex shader, scaled about
// each rock's own centre), so focus views that park the camera inside or next
// to the belt — Experience in particular — don't fill the frame with boulders.
const BELT_FADE_NEAR = 3.0;
const BELT_FADE_FAR  = 8.0;

function AsteroidBelt() {
  const groupRef = useRef();
  const meshRef = useRef();

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#ffffff', emissive: '#4a4540', emissiveIntensity: 0.22, roughness: 0.92, metalness: 0.05,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 rockCentre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        transformed *= smoothstep(${BELT_FADE_NEAR.toFixed(1)}, ${BELT_FADE_FAR.toFixed(1)}, distance(rockCentre.xyz, cameraPosition));
        #include <project_vertex>
      `);
    };
    return m;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const rng = makeRng(1337);
    for (let i = 0; i < BELT_COUNT; i++) {
      const a = rng() * Math.PI * 2;
      const r = BELT_INNER + rng() * (BELT_OUTER - BELT_INNER);
      dummy.position.set(Math.sin(a) * r, (rng() - 0.5) * 0.5, Math.cos(a) * r);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      // squashed, uneven rocks instead of identical dice
      const k = 0.03 + rng() * 0.075;
      dummy.scale.set(k * (0.7 + rng() * 0.6), k * (0.55 + rng() * 0.4), k * (0.7 + rng() * 0.6));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // warm-grey to dusty-brown spread
      tint.setHSL(0.07 + rng() * 0.04, 0.08 + rng() * 0.14, 0.38 + rng() * 0.22);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[null, null, BELT_COUNT]} material={material}>
        <dodecahedronGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  );
}

// ── Soft glow shell (planet atmospheres + the Sun's corona) ──────────────────
// A sphere `shell`× the body radius, shaded by how close each pixel's sight
// line passes to the body centre (b, in body radii): full strength at the
// limb (b = 1), easing to exactly zero at the shell silhouette (b = shell).
// A plain fresnel term peaks AT the silhouette instead, which cut the glow
// off with a hard visible ring. Over the body's own disc only a thin limb rim
// survives (`core` scales how much bleeds onto the face).
const GLOW_VERT = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;
const GLOW_FRAG = `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uShell;
  uniform float uPower;
  uniform float uCore;
  varying vec3  vNormal;
  varying vec3  vViewDir;
  void main() {
    float d = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float b = sqrt(1.0 - d * d) * uShell;
    float t = clamp((b - 1.0) / (uShell - 1.0), 0.0, 1.0);
    float glow = pow(1.0 - t, uPower) * mix(uCore, 1.0, smoothstep(0.82, 1.0, b));
    gl_FragColor = vec4(uColor, glow * uIntensity);
  }
`;
function makeGlowMaterial({ color, intensity, shell, power, core = 0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor:     { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uShell:     { value: shell },
      uPower:     { value: power },
      uCore:      { value: core },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
}

const RIM_SHELL  = 1.12;
const HALO_SHELL = 1.7;

// Two layers: a tight rim on the limb + a wide soft halo. `baseIntensity`
// scales both — set per planet from REAL_PLANET_ATMOSPHERES. Hover/select
// bumps are small so the atmosphere never drowns the surface texture.
function AtmosphereGlow({ size, color, baseIntensity = 1.0, isHovered, isSelected }) {
  const innerMaterial = useMemo(() => makeGlowMaterial({
    color, intensity: 0.6 * baseIntensity, shell: RIM_SHELL, power: 1.6,
  }), [color, baseIntensity]);
  const outerMaterial = useMemo(() => makeGlowMaterial({
    color, intensity: 0.22 * baseIntensity, shell: HALO_SHELL, power: 2.6,
  }), [color, baseIntensity]);

  useFrame((_, delta) => {
    const targetInner = (isSelected ? 1.0 : isHovered ? 0.8 : 0.6) * baseIntensity;
    const targetOuter = (isSelected ? 0.4 : isHovered ? 0.32 : 0.22) * baseIntensity;
    innerMaterial.uniforms.uIntensity.value +=
      (targetInner - innerMaterial.uniforms.uIntensity.value) * 6 * delta;
    outerMaterial.uniforms.uIntensity.value +=
      (targetOuter - outerMaterial.uniforms.uIntensity.value) * 6 * delta;
  });

  return (
    <>
      <mesh scale={RIM_SHELL}>
        <sphereGeometry args={[size, ATMO_SEGS, ATMO_SEGS]} />
        <primitive object={innerMaterial} attach="material" />
      </mesh>
      <mesh scale={HALO_SHELL}>
        <sphereGeometry args={[size, ATMO_SEGS, ATMO_SEGS]} />
        <primitive object={outerMaterial} attach="material" />
      </mesh>
    </>
  );
}

// ── Starfield ─────────────────────────────────────────────────────────────────
function Stars({ count = 900 }) {
  const geomRef = useRef();
  const { initialPos, workPos, offsets, colors } = useMemo(() => {
    const initialPos = new Float32Array(count * 3);
    const workPos    = new Float32Array(count * 3);
    const offsets    = new Float32Array(count * 3);
    const colors     = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0.88, 0.90, 0.96),
      new THREE.Color(0.88, 0.90, 0.96),
      new THREE.Color(0.88, 0.90, 0.96),
      new THREE.Color(0.70, 0.80, 1.00),
      new THREE.Color(1.00, 0.93, 0.72),
    ];
    for (let i = 0; i < count; i++) {
      const r     = 38 + Math.random() * 55;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      initialPos[i*3]=workPos[i*3]=x; initialPos[i*3+1]=workPos[i*3+1]=y; initialPos[i*3+2]=workPos[i*3+2]=z;
      offsets[i*3]=Math.random()*Math.PI*2; offsets[i*3+1]=Math.random()*Math.PI*2; offsets[i*3+2]=Math.random()*Math.PI*2;
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
    }
    return { initialPos, workPos, offsets, colors };
  }, [count]);

  // Drift is very slow (t * 0.05) — updating every 2nd frame is visually
  // identical but halves the 900-star CPU loop.
  const frameSkip = useRef(false);
  useFrame((state) => {
    frameSkip.current = !frameSkip.current;
    if (frameSkip.current) return;
    const t = state.clock.elapsedTime * 0.05;
    for (let i = 0; i < count; i++) {
      workPos[i*3]   = initialPos[i*3]   + Math.sin(t + offsets[i*3])   * 0.28;
      workPos[i*3+1] = initialPos[i*3+1] + Math.cos(t + offsets[i*3+1]) * 0.28;
      workPos[i*3+2] = initialPos[i*3+2] + Math.sin(t + offsets[i*3+2]) * 0.22;
    }
    if (geomRef.current) { geomRef.current.attributes.position.array.set(workPos); geomRef.current.attributes.position.needsUpdate = true; }
  });

  return (
    <points>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[workPos, 3]} />
        <bufferAttribute attach="attributes-color"    args={[colors,  3]} />
      </bufferGeometry>
      <pointsMaterial size={0.055} vertexColors sizeAttenuation transparent opacity={0.55} />
    </points>
  );
}

// ── Orbital ring ──────────────────────────────────────────────────────────────
// Two-pass: bright thin core + wider soft glow underneath, both colored to
// match the orbiting planet so the path reads against the nebula.
// Kept faint at rest so six saturated circles don't compete with the planets;
// a hovered planet's ring lifts to trace its path (not once focused — up
// close the bright line just slices across the planet).
function OrbitalRing({ radius, color, highlight }) {
  const points = useMemo(() => {
    const n = 192;
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius);
    });
  }, [radius]);
  return (
    <>
      {/* Soft glow */}
      <Line points={points} color={color} lineWidth={3} transparent opacity={highlight ? 0.10 : 0.04} depthWrite={false} />
      {/* Core */}
      <Line points={points} color={color} lineWidth={0.8} transparent opacity={highlight ? 0.42 : 0.17} depthWrite={false} />
    </>
  );
}

// ── Sun ───────────────────────────────────────────────────────────────────────
const CORONA_SHELL = 2.1;
const CORONA_BASE  = 0.6;

function Sun({ node, isSelected, isHovered, onClick, onHover, hideLabel, dimLabel, onMeshReady, bodyRef, occluders }) {
  const meshRef  = bodyRef;

  const { size } = node;
  const FIRE = '#ffaa33'; // warm amber used for all glow/corona

  // Real photographic Sun surface (Solar System Scope, CC-BY 4.0).
  const sunTexture = useMemo(() => loadCachedTexture(SUN_URL), []);

  const coronaMaterial = useMemo(() => makeGlowMaterial({
    color: FIRE, intensity: CORONA_BASE, shell: CORONA_SHELL, power: 2.6,
  }), []);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.05;
    const target = isHovered || isSelected ? CORONA_BASE * 1.4 : CORONA_BASE;
    coronaMaterial.uniforms.uIntensity.value +=
      (target - coronaMaterial.uniforms.uIntensity.value) * 4 * delta;
  });

  return (
    <group>
      {/* Corona — soft glow fading out to nothing at CORONA_SHELL× the radius */}
      <mesh scale={CORONA_SHELL}>
        <sphereGeometry args={[size, ATMO_SEGS, ATMO_SEGS]} />
        <primitive object={coronaMaterial} attach="material" />
      </mesh>
      {/* Sun surface — real photographic granulation, self-emissive via
          emissiveMap so the texture itself drives the bloom-fed glow. */}
      <mesh ref={(m) => { meshRef.current = m; if (m && onMeshReady) onMeshReady(m); }} userData={{ nodeId: node.id }}
        onClick={(e) => { e.stopPropagation(); onClick(node); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(node.id); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = 'default'; }}>
        <sphereGeometry args={[size, SUN_SEGS, SUN_SEGS]} />
        <meshBasicMaterial
          map={sunTexture}
          color="#ffffff"
          toneMapped={false}
        />
      </mesh>
      {/* Invisible hit sphere */}
      <mesh userData={{ nodeId: node.id }}>
        <sphereGeometry args={[Math.max(size * 2.5, 1.0), 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <pointLight color="#ffcc88" intensity={5.5} distance={65} decay={1.5} />
      {!hideLabel && (
        <BodyLabel text={node.label} offsetY={-(size + 0.9)} color={FIRE}
          isSelected={false} isHovered={false} weight={isSelected ? 700 : 500}
          occluders={occluders} dimmed={dimLabel} />
      )}
    </group>
  );
}

// ── Moon — small rocky companion orbiting a parent planet ─────────────────────
function Moon({ parentSize }) {
  const groupRef = useRef();
  const meshRef  = useRef();
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const tilt = useMemo(() => Math.PI / 7, []);
  const orbitR = parentSize * 1.9;
  // cratered Mercury art, self-lit like the planets — untextured and lit only
  // by the far-off Sun it read as a flat grey disc whenever it passed in front
  const texture = useMemo(() => loadCachedTexture(REAL_PLANET_TEXTURES.mercury), []);
  useFrame((_, delta) => {
    angleRef.current += delta * 0.55;
    const x = Math.sin(angleRef.current) * orbitR;
    const z = Math.cos(angleRef.current) * orbitR;
    if (groupRef.current) {
      groupRef.current.position.set(x, Math.sin(angleRef.current) * 0.15, z);
    }
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.3;
  });
  return (
    <group ref={groupRef} rotation={[tilt, 0, 0]}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[parentSize * 0.18, 24, 24]} />
        <meshStandardMaterial map={texture} color="#d8d2c8" emissive="#ffffff" emissiveMap={texture}
          emissiveIntensity={0.35} roughness={0.95} metalness={0.02} />
      </mesh>
    </group>
  );
}

// ── Body label ────────────────────────────────────────────────────────────────
// HTML labels always draw on top of the canvas, so without help a label on the
// far side of the system bleeds through the Sun or a zoomed-in planet. Each
// label raycasts against the OTHER bodies' surface meshes (`occluders`; its own
// body is excluded — from above, the ray to a label hung below a planet passes
// through that planet) and fades out while hidden. `dimmed` fades it too —
// used to declutter everything except the focused planet.
function BodyLabel({ text, offsetY, color, isHovered, isSelected, occluders, dimmed, weight }) {
  const [occluded, setOccluded] = useState(false);
  const hidden = occluded || dimmed;
  return (
    <group position={[0, offsetY, 0]}>
      <Html center zIndexRange={[9, 0]} occlude={occluders} onOcclude={setOccluded}
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <SceneLabel text={text} color={color} active={isSelected || isHovered}
          weight={weight ?? (isSelected ? 600 : 500)} hidden={hidden} />
      </Html>
    </group>
  );
}

// Shared look for every in-scene label (planets, Sun, ship): readable Inter
// text with the body's colour carried by a small dot, instead of 10px
// coloured browser-default monospace.
function SceneLabel({ text, color, active, weight = 500, hidden = false }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      color: active ? '#fff' : 'rgba(229,231,235,0.82)',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '12px',
      fontWeight: weight,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      textShadow: '0 1px 3px #000, 0 0 10px rgba(0,0,0,0.9)',
      opacity: hidden ? 0 : 1,
      transition: 'color 0.2s ease, opacity 0.25s ease',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 9999, background: color, flexShrink: 0,
        boxShadow: `0 0 ${active ? 8 : 4}px ${color}`,
      }} />
      {text}
    </span>
  );
}

// ── Planet ────────────────────────────────────────────────────────────────────
function Planet({ node, isSelected, isHovered, onClick, onHover, hideLabel, dimLabel, onPositionUpdate, onProjectSelect, bodyRef, occluders }) {
  const viewportWidth = useThree((state) => state.size.width);
  const groupRef = useRef();
  const meshRef  = bodyRef;
  const cloudRef = useRef();
  const angleRef = useRef(node.orbitOffset);
  const scaleVec = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  // Real planet surface texture — Solar System Scope 2K JPEG, cached globally.
  const texture = useMemo(() => {
    const url = REAL_PLANET_TEXTURES[node.realPlanet];
    return url ? loadCachedTexture(url) : null;
  }, [node.realPlanet]);

  // Earth-style cloud overlay — only for `realPlanet === 'earth'`. The .jpg is
  // grayscale (white = cloud, black = clear sky) so the same texture drives
  // both color and alpha, giving us free-floating clouds with no extra asset.
  const cloudTexture = useMemo(
    () => node.realPlanet === 'earth' ? loadCachedTexture(EARTH_CLOUDS_URL) : null,
    [node.realPlanet]
  );

  // Real Saturn ring strip + matching radial UV ring geometry. Sized to the
  // planet so it scales with the rest of the scene.
  const ringTexture = useMemo(
    () => node.hasRing ? loadCachedTexture(SATURN_RING_URL) : null,
    [node.hasRing]
  );
  const ringGeometry = useMemo(
    () => node.hasRing ? makeRadialRingGeometry(node.size * 1.35, node.size * 2.6, RING_SEGS) : null,
    [node.hasRing, node.size]
  );

  // Material params per planet kind — drives roughness/metalness so gas giants
  // look soft and rocky bodies catch the sunlight crisply.
  const materialParams = useMemo(() => {
    switch (node.realPlanet) {
      case 'mercury': return { roughness: 0.95, metalness: 0.05 };
      case 'venus':   return { roughness: 0.80, metalness: 0.00 };
      case 'earth':   return { roughness: 0.65, metalness: 0.05 };
      case 'mars':    return { roughness: 0.95, metalness: 0.02 };
      case 'saturn':  return { roughness: 0.85, metalness: 0.00 };
      case 'neptune': return { roughness: 0.78, metalness: 0.00 };
      default:        return { roughness: 0.85, metalness: 0.02 };
    }
  }, [node.realPlanet]);

  // Compute tangent direction (perpendicular to orbit radius) when selection state changes
  // This gives us the "screen left/right" direction for positioning the floating signs
  const isHub   = node.content?.type === 'projects_hub';
  const showSigns = isSelected && isHub && !IS_MOBILE && viewportWidth >= 768;

  const signTangent = useMemo(() => ({
    x: Math.cos(angleRef.current),
    z: -Math.sin(angleRef.current),
  }), [showSigns]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    if (!isSelected) angleRef.current += node.orbitSpeed * delta;
    const x = Math.sin(angleRef.current) * node.orbitRadius;
    const z = Math.cos(angleRef.current) * node.orbitRadius;
    if (groupRef.current) groupRef.current.position.set(x, 0, z);
    if (meshRef.current)  meshRef.current.rotation.y += delta * 0.18;
    // Clouds rotate slightly faster than the surface for parallax
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.26;
    scaleVec.setScalar(isSelected ? 1.14 : isHovered ? 1.07 : 1.0);
    if (groupRef.current) groupRef.current.scale.lerp(scaleVec, 6 * delta);
    onPositionUpdate(node.id, x, z);
  });

  const { color, size } = node;

  return (
    <group ref={groupRef}>
      {/* Per-planet realistic atmosphere — skipped entirely for airless bodies (Mercury). */}
      {REAL_PLANET_ATMOSPHERES[node.realPlanet] && (
        <AtmosphereGlow
          size={size}
          color={REAL_PLANET_ATMOSPHERES[node.realPlanet].color}
          baseIntensity={REAL_PLANET_ATMOSPHERES[node.realPlanet].intensity}
          isHovered={isHovered}
          isSelected={isSelected}
        />
      )}

      {/* Saturn-style rings — real solarsystemscope ring strip mapped radially.
          Steeper tilt (≈45°) shows the disc face-on instead of edge-on so the
          ring reads as the prominent feature it is. Two stacked passes: the
          base ring + a warm-tinted additive layer that pumps brightness without
          shifting the band detail. `toneMapped={false}` keeps it from being
          dimmed by ACES. */}
      {node.hasRing && ringTexture && ringGeometry && (
        <group rotation={[Math.PI / 4, 0, 0.4]}>
          <mesh geometry={ringGeometry}>
            <meshBasicMaterial
              map={ringTexture}
              alphaMap={ringTexture}
              transparent
              opacity={1.0}
              side={THREE.DoubleSide}
              depthWrite={false}
              alphaTest={0.01}
              toneMapped={false}
            />
          </mesh>
          {/* Warm highlight pass — additive, gives the ring an actual sunlit pop */}
          <mesh geometry={ringGeometry}>
            <meshBasicMaterial
              map={ringTexture}
              alphaMap={ringTexture}
              color="#ffe7b3"
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {/* Planet sphere — color stays white so the real photographic texture
          drives the surface look. Emissive is a faint tint of the node color
          to keep selection feedback readable on the dark side without killing
          the realism. */}
      <mesh ref={meshRef} userData={{ nodeId: node.id }}
        onClick={(e)       => { e.stopPropagation(); onClick(node); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(node.id); document.body.style.cursor = 'pointer'; }}
        onPointerOut={()   => { onHover(null); document.body.style.cursor = 'default'; }}>
        <sphereGeometry args={[size, PLANET_SEGS, PLANET_SEGS]} />
        <meshStandardMaterial
          color="#ffffff"
          map={texture}
          emissive="#ffffff"
          emissiveMap={texture}
          emissiveIntensity={isSelected ? 0.85 : isHovered ? 0.65 : 0.45}
          roughness={materialParams.roughness}
          metalness={materialParams.metalness}
        />
      </mesh>

      {/* Moon — currently for the Skills gas giant */}
      {node.id === 'skills' && <Moon parentSize={size} />}

      {/* Real Earth cloud layer — grayscale .jpg used as both map and alphaMap
          so bright = cloud, dark = transparent. Rotates faster than the surface
          for cheap parallax. */}
      {cloudTexture && (
        <mesh ref={cloudRef} scale={1.012}>
          <sphereGeometry args={[size, PLANET_SEGS, PLANET_SEGS]} />
          <meshStandardMaterial
            map={cloudTexture}
            alphaMap={cloudTexture}
            color="#ffffff"
            transparent
            opacity={0.9}
            depthWrite={false}
            roughness={1}
            metalness={0}
          />
        </mesh>
      )}
      {/* Invisible hit sphere — larger target area for gesture control */}
      <mesh userData={{ nodeId: node.id }}>
        <sphereGeometry args={[Math.max(size * 2.5, 1.0), 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Label below planet — hidden behind other bodies, dimmed when another planet has focus */}
      {!hideLabel && (
        <BodyLabel
          text={node.label}
          offsetY={-(size + 0.52)}
          color={color}
          isHovered={isHovered}
          isSelected={isSelected}
          occluders={occluders}
          dimmed={dimLabel}
        />
      )}

      {/* Floating mission signs — only for Projects hub when zoomed in */}
      {showSigns && onProjectSelect && (
        <>
          {/* Invisible gesture hit spheres for Personal / Work
              onClick is required so R3F registers them in the raycast —
              without it onPointerMissed fires and deselects the hub */}
          <mesh position={[-signTangent.x * 2.4, 0.35, -signTangent.z * 2.4]}
            userData={{ nodeId: 'proj_personal' }}
            onClick={(e) => { e.stopPropagation(); onProjectSelect('personal'); }}>
            <sphereGeometry args={[0.9, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh position={[signTangent.x * 2.4, 0.35, signTangent.z * 2.4]}
            userData={{ nodeId: 'proj_work' }}
            onClick={(e) => { e.stopPropagation(); onProjectSelect('work'); }}>
            <sphereGeometry args={[0.9, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>

          <ProjectSign side={-1} tangent={signTangent} delay={0.05} tint="lg-tint-purple" color="#c4b5fd"
            Icon={Code2} title="Personal" caption="Side projects" onSelect={() => onProjectSelect('personal')} />
          <ProjectSign side={1} tangent={signTangent} delay={0.12} tint="lg-tint-blue" color="#93c5fd"
            Icon={Building2} title="Work" caption="Swisscom apps" onSelect={() => onProjectSelect('work')} />
        </>
      )}
    </group>
  );
}

// Floating Personal / Work sign beside the Projects planet (desktop only —
// phones get the 2D buttons App renders instead).
function ProjectSign({ side, tangent, delay, tint, color, Icon, title, caption, onSelect }) {
  return (
    <group position={[side * tangent.x * 2.4, 0.35, side * tangent.z * 2.4]}>
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'auto' }}>
        <motion.button
          className={`lg-surface lg-card ${tint} flex flex-col items-center gap-1 min-w-[136px] px-6 py-3.5 cursor-pointer`}
          initial={{ opacity: 0, scale: 0.75, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', delay, stiffness: 380, damping: 28 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.96 }}
          onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); onSelect(); }}
        >
          <Icon size={20} strokeWidth={1.75} color={color} />
          <span className="text-[14px] font-semibold tracking-tight" style={{ color }}>{title}</span>
          <span className="text-[11px] text-gray-400">{caption}</span>
        </motion.button>
      </Html>
    </group>
  );
}

// ── Camera framing ────────────────────────────────────────────────────────────
// Home view: close enough that the system (outer orbit 23.5, ship 27) fills
// most of a landscape frame. Narrow/portrait screens back off proportionally.
// Looking slightly below the Sun lifts the system clear of the hero text + HUD.
const HOME_CAM  = new THREE.Vector3(0, 19, 43);
const HOME_LOOK = new THREE.Vector3(0, -2.5, 0);
// Portrait screens also tilt toward top-down: the system is width-limited
// there, and a flat 24° view squeezed every orbit into a thin band where the
// labels piled on top of each other. Landscape framing is unchanged.
const HOME_DIST = HOME_CAM.length();
const HOME_ELEV = Math.atan2(HOME_CAM.y, HOME_CAM.z);
// The taller ellipse also reaches further down the screen, so portrait aims
// lower too — lifting the system clear of the hero text.
const portraitBlend = (aspect) => Math.min(1, Math.max(0, (1 - aspect) / 0.5));
function homeCameraPos(aspect, out = new THREE.Vector3()) {
  const framingScale = Math.max(1, 1.3 / Math.max(aspect, 0.25));
  const elev = HOME_ELEV + portraitBlend(aspect) * 0.32;
  return out.set(0, Math.sin(elev), Math.cos(elev)).multiplyScalar(HOME_DIST * framingScale);
}
function homeCameraLook(aspect, out = new THREE.Vector3()) {
  return out.copy(HOME_LOOK).setY(HOME_LOOK.y - portraitBlend(aspect) * 7.5);
}

// Focus view: distance scales with the body (a fixed distance made Skills fill
// the screen and the small rocky planets look far away). Approach from the
// side rather than straight from outside the orbit — head-on, the Sun sat
// directly behind the planet and its bloom flooded the card. A negative angle
// puts the Sun on the LEFT of the frame, away from the content panel.
// Inner planets swing further round (up to ~72°): at a small angle the Sun
// sits only a few units behind them and its disc + corona overlapped the
// planet (Contact, Skills). Outer planets keep the gentle 0.5 rad.
function focusSideAngle(node) {
  const inner = Math.min(1, Math.max(0, (13 - node.orbitRadius) / 9));
  return -(0.5 + 0.75 * inner);
}
const _up = new THREE.Vector3(0, 1, 0);
// The Sun is viewed from well above the ecliptic: from a low angle the camera
// sat outside Contact's orbit (r 4), so that planet swept across the Sun every
// ~12s. At ~43°, aimed a little above the Sun, the near side of its orbit
// falls below the frame.
const SUN_FOCUS_ELEV = 0.75;
const SUN_FOCUS_AIM_Y = 1.0;
function focusDistance(node) {
  if (node.isSun) return 7.4;
  const r = node.size * (node.hasRing ? 1.6 : 1);
  return (r * 2.9 + 2.4) * (IS_MOBILE ? 1.45 : 1);
}

// While a content card is open on wide screens, shift the projection centre
// so the focused body sits in the free area left of the 440px panel instead
// of hiding behind it. setViewOffset keeps raycasts + <Html> projection in
// sync because both go through the camera's projection matrix.
const CARD_PANEL_PX = 452; // max-w-[440px] + 12px gutter (NodeCard)
function CardViewOffset({ active }) {
  const camera = useThree((s) => s.camera);
  const size   = useThree((s) => s.size);
  const cur    = useRef(0);
  useFrame((_, delta) => {
    const target = active && size.width >= 768 ? CARD_PANEL_PX / 2 : 0;
    cur.current += (target - cur.current) * Math.min(1, delta * 5);
    if (target === 0 && Math.abs(cur.current) < 0.5) {
      cur.current = 0;
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    camera.setViewOffset(size.width, size.height, cur.current, 0, size.width, size.height);
  });
  return null;
}

// ── Camera controller ─────────────────────────────────────────────────────────
function CameraController({ selectedId, posRef, orbitRef }) {
  const { camera } = useThree();
  const size       = useThree((s) => s.size);
  // undefined ≠ null: the first frame always frames the home view, so coming
  // back from the cockpit glides out instead of starting at the ship's seat
  const prevRef    = useRef(undefined);
  const aspectRef  = useRef(null);
  const animating  = useRef(false);
  const targetPos  = useRef(new THREE.Vector3(0, 12, 24));
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));
  const tmpDir      = useMemo(() => new THREE.Vector3(), []);
  const nodeMap     = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n])), []);

  useFrame((_, delta) => {
    const aspect = size.width / size.height;
    if (selectedId !== prevRef.current || (!selectedId && aspect !== aspectRef.current)) {
      prevRef.current = selectedId;
      aspectRef.current = aspect;
      const node = selectedId && nodeMap[selectedId];
      if (node) {
        const p    = posRef.current[selectedId] || { x: 0, y: 0, z: 0 };
        const dist = focusDistance(node);
        if (node.isSun) {
          targetPos.current.set(0, Math.sin(SUN_FOCUS_ELEV) * dist, Math.cos(SUN_FOCUS_ELEV) * dist);
          targetLook.current.set(0, SUN_FOCUS_AIM_Y, 0);
        } else {
          tmpDir.set(p.x, 0, p.z).normalize().applyAxisAngle(_up, focusSideAngle(node));
          targetPos.current.set(p.x + tmpDir.x * dist, p.y + dist * 0.36, p.z + tmpDir.z * dist);
          targetLook.current.set(p.x, p.y, p.z);
        }
      } else {
        homeCameraPos(size.width / size.height, targetPos.current);
        homeCameraLook(size.width / size.height, targetLook.current);
      }
      animating.current = true;
      if (orbitRef.current) orbitRef.current.enabled = false;
    }

    if (!animating.current) return;
    camera.position.lerp(targetPos.current, delta * 5.0);
    if (orbitRef.current) { orbitRef.current.target.lerp(targetLook.current, delta * 5.0); orbitRef.current.update(); }
    if (camera.position.distanceTo(targetPos.current) < 0.12) {
      camera.position.copy(targetPos.current);
      animating.current = false;
      if (orbitRef.current) { orbitRef.current.target.copy(targetLook.current); orbitRef.current.enabled = true; orbitRef.current.update(); }
    }
  });

  return null;
}

// ── Gesture camera ────────────────────────────────────────────────────────────
function GestureCamera({ gestureDataRef }) {
  const { camera } = useThree();
  const tgt         = useRef(new THREE.Vector3(0, 12, 24));
  const orbitR      = useRef(24);   // current orbit radius
  const prevTwoHand = useRef(null); // previous two-hand distance

  useFrame(() => {
    const data = gestureDataRef?.current;
    if (!data) return;
    const { pointerNorm, twoHandDist } = data;
    // ── Two-hand zoom: spread / close both hands ────────────────────────────
    // REGRAB_DIST: when hands are this close together we treat it as a
    // "reset / regrab" — zoom is frozen and the reference updates silently.
    // The user can then spread again from that position to continue zooming.
    const REGRAB_DIST = 0.20;

    if (twoHandDist != null) {
      if (prevTwoHand.current != null && twoHandDist > REGRAB_DIST) {
        const delta = twoHandDist - prevTwoHand.current;
        // Deadzone: ignore tiny noise fluctuations
        if (Math.abs(delta) > 0.004) {
          orbitR.current = Math.max(6, Math.min(52, orbitR.current - delta * 30));
        }
      }
      // Always keep prev in sync — even inside regrab zone — so the next
      // spread starts from the correct reference and doesn't snap.
      prevTwoHand.current = twoHandDist;
      const pos = camera.position;
      const dir = pos.clone().normalize();
      tgt.current.copy(dir.multiplyScalar(orbitR.current));
      camera.position.lerp(tgt.current, 0.12);
      camera.lookAt(0, 0, 0);
      return;
    }
    prevTwoHand.current = null;

    // ── Navigate: point finger to orbit ────────────────────────────────────
    if (!pointerNorm) return;
    const cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const sx  = (cl(pointerNorm.x, 0.08, 0.92) - 0.08) / 0.84;
    const sy  = (cl(pointerNorm.y, 0.08, 0.92) - 0.08) / 0.84;
    const az  = (sx - 0.5) * Math.PI * 0.75;  // horizontal: ±67.5°
    const el  = (sy - 0.5) * -Math.PI * 0.5;  // vertical:   ±45° (was ±18°)
    const R   = orbitR.current;
    tgt.current.set(R * Math.sin(az) * Math.cos(el), 12 + R * Math.sin(el), R * Math.cos(az) * Math.cos(el));
    camera.position.lerp(tgt.current, 0.08);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// ── Gesture raycaster + dwell ─────────────────────────────────────────────────
const DWELL_MS = 1200;
const MOVE_THRESHOLD = 0.08;
const MISS_GRACE = 8; // frames we tolerate the ray briefly missing before resetting

function GestureRaycaster({ gestureDataRef, gesture, onHover, onSelect, onDwellProgress, allowedNodeIds }) {
  const { camera, scene } = useThree();
  // Use a dedicated raycaster — avoids conflicts with RFR's internal event raycaster
  const rc          = useRef(new THREE.Raycaster());
  const dwellNode   = useRef(null);
  const dwellStart  = useRef(null);
  const dwellOrigin = useRef(null);
  const cooldown    = useRef(false);
  const missCount   = useRef(0);

  useFrame(() => {
    const pointerNorm = gestureDataRef?.current?.pointerNorm ?? null;
    if (!pointerNorm) {
      onHover(null); onDwellProgress(0);
      dwellNode.current = dwellStart.current = dwellOrigin.current = null;
      missCount.current = 0;
      return;
    }

    // Ensure camera matrices are current before raycasting
    camera.updateMatrixWorld();
    rc.current.setFromCamera(
      { x: (pointerNorm.x * 2) - 1, y: -(pointerNorm.y * 2) + 1 },
      camera
    );
    const hits   = rc.current.intersectObjects(scene.children, true);
    const hit    = hits.find((h) => {
      const id = h.object.userData?.nodeId;
      if (!id) return false;
      if (allowedNodeIds && !allowedNodeIds.includes(id)) return false;
      return true;
    });
    const nodeId = hit?.object.userData.nodeId ?? null;

    // Palm clears dwell — deselect is handled by SceneContent's useEffect
    if (gesture === 'palm') {
      onHover(nodeId);
      dwellNode.current = dwellStart.current = dwellOrigin.current = null;
      missCount.current = 0;
      onDwellProgress(0);
      return;
    }

    // Hand moved significantly — restart dwell
    const handMoved = dwellOrigin.current && (
      Math.abs(pointerNorm.x - dwellOrigin.current.x) > MOVE_THRESHOLD ||
      Math.abs(pointerNorm.y - dwellOrigin.current.y) > MOVE_THRESHOLD
    );
    if (handMoved) {
      dwellNode.current   = nodeId;
      dwellStart.current  = nodeId && !cooldown.current ? performance.now() : null;
      dwellOrigin.current = nodeId ? { x: pointerNorm.x, y: pointerNorm.y } : null;
      onDwellProgress(0);
      missCount.current = 0;
      onHover(nodeId);
      return;
    }

    // Ray briefly missed (camera shift) — grace period keeps dwell alive
    if (!nodeId && dwellNode.current) {
      missCount.current++;
      onHover(dwellNode.current); // keep highlight during grace
      if (missCount.current <= MISS_GRACE) {
        if (dwellStart.current && !cooldown.current) {
          const p = Math.min((performance.now() - dwellStart.current) / DWELL_MS, 1);
          onDwellProgress(p);
          if (p >= 1) {
            onSelect(dwellNode.current); onDwellProgress(0);
            cooldown.current = true;
            dwellNode.current = dwellStart.current = dwellOrigin.current = null;
            missCount.current = 0;
            setTimeout(() => { cooldown.current = false; }, 1500);
          }
        }
        return;
      }
      // Too many misses — give up
      onHover(null); onDwellProgress(0);
      dwellNode.current = dwellStart.current = dwellOrigin.current = null;
      missCount.current = 0;
      return;
    }

    missCount.current = 0;
    onHover(nodeId);

    // New node hit — start dwell
    if (nodeId !== dwellNode.current) {
      dwellNode.current   = nodeId;
      dwellStart.current  = nodeId && !cooldown.current ? performance.now() : null;
      dwellOrigin.current = nodeId ? { x: pointerNorm.x, y: pointerNorm.y } : null;
      onDwellProgress(0);
      return;
    }

    // Same node, hand still — advance dwell
    if (nodeId && dwellStart.current && !cooldown.current) {
      const p = Math.min((performance.now() - dwellStart.current) / DWELL_MS, 1);
      onDwellProgress(p);
      if (p >= 1) {
        onSelect(nodeId); onDwellProgress(0);
        cooldown.current = true;
        dwellNode.current = dwellStart.current = dwellOrigin.current = null;
        setTimeout(() => { cooldown.current = false; }, 1500);
      }
    }
  });
  return null;
}

// ── Fallback + loader ─────────────────────────────────────────────────────────
function WebGLFallback() {
  return (
    <div role="status" className="flex items-center justify-center h-full text-center p-8">
      <div><Globe size={42} strokeWidth={1.5} className="mb-4 mx-auto text-gray-400" />
        <h2 className="text-xl font-semibold text-white mb-2">3D preview unavailable</h2>
        <p className="text-gray-400 text-sm">Your browser could not start the 3D scene.</p>
      </div>
    </div>
  );
}
function SceneLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-brand-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-brand-teal border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-500 font-mono">Launching solar system…</p>
      </div>
    </div>
  );
}

// ── Scene content ─────────────────────────────────────────────────────────────
function SceneContent({ onNodeSelect, onPlanetSelect, onProjectSelect, onEnterCockpit, selectedPlanetId,
  gestureMode, gestureDataRef, gesture, onDwellProgress, cardOpen, onSunReady }) {
  const viewportSize = useThree((state) => state.size);
  const [hoveredId, setHoveredId] = useState(null);
  const selectedId = selectedPlanetId; // controlled externally by App
  const orbitRef = useRef();
  const posRef   = useRef({});
  const nodeMap  = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n])), []);
  const mode     = useShipStore((s) => s.mode);

  useEffect(() => { posRef.current['about'] = { x: 0, y: 0, z: 0 }; }, []);

  // dev-only: scripts/snap.mjs pins the orbit camera through this so solar-view
  // snapshots don't depend on how far auto-rotate drifted during page load
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__orbit = orbitRef;
    window.__homeCam = () => ({ pos: homeCameraPos(window.innerWidth / window.innerHeight).toArray(), look: homeCameraLook(window.innerWidth / window.innerHeight).toArray() });
    return () => { delete window.__orbit; delete window.__homeCam; };
  }, []);

  // Auto-rotate idle behavior: pause on interaction, resume after 5s idle.
  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls) return;
    let resumeTimer = null;
    const onStart = () => {
      controls.autoRotate = false;
      if (resumeTimer) clearTimeout(resumeTimer);
    };
    const onEnd = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (controls && !selectedId) controls.autoRotate = true;
      }, 5000);
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [selectedId]);

  // Pause auto-rotate while a planet is selected (camera does its own animation).
  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls) return;
    if (selectedId) controls.autoRotate = false;
  }, [selectedId]);

  const handlePositionUpdate = useCallback((id, x, z) => {
    posRef.current[id] = { x, y: 0, z };
  }, []);

  const handleSelect = useCallback((node) => {
    onPlanetSelect(node.id);
    // Projects hub: signs appear in 3D, no card opens
    if (node.content?.type !== 'projects_hub') {
      onNodeSelect(node);
    }
  }, [onPlanetSelect, onNodeSelect]);

  const handleGestureSelect = useCallback((nodeId) => {
    if (nodeId === 'proj_personal') { onProjectSelect?.('personal'); return; }
    if (nodeId === 'proj_work')     { onProjectSelect?.('work');     return; }
    if (nodeId === 'ship')          { onEnterCockpit?.();            return; }
    const node = nodeMap[nodeId];
    if (node) handleSelect(node);
  }, [nodeMap, handleSelect, onProjectSelect, onEnterCockpit]);


  const sunNode     = NODES.find((n) => n.isSun);
  const planetNodes = NODES.filter((n) => !n.isSun);

  // Surface-mesh ref per body; each label occludes against every body but its own.
  const bodyRefs = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, createRef()])), []);
  const occludersFor = useMemo(() => Object.fromEntries(NODES.map((n) => [
    n.id, NODES.filter((m) => m.id !== n.id).map((m) => bodyRefs[m.id]),
  ])), [bodyRefs]);
  const labelsHidden = cardOpen || mode !== 'solar';

  return (
    <>
      {/* Soft fill from above — gives planets sculpted shading instead of pure sun-side glare */}
      <ambientLight intensity={0.22} />
      <hemisphereLight color="#88aaff" groundColor="#221133" intensity={0.45} />
      <Nebula />
      <Stars count={STAR_COUNT} />
      <AsteroidBelt />
      <Suspense fallback={null}>
        <PlayerShip onBoard={onEnterCockpit} hideLabel={labelsHidden || !!selectedId} />
      </Suspense>
      {!IS_MOBILE && <ShootingStars />}

      {planetNodes.map((n) => (
        <OrbitalRing key={`ring-${n.id}`} radius={n.orbitRadius} color={n.color}
          highlight={hoveredId === n.id && selectedId !== n.id} />
      ))}

      {sunNode && (
        <Sun node={sunNode} isSelected={selectedId === sunNode.id} isHovered={hoveredId === sunNode.id}
          onClick={handleSelect} onHover={setHoveredId} hideLabel={labelsHidden}
          dimLabel={!!selectedId && selectedId !== sunNode.id}
          bodyRef={bodyRefs[sunNode.id]} occluders={occludersFor[sunNode.id]}
          onMeshReady={onSunReady} />
      )}

      {planetNodes.map((n) => (
        <Planet key={n.id} node={n}
          isSelected={selectedId === n.id} isHovered={hoveredId === n.id}
          onClick={handleSelect} onHover={setHoveredId}
          hideLabel={labelsHidden}
          dimLabel={!!selectedId && selectedId !== n.id}
          bodyRef={bodyRefs[n.id]} occluders={occludersFor[n.id]}
          onPositionUpdate={handlePositionUpdate}
          onProjectSelect={n.content?.type === 'projects_hub' ? onProjectSelect : undefined}
        />
      ))}

      <CardViewOffset active={cardOpen} />

      <Cockpit posRef={posRef} onEngage={handleSelect} />

      {mode === 'solar' && (
        <CameraController selectedId={selectedId} posRef={posRef} orbitRef={orbitRef} />
      )}

      <OrbitControls ref={orbitRef} enablePan={false} enableZoom zoomSpeed={0.7} rotateSpeed={0.45}
        minDistance={3} maxDistance={Math.max(70, homeCameraPos(viewportSize.width / viewportSize.height).length() + 15)} enabled={mode === 'solar' && !gestureMode} makeDefault
        autoRotate={mode === 'solar'} autoRotateSpeed={0.35} />

      {gestureMode && mode === 'solar' && !cardOpen && !selectedId && <GestureCamera gestureDataRef={gestureDataRef} />}
      {gestureMode && mode === 'solar' && !cardOpen && (
        <GestureRaycaster gestureDataRef={gestureDataRef} gesture={gesture}
          onHover={setHoveredId} onSelect={handleGestureSelect} onDwellProgress={onDwellProgress}
          allowedNodeIds={selectedId === 'projects' ? ['proj_personal', 'proj_work'] : null} />
      )}
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export default function Scene3D({ onNodeSelect, onPlanetSelect, onProjectSelect, onEnterCockpit, onDeselect, selectedPlanetId, gestureMode, gestureDataRef, gesture, onDwellProgress, cardOpen, onUnavailable }) {
  const [webglSupported, setWebglSupported] = useState(null);
  const [ready, setReady] = useState(false);
  // Adaptive resolution: start at native DPR (capped at 2). If the GPU can't
  // hold the framerate (weak work laptops), PerformanceMonitor steps the
  // render resolution down in 0.25 steps (floor 1) and back up when there's
  // headroom. Visually invisible on capable machines, a big win on iGPUs.
  const maxDpr = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    return Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2);
  }, []);
  const initialCam = useMemo(() => (typeof window === 'undefined'
    ? HOME_CAM.toArray()
    : homeCameraPos(window.innerWidth / window.innerHeight).toArray()), []);
  const [dpr, setDpr] = useState(maxDpr);
  // Pause rendering when the tab is hidden — saves battery + heat.
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );
  // Sun mesh ref lifted up so the GodRays effect can target it.
  const [sunMesh, setSunMesh] = useState(null);
  // God rays are an exterior effect: inside the cockpit their screen-space
  // streaks smear across the dashboard monitor, so they only run in solar mode.
  const shipMode = useShipStore((s) => s.mode);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    let supported = false;
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2');
      supported = !!context;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { supported = false; }
    setWebglSupported(supported);
    if (!supported) onUnavailable?.();
  }, [onUnavailable]);

  if (webglSupported === null) return <SceneLoader />;
  if (!webglSupported) return <WebGLFallback />;

  return (
    <div className="w-full h-full relative">
      {!ready && <SceneLoader />}
      <Canvas camera={{ position: initialCam, fov: 55 }} style={{ background: 'transparent' }}
        dpr={dpr} frameloop={visible ? 'always' : 'never'}
        gl={{ antialias: !IS_MOBILE, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          // Filmic tonemapping — richer colors, prevents bloom from blowing out
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.92;
          setReady(true);
        }}
        onPointerMissed={() => onDeselect?.()}>
        <PerformanceMonitor
          flipflops={4}
          onDecline={() => setDpr((d) => Math.max(1, +(d - 0.25).toFixed(2)))}
          onIncline={() => setDpr((d) => Math.min(maxDpr, +(d + 0.25).toFixed(2)))}
        >
          <XR store={xrStore}>
            <SceneContent onNodeSelect={onNodeSelect} onPlanetSelect={onPlanetSelect} onProjectSelect={onProjectSelect}
              onEnterCockpit={onEnterCockpit}
              selectedPlanetId={selectedPlanetId} gestureMode={gestureMode} gestureDataRef={gestureDataRef}
              gesture={gesture} onDwellProgress={onDwellProgress} cardOpen={cardOpen}
              onSunReady={setSunMesh} />
          </XR>
          {/* Postprocessing: bloom + god rays. Skipped on mobile. */}
          {!IS_MOBILE && (
            <EffectComposer disableNormalPass multisampling={0}>
              {sunMesh && shipMode === 'solar' && (
                <GodRays
                  sun={sunMesh}
                  blendFunction={BlendFunction.SCREEN}
                  samples={40}
                  density={0.70}
                  decay={0.96}
                  weight={0.14}
                  exposure={0.22}
                  clampMax={0.55}
                  blur
                />
              )}
              <Bloom
                intensity={0.6}
                luminanceThreshold={0.62}
                luminanceSmoothing={0.22}
                mipmapBlur
                radius={0.78}
              />
            </EffectComposer>
          )}
        </PerformanceMonitor>
      </Canvas>
    </div>
  );
}
