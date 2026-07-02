import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
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
// Interior v2 — an octagonal hull tube dressed in AI-generated panel textures
// (Higgsfield: wall / floor / ceiling / dashboard). The pilot seat is a
// generated GLB mounted separately in JSX (<PilotSeat/>). Footprint, seat
// position, collision bounds and the nav screen transform are unchanged.
function buildCockpit(tex) {
  const group = new THREE.Group();
  const blinkers = [];

  // clone-with-repeat so one loaded texture can wrap several surfaces
  const T = (t, rx, ry, ox = 0, oy = 0) => {
    if (!t) return null;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(rx, ry);
    c.offset.set(ox, oy);
    c.needsUpdate = true;
    return c;
  };
  // panel material with a soft self-illumination floor (same emissiveMap trick
  // as the planets) so the generated art reads regardless of light tuning
  const M = (map, { rough = .62, metal = .3, glow = .3, fallback = 0x39424d } = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : fallback, map, roughness: rough, metalness: metal });
    if (map) { m.emissiveMap = map; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = glow; }
    else { m.emissive = new THREE.Color(fallback); m.emissiveIntensity = 0.12; }
    return m;
  };
  const LM = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x171c22, roughness: .7, metalness: .4 });
  const metalBar = new THREE.MeshStandardMaterial({ color: 0xacb6c0, roughness: .3, metalness: .85 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2fae9a, roughness: .5, metalness: .3, emissive: 0x00ffcc, emissiveIntensity: 0.35 });
  const stripTeal = LM(0x59ffdd);
  const stripAmber = LM(0xffb454);

  const box = (w, h, d, x, y, z, mat, rx, ry, rz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    group.add(m); return m;
  };
  const ledColors = [0x4ade80, 0x00ffcc, 0x60a5fa, 0xffb454, 0xff5a5a];
  const led = (x, y, z) => {
    const m = box(.05, .05, .03, x, y, z, LM(ledColors[(Math.random() * ledColors.length) | 0]));
    if (Math.random() < .5) blinkers.push({ m, o: Math.random() * 6 });
    return m;
  };

  // ── hull: octagonal tube along z, flat facets at floor / walls / ceiling ──
  const hullMat = M(T(tex.wall, 4, 1.6), { rough: .72, metal: .28, glow: .27 });
  hullMat.side = THREE.BackSide;
  const tubeGeo = new THREE.CylinderGeometry(3.2, 3.2, 10.4, 8, 1, true);
  tubeGeo.rotateY(Math.PI / 8);   // facet centres to 0/45/90°…
  tubeGeo.rotateX(Math.PI / 2);   // axis along z
  const tube = new THREE.Mesh(tubeGeo, hullMat);
  tube.position.set(0, 1.4, 1.5);
  group.add(tube);
  // glowing seams along the upper facet corners
  box(.03, .03, 9.8, -1.22, 4.32, 1.5, stripTeal, 0, 0, Math.PI / 4);
  box(.03, .03, 9.8, 1.22, 4.32, 1.5, stripTeal, 0, 0, -Math.PI / 4);

  // ── rear cap + airlock — same wall panelling as the tube for cohesion
  // (the bright light-panel "ceiling" art overpowered the cabin; it now only
  // dresses the ceiling troughs' surround below)
  const capGeo = new THREE.CircleGeometry(3.2, 8);
  capGeo.rotateZ(Math.PI / 8);
  const cap = new THREE.Mesh(capGeo, M(T(tex.wall, 1.8, 1.8), { glow: .28 }));
  cap.position.set(0, 1.4, 6.68); cap.rotation.y = Math.PI;
  group.add(cap);
  box(1.5, 2.3, .08, 0, 1.15, 6.6, matDark);                 // airlock slab
  box(1.66, .05, .1, 0, 2.32, 6.58, stripTeal);              // glowing frame
  box(.05, 2.36, .1, -.85, 1.15, 6.58, stripTeal);
  box(.05, 2.36, .1, .85, 1.15, 6.58, stripTeal);
  box(.34, .12, .06, .52, 1.62, 6.54, accent); led(.52, 1.4, 6.54); // door panel

  // ── floor: generated deck plating + glowing centre walkway to the dash ──
  const floorGeo = new THREE.PlaneGeometry(6.2, 10.4);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, M(T(tex.floor, 2, 3.4), { rough: .8, metal: .3, glow: .26 }));
  floor.position.set(0, 0, 1.5);
  group.add(floor);
  box(.04, .02, 9.4, -.55, .015, 1.5, stripTeal);
  box(.04, .02, 9.4, .55, .015, 1.5, stripTeal);

  // ── ceiling: generated light-panel art on the top facet + physical troughs ──
  const ceilGeo = new THREE.PlaneGeometry(2.4, 9.8);
  ceilGeo.rotateX(Math.PI / 2);                              // face down
  const ceil = new THREE.Mesh(ceilGeo, M(T(tex.ceiling, 1, 3.2), { glow: .3 }));
  ceil.position.set(0, 4.35, 1.5);
  group.add(ceil);
  [-0.85, 0.85].forEach((x) => {
    box(.55, .05, 7.6, x, 4.33, 1.6, matDark);               // recess frame
    box(.45, .05, 7.4, x, 4.3, 1.6, LM(0xeaf2ff));           // diffuser
  });

  // ── canopy glass (kept: ribs read as obstructions per earlier feedback) ──
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(3.26, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshPhongMaterial({ color: 0x0a1a22, transparent: true, opacity: .08, side: THREE.BackSide, shininess: 90, specular: 0x335566, depthWrite: false })
  );
  glass.position.set(0, 1.2, -0.8); group.add(glass);

  // ── nose bulkhead + wraparound dash (generated console texture) ──
  box(5.2, .9, .4, 0, .45, -2.0, M(T(tex.wall, 1.8, .32, 0, .1), { glow: .3 }));
  box(4.4, .025, .025, 0, .93, -1.79, stripAmber);           // caution strip
  // the generated art is a complete dashboard face — wrap it ONCE around the
  // curved console instead of tiling it, so it reads as the actual instrument
  // panel (its dark border blends into the cabin shadow)
  const dashMat = M(T(tex.dash, 1, 1), { rough: .5, metal: .4, glow: .5 });
  dashMat.side = THREE.DoubleSide;
  const dash = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 1.1, 48, 1, true, Math.PI * 1.16, Math.PI * 0.68), dashMat);
  dash.position.set(0, .7, -0.75); group.add(dash);
  // console deck under the nav screen — centre band of the dashboard art
  const deckGeo = new THREE.PlaneGeometry(3.7, 1.3);
  deckGeo.rotateX(-Math.PI / 2 + 0.5);
  const deck = new THREE.Mesh(deckGeo, M(T(tex.dash, .55, .28, .22, .36), { rough: .55, metal: .35, glow: .45 }));
  deck.position.set(0, .93, -0.3); group.add(deck);
  // physical controls flanking the screen
  const cluster = (s) => {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++)
      box(.09, .04, .09, s * 1.15 + (a - 1) * .15, 1.02 - b * .06, -.2 - b * .17, b ? matDark : accent, -.5);
    led(s * 1.45, 1.02, -.18); led(s * 1.45, .94, -.36);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .3, 10), metalBar);
    lever.position.set(s * .72, 1.08, -.12); lever.rotation.x = -0.6; group.add(lever);
    box(.08, .08, .08, s * .72, 1.21, -.24, accent);
  };
  cluster(-1); cluster(1);
  box(2.06, 1.1, .04, 0, 1.07, -0.16, matDark, -0.5);        // nav screen bezel

  // ── side consoles with generated panel tops ──
  const side = (s) => {
    const x = s * 2.35;
    box(1.1, .95, 3.3, x, .5, .9, M(T(tex.wall, .9, .4, .3, .35), { glow: .3 }));
    box(1.16, .06, 3.36, x, .03, .9, matDark);               // plinth
    const topGeo = new THREE.PlaneGeometry(1.06, 3.2);
    topGeo.rotateX(-Math.PI / 2);
    // left/right button-cluster regions of the dashboard art
    const top = new THREE.Mesh(topGeo, M(T(tex.dash, .3, .85, s > 0 ? .67 : .03, .08), { glow: .5 }));
    top.position.set(x, .985, .9);
    group.add(top);
    led(x - s * .3, 1.01, -.1); led(x - s * .3, 1.01, .7); led(x - s * .3, 1.01, 1.5);
  };
  side(-1); side(1);

  // cabin lighting — local to the deck so it doesn't depend on your distant sun.
  // hemisphere gives the even ISS-style fill; ceiling point lights add pools.
  group.add(new THREE.HemisphereLight(0xbcd0e8, 0x2a2f37, 1.3 * CABIN_LIGHT));
  [[-1.5, 3.0, 0.4], [1.5, 3.0, 0.4], [0, 3.0, 2.6], [0, 3.0, 4.8]].forEach((p) => {
    const pl = new THREE.PointLight(0xe6eeff, 23 * CABIN_LIGHT, 18, 2); pl.position.set(p[0], p[1], p[2]); group.add(pl);
  });
  const fillP = new THREE.PointLight(0x9fb8ff, 10 * CABIN_LIGHT, 16, 2); fillP.position.set(0, 1.4, 1.2); group.add(fillP);
  // teal console underglow — makes the dash read as the powered heart of the deck
  const dashGlow = new THREE.PointLight(0x00ffcc, 5 * CABIN_LIGHT, 6, 2); dashGlow.position.set(0, 1.0, -0.4); group.add(dashGlow);

  return { group, blinkers };
}

/* ---- pilot seat — Higgsfield-generated GLB, normalized and floor-mounted ---- */
const SEAT_URL = '/models/pilot_seat.glb';

function PilotSeat() {
  const { scene } = useGLTF(SEAT_URL);
  const seat = useMemo(() => {
    const s = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(s);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 1.6 / size.y;                       // ~1.6 units tall
    s.scale.setScalar(scale);
    const c = bounds.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    s.position.set(-c.x, -bounds.min.y * scale, -c.z); // centre, feet on floor
    s.traverse((o) => {
      if (o.isMesh && o.material?.map) {
        o.material.emissiveMap = o.material.map;
        o.material.emissive = new THREE.Color(0xffffff);
        o.material.emissiveIntensity = 0.16; // readable in cabin shadow
      }
    });
    return s;
  }, [scene]);
  // wrapper group carries placement; the clone keeps its internal
  // centre/floor-mount offsets (a position prop on <primitive> would clobber them)
  return (
    <group position={[0, 0.02, 3.55]}>
      <primitive object={seat} />
    </group>
  );
}
useGLTF.preload(SEAT_URL);

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

  // load the generated panel textures (graceful fallback if files are missing)
  const [tex, setTex] = useState({ wall: null, floor: null, ceiling: null, dash: null });
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
      load('/textures/cockpit/wall.jpg'),
      load('/textures/cockpit/floor.jpg'),
      load('/textures/cockpit/ceiling.jpg'),
      load('/textures/cockpit/dash.jpg'),
    ]).then(([wall, floor, ceiling, dash]) => { if (alive) setTex({ wall, floor, ceiling, dash }); });
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
      // ±175° — enough to turn around and admire the seat + airlock
      tYaw.current = Math.max(-3.05, Math.min(3.05, tYaw.current));
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
        <Suspense fallback={null}>
          <PilotSeat />
        </Suspense>
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
