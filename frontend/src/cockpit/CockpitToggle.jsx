import { useState } from 'react';
import { useShipStore } from './useShipStore.js';
import './cockpit.css';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Top-right button that swaps between the galaxy overview and the flight deck.
// onEnter / onExit are supplied by App so it can also clear any open NodeCard.
export default function CockpitToggle({ onEnter, onExit }) {
  const mode = useShipStore((s) => s.mode);
  const [fading, setFading] = useState(false);
  const inCockpit = mode !== 'solar';

  const go = async (fn) => {
    setFading(true);
    await wait(380); fn(); await wait(360);
    setFading(false);
  };

  return (
    <>
      <button className="fd-toggle" onClick={() => go(inCockpit ? onExit : onEnter)}>
        <span className="dot" />
        {inCockpit ? 'EXIT COCKPIT' : 'ENTER COCKPIT'}
      </button>

      {inCockpit && (
        <div className="fd-cockhint">
          <span className="fd-chip">DRAG <b>look</b></span>
          <span className="fd-chip">WASD <b>walk</b></span>
          <span className="fd-chip">SCREEN <b>pick destination</b></span>
        </div>
      )}

      <div className={`fd-fade ${fading ? 'on' : ''}`} />
    </>
  );
}
