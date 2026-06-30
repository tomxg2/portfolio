import { useEffect, useState } from 'react';
import { Headset } from 'lucide-react';
import { xrStore } from '../lib/xrStore.js';

// "Enter VR" button. Only renders when the browser advertises immersive-vr
// support (so it stays hidden on desktops without a headset / on mobile).
export default function VRButton() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const xr = navigator.xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported('immersive-vr').then((ok) => setSupported(!!ok)).catch(() => {});
  }, []);

  if (!supported) return null;

  return (
    <button
      onClick={() => xrStore.enterVR()}
      className="lg-surface lg-pill w-8 h-8 text-gray-300
                 hover:text-white transition-colors flex items-center justify-center flex-shrink-0"
      aria-label="Enter VR"
      title="Enter VR (immersive)"
    >
      <Headset size={14} strokeWidth={1.75} className="text-brand-teal" />
    </button>
  );
}
