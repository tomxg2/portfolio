import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Rocket, LogOut } from 'lucide-react';
import { useShipStore } from './useShipStore.js';
import './cockpit.css';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Coarse pointer = touch device: no keyboard, so don't advertise WASD.
const IS_TOUCH = typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)')?.matches;

// Glass pill that swaps between the galaxy overview and the flight deck.
// Sits in App's top-right control row; amber is the ship's colour (same as
// the 3D ship's label), so the button reads as "board that ship".
// onEnter / onExit are supplied by App — App also owns the first-boarding
// WakeUp intro, so entering via this button or the 3D ship behaves the same.
export default function CockpitToggle({ onEnter, onExit }) {
  const mode = useShipStore((s) => s.mode);
  const [fading, setFading] = useState(false);
  const inCockpit = mode !== 'solar';

  const go = async (fn) => {
    setFading(true);
    await wait(380); fn(); await wait(360);
    setFading(false);
  };

  const Icon = inCockpit ? LogOut : Rocket;
  const label = inCockpit ? 'Exit cockpit' : 'Enter cockpit';

  return (
    <>
      <button
        className="lg-surface lg-pill flex items-center gap-2 h-9 px-3 sm:px-4 text-[12px] font-mono
                   uppercase tracking-[0.12em] text-[#ffd59a] hover:text-white"
        onClick={() => go(inCockpit ? onExit : onEnter)}
        aria-label={label}
        title={label}
      >
        <Icon size={14} strokeWidth={1.9} className="text-[#ffb454]" />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {/* Overlays are portalled: the control row animates in with a transform,
          which would otherwise become the containing block for these fixed layers */}
      {createPortal(
        <>
          {inCockpit && (
            <div className="fd-cockhint">
              <span className="fd-chip">DRAG <b>look</b></span>
              {!IS_TOUCH && <span className="fd-chip">WASD <b>walk</b></span>}
              <span className="fd-chip">SCREEN <b>pick destination</b></span>
            </div>
          )}
          <div className={`fd-fade ${fading ? 'on' : ''}`} />
        </>,
        document.body
      )}
    </>
  );
}
