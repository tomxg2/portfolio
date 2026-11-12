import { useEffect, useRef } from 'react';

// A small hand-written WebGL2 point renderer for the homepage hero.
// Kept free of three.js so the homepage stays light; the full 3D runtime
// only loads on /lab.

const VERTEX = `#version 300 es
precision highp float;
in vec4 aOrbit; // ring: radius, angle, speed, phase | core: radius, theta, speed, phi | dust: x, y, speed, z
in vec4 aMeta;  // tiltX, tiltZ, size, kind (0 ring, 1 core, 2 dust, 3 accent ring)
uniform float uTime;
uniform float uAspect;
uniform float uScroll;
uniform float uPixel;
uniform vec2 uMouse;
uniform vec2 uLook;
uniform vec2 uCenter;
out vec3 vColor;
out float vAlpha;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  float kind = aMeta.w;
  vec3 p;
  if (kind < 0.5 || kind > 2.5) {
    float a = aOrbit.y + uTime * aOrbit.z;
    float r = aOrbit.x;
    p = vec3(cos(a) * r, sin(a * 3.0 + aOrbit.w) * 0.018 * r, sin(a) * r);
    p = rotZ(aMeta.y) * rotX(aMeta.x) * p;
  } else if (kind < 1.5) {
    float th = aOrbit.y + uTime * aOrbit.z;
    float ph = aOrbit.w;
    float breathe = 1.0 + 0.05 * sin(uTime * 1.3 + ph * 7.0 + th * 3.0);
    p = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)) * aOrbit.x * breathe;
  } else {
    p = vec3(aOrbit.x, aOrbit.y + sin(uTime * 0.15 + aOrbit.x) * 0.06, aOrbit.w);
  }

  p = rotY(uTime * 0.025 + uLook.x) * p;
  p = rotX(0.38 + uLook.y) * p;

  float camera = 4.6 - uScroll * 2.2;
  float depth = max(camera - p.z, 0.2);
  float focal = 2.6;
  vec2 ndc = vec2(p.x * focal / uAspect, p.y * focal) / depth + uCenter;

  vec2 diff = ndc - uMouse;
  diff.x *= uAspect;
  float dist = length(diff);
  float push = exp(-dist * dist * 22.0) * 0.07;
  vec2 dir = diff / max(dist, 1e-4);
  dir.x /= uAspect;
  ndc += dir * push;

  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = aMeta.z * uPixel * (4.4 / depth);

  vec3 ink = vec3(0.90, 0.91, 0.86);
  vec3 sun = vec3(1.0, 0.72, 0.42);
  vec3 lime = vec3(0.86, 0.97, 0.40);
  if (kind < 0.5) { vColor = ink; vAlpha = 0.85; }
  else if (kind < 1.5) { vColor = mix(sun, vec3(1.0, 0.93, 0.80), aOrbit.x / 0.42); vAlpha = 1.0; }
  else if (kind < 2.5) { vColor = ink * 0.8; vAlpha = 0.4; }
  else { vColor = lime; vAlpha = 0.9; }
  vAlpha *= clamp(1.25 - depth * 0.16, 0.15, 1.0) * (1.0 - uScroll * 0.65) + push * 4.0;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 color;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, r) * vAlpha;
  if (a < 0.01) discard;
  color = vec4(vColor * a, a);
}`;

function makeParticles(small) {
  const orbit = [];
  const meta = [];
  const random = mulberry32(7);
  const gauss = () => (random() + random() + random() - 1.5) / 1.5;
  const push = (o, m) => { orbit.push(...o); meta.push(...m); };

  const rings = [
    { r: 0.72, w: 0.015, n: 900, tx: 0.04, tz: 0.02 },
    { r: 1.02, w: 0.03, n: 1300, tx: -0.03, tz: 0.05 },
    { r: 1.38, w: 0.02, n: 1500, tx: 0.06, tz: -0.04, accent: true },
    { r: 1.74, w: 0.08, n: 2600, tx: 0.0, tz: 0.03 },
    { r: 2.15, w: 0.03, n: 1900, tx: -0.05, tz: -0.02 },
    { r: 2.6, w: 0.14, n: 2800, tx: 0.08, tz: 0.06 },
    { r: 1.9, w: 0.02, n: 900, tx: 0.9, tz: 0.4 },
  ];
  const scale = small ? 0.45 : 1;
  rings.forEach((ring, index) => {
    const count = Math.round(ring.n * scale);
    for (let i = 0; i < count; i++) {
      const radius = ring.r + gauss() * ring.w;
      const speed = 0.22 * Math.pow(radius, -1.5) * (index % 2 ? 1 : 0.92);
      const accent = ring.accent && random() < 0.35;
      push([radius, random() * Math.PI * 2, speed, random() * 6.28], [ring.tx, ring.tz, 1.1 + random() * 1.6, accent ? 3 : 0]);
    }
  });
  const coreCount = Math.round(2600 * scale);
  for (let i = 0; i < coreCount; i++) {
    const shell = random() < 0.7;
    const radius = shell ? 0.36 + gauss() * 0.02 : 0.36 * Math.cbrt(random());
    push([radius, random() * Math.PI * 2, 0.12 + random() * 0.08, Math.acos(2 * random() - 1)], [0, 0, 1.3 + random() * 1.9, 1]);
  }
  const dustCount = Math.round(1400 * scale);
  for (let i = 0; i < dustCount; i++) {
    push([(random() - 0.5) * 12, (random() - 0.5) * 7, 0, (random() - 0.5) * 8], [0, 0, 0.6 + random() * 0.8, 2]);
  }
  return { orbit: new Float32Array(orbit), meta: new Float32Array(meta), count: orbit.length / 4 };
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader failed');
  return shader;
}

export default function OrbitField({ onUnavailable }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) { onUnavailable?.(); return undefined; }

    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Link failed');
    } catch {
      onUnavailable?.();
      return undefined;
    }

    const small = window.matchMedia('(max-width: 760px)').matches;
    const { orbit, meta, count } = makeParticles(small);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [['aOrbit', orbit], ['aMeta', meta]].forEach(([name, data]) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
    });

    const uniform = (name) => gl.getUniformLocation(program, name);
    const u = {
      time: uniform('uTime'), aspect: uniform('uAspect'), scroll: uniform('uScroll'), pixel: uniform('uPixel'),
      mouse: uniform('uMouse'), look: uniform('uLook'), center: uniform('uCenter'),
    };

    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const pointer = { x: 2, y: 2, tx: 2, ty: 2 };
    const look = { x: 0, y: 0, tx: 0, ty: 0 };
    let width = 0;
    let height = 0;
    let pixel = 1;
    let visible = true;
    let frame = 0;
    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixel = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
      width = Math.max(1, Math.round(rect.width * pixel));
      height = Math.max(1, Math.round(rect.height * pixel));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    const onPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.ty = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      look.tx = pointer.tx * 0.18;
      look.ty = -pointer.ty * 0.08;
    };
    const onLeave = () => { pointer.tx = 2; pointer.ty = 2; look.tx = 0; look.ty = 0; };

    const render = () => {
      frame = 0;
      if (!visible) return;
      const t = (performance.now() - start) / 1000;
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;
      look.x += (look.tx - look.x) * 0.04;
      look.y += (look.ty - look.y) * 0.04;
      const rect = canvas.getBoundingClientRect();
      const scroll = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
      const aspect = width / height;
      const wide = aspect > 1.15;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.aspect, aspect);
      gl.uniform1f(u.scroll, scroll);
      gl.uniform1f(u.pixel, pixel);
      gl.uniform2f(u.mouse, pointer.x, pointer.y);
      gl.uniform2f(u.look, look.x, look.y);
      gl.uniform2f(u.center, wide ? 0.34 : 0.0, wide ? 0.08 : 0.28);
      gl.drawArrays(gl.POINTS, 0, count);
      frame = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === 'visible';
      if (visible && !frame) frame = requestAnimationFrame(render);
    });
    const onVisibility = () => {
      visible = document.visibilityState === 'visible' && canvas.getBoundingClientRect().bottom > 0;
      if (visible && !frame) frame = requestAnimationFrame(render);
    };

    resize();
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); onUnavailable?.(); });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [onUnavailable]);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
