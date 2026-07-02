import { useRef, useMemo, useEffect, useState, useCallback, Suspense } from 'react';
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

const IS_MOBILE = typeof window !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as "Macintosh" — detect via multi-touch
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

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
  earth: { color: '#7cb3ff', intensity: 1.05 }, // Rayleigh-scattered blue
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

function PlayerShip({ onBoard }) {
  const { scene: shipScene } = useGLTF(SHIP_URL);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef();
  const innerRef = useRef();
  const angleRef = useRef(0.4); // start in view of the default camera
  const scaleVec = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const mode = useShipStore((s) => s.mode);

  // Normalize whatever size the GLB comes in at to ~2.6 scene units and
  // recentre it, then give the materials the same emissive floor the planets
  // use so the dark side stays readable.
  const ship = useMemo(() => {
    const s = shipScene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2.6 / Math.max(size.x, size.y, size.z);
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
          <sphereGeometry args={[2.0, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {hovered && inSolar && (
          <group position={[0, -1.5, 0]}>
            <Html center zIndexRange={[9, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <span style={{
                color: '#ffb454', fontSize: '10px', fontFamily: 'monospace',
                whiteSpace: 'nowrap', letterSpacing: '0.08em',
                textShadow: '0 1px 4px #000, 0 0 10px #000',
              }}>MY SHIP · CLICK TO BOARD</span>
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

function AsteroidBelt() {
  const groupRef = useRef();
  const meshRef = useRef();

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const rng = makeRng(1337);
    for (let i = 0; i < BELT_COUNT; i++) {
      const a = rng() * Math.PI * 2;
      const r = BELT_INNER + rng() * (BELT_OUTER - BELT_INNER);
      dummy.position.set(Math.sin(a) * r, (rng() - 0.5) * 0.5, Math.cos(a) * r);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.setScalar(0.03 + rng() * 0.075);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[null, null, BELT_COUNT]}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#9a9187" emissive="#6a635b" emissiveIntensity={0.18} roughness={0.95} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}

// ── Fresnel atmosphere glow (two layers: tight rim + wide soft halo) ──────────
// `baseIntensity` scales both layers — set per planet from REAL_PLANET_ATMOSPHERES.
// Hover/select bumps are small so the atmosphere never drowns the surface texture.
function AtmosphereGlow({ size, color, baseIntensity = 1.0, isHovered, isSelected }) {
  // Inner tight rim — sharp falloff, sits right on the planet limb
  const innerMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor:     { value: new THREE.Color(color) },
      uIntensity: { value: 0.7 * baseIntensity },
      uPower:     { value: 3.2 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal   = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir  = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3  vNormal;
      varying vec3  vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), uPower);
        gl_FragColor  = vec4(uColor * 1.6, fresnel * uIntensity);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    side:        THREE.FrontSide,
  }), [color, baseIntensity]);

  // Outer wide halo — gentle falloff, extends ~2x planet radius into space
  const outerMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor:     { value: new THREE.Color(color) },
      uIntensity: { value: 0.28 * baseIntensity },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal   = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir  = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uIntensity;
      varying vec3  vNormal;
      varying vec3  vViewDir;
      void main() {
        // Wider, gentler falloff — reads as scattered light, not a rim
        float f = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 1.8);
        gl_FragColor = vec4(uColor * 1.1, f * uIntensity * 0.7);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    side:        THREE.FrontSide,
  }), [color, baseIntensity]);

  useFrame((_, delta) => {
    // Subtle hover/select bumps — atmosphere stays restrained so the surface
    // texture remains the focal point (per user feedback).
    const targetInner = (isSelected ? 1.4 : isHovered ? 1.1 : 0.7) * baseIntensity;
    const targetOuter = (isSelected ? 0.55 : isHovered ? 0.40 : 0.28) * baseIntensity;
    innerMaterial.uniforms.uIntensity.value +=
      (targetInner - innerMaterial.uniforms.uIntensity.value) * 6 * delta;
    outerMaterial.uniforms.uIntensity.value +=
      (targetOuter - outerMaterial.uniforms.uIntensity.value) * 6 * delta;
  });

  return (
    <>
      {/* Tight rim — sits just above the planet limb */}
      <mesh scale={1.14}>
        <sphereGeometry args={[size, ATMO_SEGS, ATMO_SEGS]} />
        <primitive object={innerMaterial} attach="material" />
      </mesh>
      {/* Wide soft halo — scattered-light feel, much tighter than before */}
      <mesh scale={1.45}>
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
function OrbitalRing({ radius, color }) {
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
      <Line points={points} color={color} lineWidth={3} transparent opacity={0.10} depthWrite={false} />
      {/* Bright core */}
      <Line points={points} color={color} lineWidth={0.8} transparent opacity={0.32} depthWrite={false} />
    </>
  );
}

// ── Sun ───────────────────────────────────────────────────────────────────────
function Sun({ node, isSelected, isHovered, onClick, onHover, hideLabel, onMeshReady }) {
  const meshRef  = useRef();

  const { size } = node;
  const FIRE = '#ffaa33'; // warm amber used for all glow/corona

  // Real photographic Sun surface (Solar System Scope, CC-BY 4.0).
  const sunTexture = useMemo(() => loadCachedTexture(SUN_URL), []);

  const coronaMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor:     { value: new THREE.Color(FIRE) },
      uIntensity: { value: 1.2 },
    },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor; uniform float uIntensity;
      varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        float f = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.8);
        gl_FragColor = vec4(uColor * 1.4, f * uIntensity);
      }
    `,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  }), []);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.05;
    const target = isHovered || isSelected ? 1.8 : 1.2;
    coronaMaterial.uniforms.uIntensity.value +=
      (target - coronaMaterial.uniforms.uIntensity.value) * 4 * delta;
  });

  return (
    <group>
      {/* Fresnel corona — tight, subtle glow around the sun limb */}
      <mesh scale={1.45}>
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
        <group position={[0, -(size + 0.9), 0]}>
          <Html center zIndexRange={[9, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <span style={{
              color: FIRE,
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              letterSpacing: '0.06em',
              fontWeight: isSelected ? 700 : 500,
              textShadow: '0 1px 4px #000, 0 0 10px #000',
            }}>{node.label}</span>
          </Html>
        </group>
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
        <sphereGeometry args={[parentSize * 0.18, 16, 16]} />
        <meshStandardMaterial color="#c8c2b8" roughness={0.95} metalness={0.02} />
      </mesh>
    </group>
  );
}

// ── Distance-aware planet label ───────────────────────────────────────────────
// Smoothly fades the label based on camera distance to the planet so that
// labels in the foreground stay legible while distant labels recede instead
// of overlapping each other in a wall of text.
function PlanetLabel({ node, size, color, isHovered, isSelected }) {
  return (
    <group position={[0, -(size + 0.52), 0]}>
      <Html center zIndexRange={[9, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <span style={{
          color: isSelected || isHovered ? '#fff' : color,
          fontSize: '10px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          letterSpacing: '0.06em',
          fontWeight: isSelected ? 600 : 400,
          textShadow: '0 1px 6px #000, 0 0 12px #000',
          transition: 'color 0.2s ease',
        }}>
          {node.label}
        </span>
      </Html>
    </group>
  );
}

// ── Planet ────────────────────────────────────────────────────────────────────
function Planet({ node, isSelected, isHovered, onClick, onHover, hideLabel, onPositionUpdate, onProjectSelect }) {
  const groupRef = useRef();
  const meshRef  = useRef();
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
  const showSigns = isSelected && isHub && !IS_MOBILE;

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

      {/* Label below planet — distance-faded via direct DOM ref */}
      {!hideLabel && (
        <PlanetLabel
          node={node}
          size={size}
          color={color}
          isHovered={isHovered}
          isSelected={isSelected}
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

          {/* Personal sign — tangent left */}
          <group position={[-signTangent.x * 2.4, 0.35, -signTangent.z * 2.4]}>
            <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'auto' }}>
              <motion.button
                className="lg-surface lg-card lg-tint-purple"
                initial={{ opacity: 0, scale: 0.75, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', delay: 0.05, stiffness: 380, damping: 28 }}
                whileHover={{ scale: 1.07 }}
                whileTap={{ scale: 0.96 }}
                onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); onProjectSelect('personal'); }}
                style={{
                  padding: '14px 22px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '5px',
                  minWidth: '130px',
                }}
              >
                <Code2 size={22} strokeWidth={1.75} color="#c4b5fd" />
                <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em' }}>Personal</span>
                <span style={{ color: 'rgba(196,181,253,0.55)', fontFamily: 'monospace', fontSize: '10px' }}>Side projects</span>
              </motion.button>
            </Html>
          </group>

          {/* Work sign — tangent right */}
          <group position={[signTangent.x * 2.4, 0.35, signTangent.z * 2.4]}>
            <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'auto' }}>
              <motion.button
                className="lg-surface lg-card lg-tint-blue"
                initial={{ opacity: 0, scale: 0.75, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', delay: 0.12, stiffness: 380, damping: 28 }}
                whileHover={{ scale: 1.07 }}
                whileTap={{ scale: 0.96 }}
                onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); e.nativeEvent?.stopPropagation(); onProjectSelect('work'); }}
                style={{
                  padding: '14px 22px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '5px',
                  minWidth: '130px',
                }}
              >
                <Building2 size={22} strokeWidth={1.75} color="#93c5fd" />
                <span style={{ color: '#93c5fd', fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em' }}>Work</span>
                <span style={{ color: 'rgba(147,197,253,0.55)', fontFamily: 'monospace', fontSize: '10px' }}>Swisscom apps</span>
              </motion.button>
            </Html>
          </group>
        </>
      )}
    </group>
  );
}

// ── Camera controller ─────────────────────────────────────────────────────────
function CameraController({ selectedId, posRef, orbitRef }) {
  const { camera } = useThree();
  const prevRef    = useRef(null);
  const animating  = useRef(false);
  const targetPos  = useRef(new THREE.Vector3(0, 12, 24));
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));
  const defaultPos  = useMemo(() => new THREE.Vector3(0, 26, 56), []);
  const defaultLook = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const tmpDir      = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (selectedId !== prevRef.current) {
      prevRef.current = selectedId;
      if (selectedId) {
        const p    = posRef.current[selectedId] || { x: 0, y: 0, z: 0 };
        const isSun = selectedId === 'about';
        const dist  = isSun ? 3.5 : (IS_MOBILE ? 6.5 : 4.8);
        if (isSun) { tmpDir.set(0, 0, 1); }
        else       { tmpDir.set(p.x, 0, p.z).normalize(); }
        targetPos.current.set(p.x + tmpDir.x * dist, p.y + 1.9, p.z + tmpDir.z * dist);
        targetLook.current.set(p.x, p.y, p.z);
      } else {
        targetPos.current.copy(defaultPos);
        targetLook.current.copy(defaultLook);
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
    <div className="flex items-center justify-center h-full text-center p-8">
      <div><Globe size={42} strokeWidth={1.5} className="mb-4 mx-auto text-gray-400" />
        <h2 className="text-xl font-semibold text-white mb-2">WebGL not available</h2>
        <p className="text-gray-400 text-sm">Try a modern browser like Chrome or Firefox.</p>
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
  const [hoveredId, setHoveredId] = useState(null);
  const selectedId = selectedPlanetId; // controlled externally by App
  const orbitRef = useRef();
  const posRef   = useRef({});
  const nodeMap  = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n])), []);
  const mode     = useShipStore((s) => s.mode);

  useEffect(() => { posRef.current['about'] = { x: 0, y: 0, z: 0 }; }, []);

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

  return (
    <>
      {/* Soft fill from above — gives planets sculpted shading instead of pure sun-side glare */}
      <ambientLight intensity={0.22} />
      <hemisphereLight color="#88aaff" groundColor="#221133" intensity={0.45} />
      <Nebula />
      <Stars count={STAR_COUNT} />
      <AsteroidBelt />
      <Suspense fallback={null}>
        <PlayerShip onBoard={onEnterCockpit} />
      </Suspense>
      {!IS_MOBILE && <ShootingStars />}

      {planetNodes.map((n) => (
        <OrbitalRing key={`ring-${n.id}`} radius={n.orbitRadius} color={n.color} />
      ))}

      {sunNode && (
        <Sun node={sunNode} isSelected={selectedId === sunNode.id} isHovered={hoveredId === sunNode.id}
          onClick={handleSelect} onHover={setHoveredId} hideLabel={cardOpen || mode !== 'solar'}
          onMeshReady={onSunReady} />
      )}

      {planetNodes.map((n) => (
        <Planet key={n.id} node={n}
          isSelected={selectedId === n.id} isHovered={hoveredId === n.id}
          onClick={handleSelect} onHover={setHoveredId}
          hideLabel={cardOpen || mode !== 'solar'}
          onPositionUpdate={handlePositionUpdate}
          onProjectSelect={n.content?.type === 'projects_hub' ? onProjectSelect : undefined}
        />
      ))}

      <Cockpit posRef={posRef} onEngage={handleSelect} />

      {mode === 'solar' && (
        <CameraController selectedId={selectedId} posRef={posRef} orbitRef={orbitRef} />
      )}

      <OrbitControls ref={orbitRef} enablePan={false} enableZoom zoomSpeed={0.7} rotateSpeed={0.45}
        minDistance={3} maxDistance={70} enabled={mode === 'solar' && !gestureMode} makeDefault
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
export default function Scene3D({ onNodeSelect, onPlanetSelect, onProjectSelect, onEnterCockpit, onDeselect, selectedPlanetId, gestureMode, gestureDataRef, gesture, onDwellProgress, cardOpen }) {
  const [webglSupported, setWebglSupported] = useState(true);
  const [ready, setReady] = useState(false);
  // Adaptive resolution: start at native DPR (capped at 2). If the GPU can't
  // hold the framerate (weak work laptops), PerformanceMonitor steps the
  // render resolution down in 0.25 steps (floor 1) and back up when there's
  // headroom. Visually invisible on capable machines, a big win on iGPUs.
  const maxDpr = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    return Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2);
  }, []);
  const [dpr, setDpr] = useState(maxDpr);
  // Pause rendering when the tab is hidden — saves battery + heat.
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );
  // Sun mesh ref lifted up so the GodRays effect can target it.
  const [sunMesh, setSunMesh] = useState(null);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) setWebglSupported(false);
    } catch { setWebglSupported(false); }
  }, []);

  if (!webglSupported) return <WebGLFallback />;

  return (
    <div className="w-full h-full relative">
      {!ready && <SceneLoader />}
      <Canvas camera={{ position: [0, 26, 56], fov: 55 }} style={{ background: 'transparent' }}
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
              {sunMesh && (
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
