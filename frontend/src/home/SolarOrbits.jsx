import { useEffect, useRef } from 'react';

// Live echo of the /lab solar system for the project card: planets drift on
// their orbits and the system tilts a little toward the pointer.

const WIDTH = 1600;
const HEIGHT = 660;
const CX = 800;
const CY = 330;
const PLANETS = [
  { label: 'Contact', r: 150, size: 9, color: '#9ff3dc', speed: 0.5, phase: 0.4 },
  { label: 'Skills', r: 240, size: 15, color: '#7aa7ff', speed: 0.33, phase: 2.1 },
  { label: 'Experience', r: 330, size: 12, color: '#ff9a5c', speed: 0.24, phase: 4.0 },
  { label: 'Projects', r: 430, size: 14, color: '#d9c9ff', speed: 0.17, phase: 5.3, ring: true },
  { label: 'Learning', r: 530, size: 9, color: '#8fe3a0', speed: 0.12, phase: 1.2 },
  { label: 'Interests', r: 630, size: 11, color: '#ffc4dd', speed: 0.09, phase: 3.2 },
];

export default function SolarOrbits({ animate }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    const groups = Array.from(svg.querySelectorAll('[data-planet]'));
    const orbits = Array.from(svg.querySelectorAll('[data-orbit]'));
    let tilt = 0.32;
    let target = 0.32;
    let frame = 0;
    let visible = false;
    const start = performance.now();

    const draw = (t) => {
      const squash = tilt;
      orbits.forEach((orbit, i) => orbit.setAttribute('ry', (PLANETS[i].r * squash).toFixed(1)));
      groups.forEach((group, i) => {
        const p = PLANETS[i];
        const a = p.phase + t * p.speed;
        const x = CX + Math.cos(a) * p.r;
        const y = CY + Math.sin(a) * p.r * squash;
        const depth = 0.75 + 0.25 * Math.sin(a);
        group.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${depth.toFixed(3)})`);
      });
    };
    const tick = () => {
      frame = 0;
      tilt += (target - tilt) * 0.06;
      draw((performance.now() - start) / 1000);
      if (visible) frame = requestAnimationFrame(tick);
    };

    draw(6);
    if (!animate) return undefined;

    const host = svg.parentElement;
    const onMove = (event) => {
      const rect = svg.getBoundingClientRect();
      target = 0.22 + ((event.clientY - rect.top) / rect.height) * 0.22;
    };
    const onLeave = () => { target = 0.32; };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) frame = requestAnimationFrame(tick);
    });
    observer.observe(svg);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [animate]);

  return (
    <svg ref={svgRef} className="solar-orbits" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="solar-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff4d6" />
          <stop offset="0.35" stopColor="#ffc46b" />
          <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {PLANETS.map((p) => (
        <ellipse key={p.label} data-orbit="" cx={CX} cy={CY} rx={p.r} ry={p.r * 0.32} fill="none" stroke={p.color} strokeOpacity="0.28" strokeWidth="1.4" />
      ))}
      <circle cx={CX} cy={CY} r="150" fill="url(#solar-sun)" opacity="0.55" />
      <circle cx={CX} cy={CY} r="34" fill="#ffd27a" />
      {PLANETS.map((p) => (
        <g key={p.label} data-planet="">
          {p.ring && <ellipse rx={p.size * 2} ry={p.size * 0.55} fill="none" stroke={p.color} strokeOpacity="0.7" strokeWidth="2" />}
          <circle r={p.size} fill={p.color} />
          <text x={p.size + 8} y="5" fill="#ecebe4" fillOpacity="0.75" fontSize="18" fontFamily="'Inter Tight', sans-serif">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
