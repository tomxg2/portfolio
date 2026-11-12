import { useEffect, useRef } from 'react';

// Lightweight SVG echo of Airform's wave field for the project card.
// Lines drift on their own and bend toward the pointer, like the instrument.

const LINES = 22;
const POINTS = 64;
const WIDTH = 1600;
const HEIGHT = 600;

function pathFor(line, time, pointer) {
  const base = 120 + (line / (LINES - 1)) * 360;
  const inset = 60 + Math.abs(line - LINES / 2) * 6;
  let d = '';
  for (let i = 0; i <= POINTS; i++) {
    const t = i / POINTS;
    const x = inset + t * (WIDTH - inset * 2);
    const envelope = Math.sin(Math.PI * t) ** 1.4;
    let y = base
      + Math.sin(t * 7.5 + time * 0.6 + line * 0.18) * 34 * envelope
      + Math.sin(t * 3.1 - time * 0.4 + line * 0.07) * 52 * envelope;
    if (pointer) {
      const dx = (x - pointer.x) / 260;
      const pull = Math.exp(-dx * dx) * (pointer.y - base) * 0.55 * envelope;
      y += pull;
    }
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export default function AirformWaves({ animate }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    const paths = Array.from(svg.querySelectorAll('path'));
    let pointer = null;
    let target = null;
    let frame = 0;
    let visible = false;
    const start = performance.now();

    const draw = (time) => {
      paths.forEach((path, line) => path.setAttribute('d', pathFor(line, time, pointer)));
    };
    const tick = () => {
      frame = 0;
      if (target) pointer = pointer ? { x: pointer.x + (target.x - pointer.x) * 0.12, y: pointer.y + (target.y - pointer.y) * 0.12 } : target;
      else if (pointer) pointer = null;
      draw((performance.now() - start) / 1000);
      if (visible) frame = requestAnimationFrame(tick);
    };

    draw(2.2);
    if (!animate) return undefined;

    const host = svg.parentElement;
    const onMove = (event) => {
      const rect = svg.getBoundingClientRect();
      target = { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
    };
    const onLeave = () => { target = null; };
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
    <svg ref={svgRef} className="airform-waves" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="airform-stroke" x1="0" x2="1">
          <stop offset="0" stopColor="#9ff3dc" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#e9fff7" stopOpacity="0.9" />
          <stop offset="1" stopColor="#9ff3dc" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {Array.from({ length: LINES }, (_, line) => (
        <path key={line} fill="none" stroke="url(#airform-stroke)" strokeWidth={line % 5 === 2 ? 1.6 : 0.9} opacity={0.35 + (line % 5 === 2 ? 0.5 : 0.25)} />
      ))}
    </svg>
  );
}
