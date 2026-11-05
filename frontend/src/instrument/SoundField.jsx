import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const POINTS = 144;
const ROWS = 28;

function Ribbon({ row, signalRef, color, reducedMotion }) {
  const lineRef = useRef(null);
  const positions = useMemo(() => new Float32Array(POINTS * 3), []);
  const { viewport } = useThree();

  useFrame(({ clock }) => {
    const signal = signalRef.current;
    const time = reducedMotion && !signal.active ? 0 : clock.elapsedTime;
    const halfWidth = viewport.width * 0.44;
    const pitch = (signal.x - 0.5) * 2;
    const energy = signal.active ? 0.24 + signal.brightness * 0.3 + signal.level * 2 : 0.045;
    for (let point = 0; point < POINTS; point++) {
      const position = point / (POINTS - 1) * 2 - 1;
      const envelope = Math.exp(-Math.pow((position - pitch * 0.5) * 2, 2));
      const sample = signal.waveform?.[point % 128] || 0;
      positions[point * 3] = position * halfWidth;
      positions[point * 3 + 1] = (row / (ROWS - 1) - 0.5) * Math.min(3.5, viewport.height * 0.55)
        + envelope * (Math.sin(position * (8 + signal.brightness * 10) + time * 1.6 - row * 0.24) * energy + sample * 1.7);
      positions[point * 3 + 2] = Math.sin(position * 2.7 + row * 0.15 + time * 0.13) * 0.4;
    }
    if (lineRef.current) lineRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <line ref={lineRef} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} usage={THREE.DynamicDrawUsage} /></bufferGeometry>
      <lineBasicMaterial color={row % 7 === 0 ? '#f7edd2' : color} transparent opacity={row % 7 === 0 ? 0.8 : 0.38} depthWrite={false} />
    </line>
  );
}

function Field({ signalRef, color, reducedMotion }) {
  const groupRef = useRef(null);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const signal = signalRef.current;
    const target = signal.active ? (signal.x - 0.5) * 0.1 : 0;
    groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, target, 4, delta);
  });
  return (
    <group ref={groupRef} rotation={[0.12, 0, 0]}>
      {Array.from({ length: ROWS }, (_, row) => <Ribbon key={row} row={row} signalRef={signalRef} color={color} reducedMotion={reducedMotion} />)}
    </group>
  );
}

class VisualBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="airform-visual-fallback">3D visual unavailable</div> : this.props.children;
  }
}

export default function SoundField({ signalRef, color }) {
  const [supported, setSupported] = useState(null);
  const [visible, setVisible] = useState(!document.hidden);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(media.matches);
    const onVisibility = () => setVisible(!document.hidden);
    onMotion();
    media.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    try {
      const context = document.createElement('canvas').getContext('webgl2');
      setSupported(!!context);
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { setSupported(false); }
    return () => {
      media.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (supported === null) return null;
  if (!supported) return <div className="airform-visual-fallback">3D visual unavailable</div>;

  return (
    <VisualBoundary>
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 1.5]} frameloop={visible ? 'always' : 'never'} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
        <Field signalRef={signalRef} color={color} reducedMotion={reducedMotion} />
      </Canvas>
    </VisualBoundary>
  );
}