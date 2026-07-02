import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NODES } from '../data/nodes.js';
import { useShipStore } from './useShipStore.js';
import { startHum, stopHum, warpWhoosh, hoverBlip, engageBeep, arrivalChime } from './shipAudio.js';
import { REAL_PLANET_TEXTURES, SUN_URL, loadCachedTexture } from '../lib/planetTextures.js';

/* =============================================================================
   Cockpit.jsx — explorable flight-deck mounted inside the existing Scene3D.
   - Geometry is built imperatively (ported from the v3 prototype) and added via
     <primitive>. The dashboard NAV screen is a separate JSX <mesh> so R3F gives
     us pointer events + uv for row selection.
   - A first-person controller owns the camera while the ship store mode is
     cockpit / travel / section (look = drag, walk = WASD, with collision).
   - "Engage" flies out to the chosen planet (live position from posRef) and
     calls onEngage(node) which opens your existing NodeCard.

   PROPS:
     posRef   – the SceneContent posRef ({ [nodeId]: {x,y,z} }), live planet pos
     onEngage – (node) => void   open content for this section (your NodeCard flow)
   ========================================================================== */

// Where the deck floats relative to your solar system (system is centred at origin).
// TUNE THESE to frame the planets in the window:
const COCKPIT_POS = new THREE.Vector3(0, -2, 58); // lower Y = planets sit HIGHER in the window
const LOOK_AT = new THREE.Vector3(0, 5, 0);        // point the seat aims at (the system); raise Y to lift planets
const CABIN_LIGHT = 1.0;                            // master cabin brightness — raise if too dark, lower if too bright
const OX = COCKPIT_POS.x, OY = COCKPIT_POS.y, OZ = COCKPIT_POS.z;

const SEAT = new THREE.Vector3(OX + 0, OY + 1.9, OZ + 2.9);
const _dir0 = LOOK_AT.clone().sub(SEAT).normalize();
const DEF_YAW = Math.atan2(_dir0.x, -_dir0.z);
const DEF_PITCH = Math.asin(Math.max(-1, Math.min(1, _dir0.y)));
const BOUNDS = { x: [OX - 2.0, OX + 2.0], z: [OZ - 0.4, OZ + 4.4] };
const PR = 0.38;
const OBST = [
  { x0: OX - 2.3, x1: OX + 2.3, z0: OZ - 2.1, z1: OZ - 0.1 },
  { x0: OX - 0.9, x1: OX + 0.9, z0: OZ + 3.45, z1: OZ + 4.6 },
  { x0: OX - 2.95, x1: OX - 1.95, z0: OZ - 1.2, z1: OZ + 2.5 },
  { x0: OX + 1.95, x1: OX + 2.95, z0: OZ - 1.2, z1: OZ + 2.5 },
];
const hits = (x, z) => OBST.some((o) => x > o.x0 - PR && x < o.x1 + PR && z > o.z0 - PR && z < o.z1 + PR);
const SCRW = 640, SCRH = 320;

/* ---- imperative geometry build (local coords; mounted under a positioned group) ---- */
function buildCockpit(tex) {
  const group = new THREE.Group();
  const blinkers = [];
  const ledColors = [0x4ade80, 0x4ade80, 0x00ffcc, 0x60a5fa, 0xffb454, 0xff5a5a];

  const hullMap = tex.hull || null, eqMap = tex.equipment || null, scrMap = tex.screen || null;
  const matHull = new THREE.MeshStandardMaterial({ color: 0x3c4651, map: hullMap, roughness: .62, metalness: .35 });
  const matFloor = new THREE.MeshStandardMaterial({ color: 0x2c333d, map: hullMap, roughness: .7, metalness: .4 });
  const panelL = new THREE.MeshStandardMaterial({ color: hullMap ? 0xffffff : 0xbcc6d0, map: hullMap, roughness: .6, metalness: .22 });
  const panelM = new THREE.MeshStandardMaterial({ color: 0x808b97, roughness: .68, metalness: .2 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x232932, roughness: .85, metalness: .2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2fae9a, roughness: .5, metalness: .3, emissive: 0x00ffcc, emissiveIntensity: 0.35 });
  const stripTeal = new THREE.MeshBasicMaterial({ color: 0x59ffdd, toneMapped: false });
  const stripAmber = new THREE.MeshBasicMaterial({ color: 0xffb454, toneMapped: false });
  const metalBar = new THREE.MeshStandardMaterial({ color: 0xacb6c0, roughness: .3, metalness: .85 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x171c22, roughness: .7, metalness: .4 });
  const matSeat = new THREE.MeshStandardMaterial({ color: 0x2c343e, roughness: .8, metalness: .25 });
  const eqMat = new THREE.MeshStandardMaterial({ color: eqMap ? 0xffffff : 0x6f7a86, map: eqMap, roughness: .55, metalness: .35 });
  const fixtureM = new THREE.MeshBasicMaterial({ color: 0xeaf2ff, toneMapped: false });
  const LM = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  const screenSmall = () => new THREE.MeshBasicMaterial({ color: scrMap ? 0xffffff : 0x0b1a26, map: scrMap, toneMapped: false });
  // soft self-illumination floor so panels stay readable regardless of light tuning
  [matHull, matFloor, panelL, panelM, eqMat].forEach((m) => { m.emissive = new THREE.Color(m.color.getHex()); m.emissiveIntensity = 0.12; });

  const box = (g, w, h, d, x, y, z, mat, rx, ry, rz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    g.add(m); return m;
  };
  const led = (g, x, y, z) => {
    const c = ledColors[(Math.random() * ledColors.length) | 0];
    const m = new THREE.Mesh(new THREE.BoxGeometry(.04, .04, .03), LM(c));
    m.position.set(x, y, z + .012); g.add(m);
    if (Math.random() < .4) blinkers.push({ m, o: Math.random() * 6 });
  };
  const greeble = (cx, cy, cz, W, H, rotY, rotX, opts = {}) => {
    const g = new THREE.Group(); g.position.set(cx, cy, cz); if (rotY) g.rotation.y = rotY; if (rotX) g.rotation.x = rotX; group.add(g);
    box(g, W, H, .08, 0, 0, 0, recess);
    const cols = opts.cols || Math.max(3, Math.round(W / 1.25)), rows = opts.rows || Math.max(2, Math.round(H / .92));
    const cw = W / cols, ch = H / rows, fz = .10;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -W / 2 + cw * (i + .5), y = -H / 2 + ch * (j + .5), pw = cw * .88, ph = ch * .86;
      box(g, pw, ph, .05 + Math.random() * .04, x, y, .05, Math.random() < .35 ? eqMat : (Math.random() < .6 ? panelL : panelM));
      const r = Math.random();
      if (r < .16) { box(g, pw * .74, ph * .5, .02, x, y + ph * .03, fz, screenSmall()); box(g, pw * .78, .014, .012, x, y + ph * .27, fz, accent); led(g, x - pw * .3, y - ph * .27, fz); }
      else if (r < .42) { for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) box(g, pw * .12, ph * .13, .03, x - pw * .28 + a * pw * .19, y - ph * .13 + b * ph * .24, fz, panelM); led(g, x + pw * .32, y + ph * .27, fz); led(g, x + pw * .32, y + ph * .04, fz); }
      else if (r < .57) { const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(pw, ph) * .3, .018, 8, 20), accent); ring.position.set(x, y, fz); g.add(ring); led(g, x, y, fz); }
      else if (r < .71) { for (let a = 0; a < 4; a++) box(g, pw * .72, ph * .05, .02, x, y - ph * .24 + a * ph * .14, fz, recess); }
      else if (r < .82) { box(g, pw * .82, ph * .72, .16, x, y, .14, panelL); box(g, pw * .32, .045, .05, x, y, .24, metalBar); led(g, x + pw * .3, y + ph * .28, .18); }
      if (Math.random() < .14) box(g, pw * .9, .016, .012, x, y - ph * .43, fz, accent);
    }
    box(g, W * .93, .1, .1, 0, -H * .46, .12, matDark);
    if (opts.rail) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, W * .84, 12), metalBar); bar.rotation.z = Math.PI / 2; bar.position.set(0, -H * .17, .24); g.add(bar);
      for (let k = -1; k <= 1; k += 2) { const sb = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .2, 8), metalBar); sb.position.set(k * W * .3, -H * .17, .14); sb.rotation.x = Math.PI / 2; g.add(sb); }
    }
  };

  // floor + seams
  box(group, 6, .1, 10, 0, -.05, 1.7, matFloor);
  for (let i = 0; i < 5; i++) box(group, 5.6, .02, .05, 0, .005, -2.2 + i * 1.9, recess);
  box(group, .1, .06, 9.4, -2.2, .02, 1.7, matDark); box(group, .1, .06, 9.4, 2.2, .02, 1.7, matDark);
  // glowing floor edge strips — lead the eye toward the dash, feed the bloom pass
  box(group, .035, .015, 9.0, -2.06, .06, 1.7, stripTeal); box(group, .035, .015, 9.0, 2.06, .06, 1.7, stripTeal);
  // shell
  box(group, 6, 3.4, .2, 0, 1.6, 6.7, matHull);
  box(group, .2, 3.4, 10, -3.0, 1.6, 1.7, matHull); box(group, .2, 3.4, 10, 3.0, 1.6, 1.7, matHull);
  box(group, 6, .2, 7.2, 0, 3.35, 2.4, matHull);
  // greebled walls
  greeble(0, 1.55, 6.55, 5.4, 3.0, Math.PI, 0, { rail: true });
  greeble(-2.85, 1.55, 2.2, 8.2, 3.0, Math.PI / 2, 0, { rail: true });
  greeble(2.85, 1.55, 2.2, 8.2, 3.0, -Math.PI / 2, 0, { rail: true });
  greeble(0, 3.22, 2.6, 5.2, 6.6, 0, Math.PI / 2, { cols: 4, rows: 6 });
  // ceiling light fixtures
  [[-1.5, 0.4], [1.5, 0.4], [0, 2.6], [0, 4.8]].forEach((p) => box(group, 1.5, .06, .55, p[0], 3.24, p[1], fixtureM));
  // side consoles
  const side = (s) => {
    const x = s * 2.4;
    box(group, 1.0, 1.05, 3.4, x, .55, .7, matHull);
    box(group, 1.04, .08, 3.44, x, 1.07, .7, panelM);
    const top = new THREE.Group(); top.position.set(x, 1.12, .7); top.rotation.x = -0.18; group.add(top);
    for (let i = 0; i < 5; i++) { box(top, .18, .1, .18, -s * .18, 0, -1.1 + i * .5, panelL); led(top, s * .1, 0, -1.1 + i * .5); }
    box(top, .5, .32, .02, s * .05, .02, 1.0, screenSmall());
  };
  side(-1); side(1);
  // canopy glass only — ribs/band removed (they read as "gates" obstructing the view,
  // and the torus bottoms curved down behind the seat causing back-cabin clutter).
  const glass = new THREE.Mesh(new THREE.SphereGeometry(3.26, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshPhongMaterial({ color: 0x0a1a22, transparent: true, opacity: .08, side: THREE.BackSide, shininess: 90, specular: 0x335566, depthWrite: false })); glass.position.set(0, 1.2, -0.8); group.add(glass);
  // nose bulkhead + dashboard
  box(group, 5.2, .9, .4, 0, .45, -2.0, matHull);
  greeble(0, .55, -1.95, 4.4, .8, 0, 0, { cols: 5, rows: 1 });
  // amber caution strip across the bulkhead lip
  box(group, 4.4, .025, .025, 0, .93, -1.79, stripAmber);
  const dash = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.15, 48, 1, true, Math.PI * 1.16, Math.PI * 0.68), new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: .55, metalness: .5, side: THREE.DoubleSide })); dash.position.set(0, .7, -0.75); group.add(dash);
  const cluster = (s) => {
    const gx = s * 1.05;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) box(group, .08, .05, .08, gx - s * .12 + a * s * .12, .9 - b * .12, -.35, panelM);
    led(group, gx, .95, -.32); led(group, gx, .7, -.32);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .28, 8), metalBar); lever.position.set(s * .55, .95, -.05); lever.rotation.x = -0.5; group.add(lever);
    box(group, .09, .09, .09, s * .55, 1.08, -.18, accent);
  };
  cluster(-1); cluster(1);
  box(group, 2.06, 1.1, .04, 0, 1.07, -0.16, matDark, -0.5); // screen bezel
  // seat
  box(group, 1.0, .18, 1.0, 0, .62, 3.55, matSeat); box(group, 1.0, 1.3, .16, 0, 1.32, 4.0, matSeat); box(group, .58, .34, .16, 0, 2.02, 3.96, matSeat);
  box(group, .16, .5, .85, -.6, .9, 3.55, matSeat); box(group, .16, .5, .85, .6, .9, 3.55, matSeat); box(group, .34, .62, .34, 0, .3, 3.55, matDark);
  box(group, .9, .04, .9, 0, .72, 3.55, accent); led(group, .5, 1.0, 3.62);
  box(group, .5, .018, .02, 0, 2.2, 3.9, stripTeal); // headrest glow line

  // cabin lighting — local to the deck so it doesn't depend on your distant sun.
  // hemisphere gives the even ISS-style fill; ceiling point lights add pools.
  group.add(new THREE.HemisphereLight(0xbcd0e8, 0x2a2f37, 1.3 * CABIN_LIGHT));
  [[-1.5, 3.0, 0.4], [1.5, 3.0, 0.4], [0, 3.0, 2.6], [0, 3.0, 4.8]].forEach((p) => {
    const pl = new THREE.PointLight(0xe6eeff, 30 * CABIN_LIGHT, 18, 2); pl.position.set(p[0], p[1], p[2]); group.add(pl);
  });
  const fillP = new THREE.PointLight(0x9fb8ff, 10 * CABIN_LIGHT, 16, 2); fillP.position.set(0, 1.4, 1.2); group.add(fillP);
  // teal console underglow — makes the dash read as the powered heart of the deck
  const dashGlow = new THREE.PointLight(0x00ffcc, 5 * CABIN_LIGHT, 6, 2); dashGlow.position.set(0, 1.0, -0.4); group.add(dashGlow);

  return { group, blinkers };
}

/* ---- destination hologram — cyan planet preview above the dash on row hover ---- */
const HOLO_COLOR = '#7dfff0';

function DestinationHolo({ hoveredRef, navReadyRef }) {
  const groupRef = useRef();
  const sphereRef = useRef();
  const curRow = useRef(-1);

  // Same 2K textures the real planets use — already in the GPU cache by the
  // time anyone reaches the cockpit, so swapping maps is free.
  const textures = useMemo(
    () => NODES.map((n) => loadCachedTexture(n.isSun ? SUN_URL : REAL_PLANET_TEXTURES[n.realPlanet])),
    []
  );

  const sphereMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: textures[0], color: new THREE.Color(HOLO_COLOR),
    transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), [textures]);

  const rimMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(HOLO_COLOR) } },
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
      uniform vec3 uColor;
      varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        float f = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.4);
        gl_FragColor = vec4(uColor, f * 0.7);
      }
    `,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  }), []);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const m = useShipStore.getState().mode;
    const row = m === 'cockpit' && navReadyRef.current ? hoveredRef.current : -1;
    if (row >= 0 && row !== curRow.current) {
      curRow.current = row;
      sphereMat.map = textures[row];
    }
    // pop in on hover, shrink away when the cursor leaves the list
    const target = row >= 0 ? 1 : 0.0001;
    const s = g.scale.x + (target - g.scale.x) * Math.min(delta * 9, 1);
    g.scale.setScalar(s);
    g.visible = s > 0.02;
    if (!g.visible) return;
    if (sphereRef.current) sphereRef.current.rotation.y += delta * 0.9;
    const t = state.clock.elapsedTime;
    // holographic shimmer — two incommensurate sines read as instability
    sphereMat.opacity = 0.78 + Math.sin(t * 24) * 0.05 + Math.sin(t * 61) * 0.03;
  });

  return (
    <group ref={groupRef} position={[0, 2.1, -1.15]} scale={0.0001} visible={false}>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[0.26, 32, 32]} />
        <primitive object={sphereMat} attach="material" />
      </mesh>
      <mesh scale={1.12}>
        <sphereGeometry args={[0.26, 24, 24]} />
        <primitive object={rimMat} attach="material" />
      </mesh>
      {/* base ring + projection beam anchoring the holo to the dash */}
      <mesh position={[0, -0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.36, 48]} />
        <meshBasicMaterial color={HOLO_COLOR} transparent opacity={0.35} side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.24, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.33, 0.36, 24, 1, true]} />
        <meshBasicMaterial color={HOLO_COLOR} transparent opacity={0.06} side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ---- warp streaks — additive line tunnel that streams past during travel ---- */
const STREAK_COUNT = 150;
const STREAK_SPAN = 60;

function makeStreakGeometry() {
  const pos = new Float32Array(STREAK_COUNT * 2 * 3);
  for (let i = 0; i < STREAK_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.random() * 5.5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    const z = -Math.random() * STREAK_SPAN;
    const len = 2.5 + Math.random() * 5;
    pos.set([x, y, z, x, y, z - len], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

// Rides along with the camera in view space; two stacked copies leapfrog each
// other for a seamless wrap. Occluded by the hull while still inside the deck,
// which is exactly right — the streaks only fill the canopy view.
function WarpStreaks() {
  const camera = useThree((s) => s.camera);
  const groupRef = useRef();
  const opacity = useRef(0);
  const geom = useMemo(() => makeStreakGeometry(), []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({
    color: 0x9fffe8, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), []);
  useFrame((state, delta) => {
    const m = useShipStore.getState().mode;
    const target = m === 'travel' ? 0.85 : 0;
    opacity.current += (target - opacity.current) * (m === 'travel' ? 2.5 : 6) * Math.min(delta, 0.05);
    mat.opacity = opacity.current;
    const g = groupRef.current;
    if (!g) return;
    g.visible = opacity.current > 0.02;
    if (!g.visible) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    const z = (state.clock.elapsedTime * 55) % STREAK_SPAN;
    g.children[0].position.z = z;
    g.children[1].position.z = z - STREAK_SPAN;
  });
  return (
    <group ref={groupRef} visible={false}>
      <lineSegments geometry={geom} material={mat} />
      <lineSegments geometry={geom} material={mat} />
    </group>
  );
}

export default function Cockpit({ posRef, onEngage }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mode = useShipStore((s) => s.mode);
  const setMode = useShipStore((s) => s.setMode);

  const navList = useMemo(
    () => NODES.map((n) => ({ id: n.id, label: n.label, color: n.color, sub: n.content?.subtitle?.slice(0, 40) || '', node: n })),
    []
  );

  // nav screen canvas
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = SCRW; canvas.height = SCRH;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const rects = navList.map((s, i) => ({ x: 16, y: 64 + i * 34, w: 392, h: 32 }));
    return { canvas, ctx, texture, rects };
  }, [navList]);

  // load panel textures (graceful fallback if files are missing)
  const [tex, setTex] = useState({ hull: null, equipment: null, screen: null });
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const load = (url) => new Promise((res) => loader.load(
      url,
      (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); },
      undefined,
      () => res(null),
    ));
    let alive = true;
    Promise.all([
      load('/textures/cockpit/hull.png'),
      load('/textures/cockpit/equipment.png'),
      load('/textures/cockpit/screen.png'),
    ]).then(([hull, equipment, screen]) => { if (alive) setTex({ hull, equipment, screen }); });
    return () => { alive = false; };
  }, []);

  // build geometry once textures resolve (rebuilds if they arrive later)
  const built = useMemo(() => buildCockpit(tex), [tex]);

  // ── controller refs ──
  const yaw = useRef(DEF_YAW), pitch = useRef(DEF_PITCH), tYaw = useRef(DEF_YAW), tPitch = useRef(DEF_PITCH);
  const camPos = useRef(SEAT.clone());
  const dragging = useRef(false), moved = useRef(0), px = useRef(0), py = useRef(0);
  const keys = useRef({});
  const hovered = useRef(-1);
  const navReady = useRef(false);
  const enterT = useRef(null);
  const travel = useRef(null);            // {target:Vector3, look:Vector3, node, phase}
  const prevMode = useRef(mode);
  const tRef = useRef(0);
  const groupRef = useRef();

  // kill the engine hum if the whole scene unmounts (HMR, WebGL loss)
  useEffect(() => () => stopHum(), []);

  // input listeners
  useEffect(() => {
    const el = gl.domElement;
    const down = (e) => { if (useShipStore.getState().mode !== 'cockpit') return; dragging.current = true; moved.current = 0; px.current = e.clientX; py.current = e.clientY; };
    const up = () => { dragging.current = false; };
    const move = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - px.current, dy = e.clientY - py.current; px.current = e.clientX; py.current = e.clientY;
      moved.current += Math.abs(dx) + Math.abs(dy);
      tYaw.current += dx * 0.0026; tPitch.current -= dy * 0.0024;
      tPitch.current = Math.max(-0.9, Math.min(0.9, tPitch.current));
      tYaw.current = Math.max(-2.6, Math.min(2.6, tYaw.current));
    };
    const kd = (e) => { keys.current[e.key.toLowerCase()] = true; };
    const ku = (e) => { keys.current[e.key.toLowerCase()] = false; };
    el.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('pointermove', move);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [gl]);

  const rowFromUv = (uv) => {
    if (!uv) return -1;
    const cx = uv.x * SCRW, cy = (1 - uv.y) * SCRH;
    for (let i = 0; i < screen.rects.length; i++) { const r = screen.rects[i]; if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return i; }
    return -1;
  };

  const startTravel = (i) => {
    if (useShipStore.getState().mode !== 'cockpit' || !navReady.current) return;
    const node = navList[i].node;
    const p = (posRef?.current && posRef.current[node.id]) || { x: 0, y: 0, z: 0 };
    const target = new THREE.Vector3(p.x, p.y || 0, p.z);
    const dir = target.clone().sub(camera.position).normalize();
    const stop = target.clone().sub(dir.multiplyScalar(node.isSun ? 6 : Math.max((node.size || 1) * 4, 3)));
    travel.current = { target: stop, look: target, node, startedAt: performance.now() };
    engageBeep(); warpWhoosh();
    setMode('travel');
  };

  // draw the nav screen
  const draw = (t) => {
    const { ctx } = screen;
    ctx.clearRect(0, 0, SCRW, SCRH); ctx.fillStyle = 'rgba(4,12,16,.94)'; ctx.fillRect(0, 0, SCRW, SCRH);
    ctx.strokeStyle = 'rgba(0,255,204,.45)'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, SCRW - 12, SCRH - 12);
    if (!navReady.current) {
      const p = enterT.current == null ? 0 : Math.min((t - enterT.current) / 1.9, 1);
      ctx.fillStyle = '#00ffcc'; ctx.font = '600 22px monospace'; ctx.fillText('POWERING ON', SCRW / 2 - 90, SCRH / 2 - 18);
      ctx.strokeStyle = 'rgba(0,255,204,.6)'; ctx.strokeRect(SCRW / 2 - 130, SCRH / 2, 260, 16);
      ctx.fillStyle = '#00ffcc'; ctx.fillRect(SCRW / 2 - 128, SCRH / 2 + 2, 256 * p, 12);
      ctx.font = '11px monospace'; ctx.fillStyle = '#7fd6c8'; ctx.fillText('NAV CORE · ' + Math.round(p * 100) + '%', SCRW / 2 - 58, SCRH / 2 + 42);
      screen.texture.needsUpdate = true; return;
    }
    ctx.fillStyle = '#00ffcc'; ctx.font = '600 18px monospace'; ctx.fillText('NAV // SELECT DESTINATION', 20, 38);
    navList.forEach((s, i) => {
      const r = screen.rects[i];
      if (i === hovered.current) { ctx.fillStyle = 'rgba(0,255,204,.16)'; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = 'rgba(0,255,204,.6)'; ctx.lineWidth = 1; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1); }
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(r.x + 16, r.y + r.h / 2, 5, 0, 7); ctx.fill();
      ctx.fillStyle = i === hovered.current ? '#fff' : '#cfe7f5'; ctx.font = '600 14px monospace'; ctx.fillText(s.label.toUpperCase(), r.x + 34, r.y + 15);
      ctx.fillStyle = '#6f93aa'; ctx.font = '10px monospace'; ctx.fillText(s.sub, r.x + 34, r.y + 28);
      ctx.fillStyle = '#3f6076'; ctx.fillText(String(i + 1).padStart(2, '0'), r.x + r.w - 22, r.y + 19);
    });
    const cx = SCRW - 110, cy = 200, R = 84;
    ctx.strokeStyle = 'rgba(0,255,204,.3)'; ctx.lineWidth = 1;[.4, .7, 1].forEach((rr) => { ctx.beginPath(); ctx.arc(cx, cy, R * rr, 0, 7); ctx.stroke(); });
    const sweep = (t * 1.4) % 6.283; ctx.strokeStyle = 'rgba(0,255,204,.7)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
    navList.forEach((s) => { const p = posRef?.current?.[s.id]; if (!p) return; const a = Math.atan2(p.z, p.x); const rr = Math.min(Math.hypot(p.x, p.z) / 36, 1) * R; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.5, 0, 7); ctx.fill(); });
    ctx.fillStyle = '#6f93aa'; ctx.font = '10px monospace'; ctx.fillText('▸ look + click a row', 20, 302);
    // CRT scanlines — sells the screen as a physical display
    ctx.fillStyle = 'rgba(0,0,0,.13)';
    for (let y = 8; y < SCRH - 8; y += 4) ctx.fillRect(8, y, SCRW - 16, 1);
    screen.texture.needsUpdate = true;
  };

  const fv = (y, p) => new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));

  useFrame((_, delta) => {
    const t = (tRef.current += Math.min(delta, 0.05));
    const m = useShipStore.getState().mode;
    if (groupRef.current) groupRef.current.visible = m !== 'solar';
    if (m === 'solar') {
      if (prevMode.current !== 'solar') stopHum();
      prevMode.current = 'solar';
      // restore the base FOV if we bailed out mid-travel
      if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
      return; // cockpit idle while in the galaxy
    }
    if (prevMode.current === 'solar') startHum();
    // FOV punch during warp, ease back once seated/arrived
    const targetFov = m === 'travel' ? 68 : 55;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(delta * 2.2, 1);
      camera.updateProjectionMatrix();
    }

    // entering the deck
    if (m === 'cockpit' && prevMode.current !== 'cockpit') {
      if (prevMode.current === 'section') {
        // returning from a section → glide back to the seat
        travel.current = { target: SEAT.clone(), look: LOOK_AT.clone(), node: null, returning: true };
      } else {
        // entering from the galaxy → snap into the seat (the fade covers the cut), re-power the screen
        camPos.current.copy(SEAT); camera.position.copy(SEAT);
        yaw.current = tYaw.current = DEF_YAW; pitch.current = tPitch.current = DEF_PITCH;
        travel.current = null; enterT.current = t; navReady.current = false;
      }
    }
    prevMode.current = m;
    if (m === 'cockpit' && enterT.current != null && t - enterT.current > 1.9) navReady.current = true;

    built.blinkers.forEach((b) => { b.m.material.transparent = true; b.m.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(t * 1.6 + b.o)); });
    draw(t);

    if (m === 'cockpit') {
      if (travel.current) { // gliding back to seat
        camera.position.lerp(travel.current.target, 0.1); camera.lookAt(travel.current.look);
        if (camera.position.distanceTo(travel.current.target) < 0.05) {
          camPos.current.copy(SEAT); yaw.current = tYaw.current = DEF_YAW; pitch.current = tPitch.current = DEF_PITCH; travel.current = null;
        }
        return;
      }
      yaw.current += (tYaw.current - yaw.current) * 0.18; pitch.current += (tPitch.current - pitch.current) * 0.18;
      const fwd = fv(yaw.current, 0), right = new THREE.Vector3(fwd.z, 0, -fwd.x); const mv = new THREE.Vector3();
      const k = keys.current;
      if (k['w'] || k['arrowup']) mv.add(fwd); if (k['s'] || k['arrowdown']) mv.sub(fwd);
      if (k['d'] || k['arrowright']) mv.sub(right); if (k['a'] || k['arrowleft']) mv.add(right);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(0.05);
        const nx = camPos.current.x + mv.x; if (!hits(nx, camPos.current.z)) camPos.current.x = nx;
        const nz = camPos.current.z + mv.z; if (!hits(camPos.current.x, nz)) camPos.current.z = nz;
        camPos.current.x = Math.max(BOUNDS.x[0], Math.min(BOUNDS.x[1], camPos.current.x));
        camPos.current.z = Math.max(BOUNDS.z[0], Math.min(BOUNDS.z[1], camPos.current.z));
      }
      camera.position.lerp(camPos.current, 0.4);
      camera.position.y += Math.sin(t * 1.1) * 0.006; // idle sway — the ship feels alive
      const d = fv(yaw.current, pitch.current);
      camera.lookAt(camera.position.clone().add(d));
    } else if (m === 'travel' && travel.current) {
      camera.position.lerp(travel.current.target, 0.03); camera.lookAt(travel.current.look);
      const elapsed = (performance.now() - (travel.current.startedAt || 0)) / 1000;
      // launch shake — sharp, gone within the first half-second
      const shake = Math.max(0, 0.45 - elapsed) * 0.05;
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
      }
      // gentle bank into the flight, released before arrival (~2.6s window)
      camera.rotateZ(Math.sin(Math.min(elapsed * 1.2, Math.PI)) * 0.07);
      if (camera.position.distanceTo(travel.current.target) < 1.2) {
        arrivalChime();
        onEngage?.(travel.current.node);   // open your NodeCard
        setMode('section');
      }
    } else if (m === 'section' && travel.current) {
      camera.lookAt(travel.current.look);  // hold on the planet while content is open
    }
  });

  return (
    <>
      <group ref={groupRef} position={COCKPIT_POS}>
        <primitive object={built.group} />
        <group position={[0, 1.08, -0.08]} rotation={[-0.5, 0, 0]}>
          <mesh
            onPointerMove={(e) => {
              e.stopPropagation();
              if (!navReady.current) return;
              const r = rowFromUv(e.uv);
              if (r !== hovered.current && r >= 0) hoverBlip();
              hovered.current = r;
            }}
            onPointerOut={() => { hovered.current = -1; }}
            onClick={(e) => { e.stopPropagation(); if (moved.current > 6) return; const r = rowFromUv(e.uv); if (r >= 0) startTravel(r); }}
          >
            <planeGeometry args={[1.9, 0.95]} />
            <meshBasicMaterial map={screen.texture} transparent toneMapped={false} />
          </mesh>
          {/* glowing bezel frame around the nav screen */}
          {[
            { pos: [0, 0.492, 0.004], size: [1.94, 0.02, 0.012] },
            { pos: [0, -0.492, 0.004], size: [1.94, 0.02, 0.012] },
            { pos: [-0.96, 0, 0.004], size: [0.02, 1.0, 0.012] },
            { pos: [0.96, 0, 0.004], size: [0.02, 1.0, 0.012] },
          ].map((f, i) => (
            <mesh key={i} position={f.pos}>
              <boxGeometry args={f.size} />
              <meshBasicMaterial color="#59ffdd" toneMapped={false} />
            </mesh>
          ))}
        </group>
        <DestinationHolo hoveredRef={hovered} navReadyRef={navReady} />
      </group>
      {/* world-space overlay — tracks the camera itself, so it lives outside COCKPIT_POS */}
      <WarpStreaks />
    </>
  );
}
