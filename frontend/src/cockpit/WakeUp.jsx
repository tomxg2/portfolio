import { useEffect, useRef, useState } from 'react';
import './cockpit.css';

const LINES = ['...cryo-cycle complete', '...systems online', '...where am I?', 'welcome back, pilot'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// First-boarding gate, shared by every entry path (toggle button, 3D ship).
// Defaults to "seen" when storage is unavailable (private mode) so nobody
// gets stuck replaying the intro every visit.
const WAKE_KEY = 'fd-wake-seen';
export const seenWake = () => { try { return localStorage.getItem(WAKE_KEY) === '1'; } catch { return true; } };
export const markWake = () => { try { localStorage.setItem(WAKE_KEY, '1'); } catch { /* best effort */ } };

// Wake-up sequence for the FIRST cockpit entry (CockpitToggle gates it via
// localStorage): eyelids blink open over the live solar system → vision
// focuses → "take the controls". Click anywhere to skip ahead.
//
// onBoard  — fired at the fully-black point of the exit fade; flip the ship
//            store to cockpit here so the cut is invisible.
// onDone   — fired after fading back up; unmount the component.
export default function WakeUp({ onBoard, onDone }) {
  const [shut, setShut] = useState(true); // born with eyes closed
  const [clear, setClear] = useState(false);
  const [seat, setSeat] = useState(false);
  const [whisper, setWhisper] = useState('');
  const [fade, setFade] = useState(false);
  const ran = useRef(false);
  const skipped = useRef(false);
  const boarding = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    (async () => {
      const step = async (ms) => { await wait(ms); return !skipped.current; };
      if (!await step(700)) return; setShut(false);  // first slow open
      if (!await step(1000)) return; setShut(true);  // drowsy re-blink
      if (!await step(400)) return; setShut(false);
      if (!await step(600)) return; setClear(true);
      for (const l of LINES) {
        if (skipped.current) return;
        setWhisper(l); await wait(850);
      }
      setWhisper(''); setSeat(true);
    })();
  }, []);

  const skip = () => {
    if (seat || fade) return;
    skipped.current = true;
    setShut(false); setClear(true); setWhisper(''); setSeat(true);
  };

  const takeControls = async (e) => {
    e.stopPropagation();
    if (boarding.current) return; boarding.current = true;
    setSeat(false); setFade(true);
    await wait(550);   // fully black
    onBoard?.();       // ship store → cockpit while nothing is visible
    await wait(300);
    setFade(false);    // fade up onto the powering-on flight deck
    await wait(550);
    onDone?.();
  };

  return (
    <>
      <div className={`fd-boot ${shut ? 'shut' : ''}`} onClick={skip}>
        <div className="fd-lidT" /><div className="fd-lidB" />
        <div className={`fd-bc ${clear ? 'clear' : ''}`}>
          <div className="fd-w">{whisper}</div>
          <div className="fd-t">FLIGHT DECK</div>
          <div className="fd-s">Tom Hiestand · Interactive Portfolio</div>
          <button className={`fd-seat ${seat ? 'on' : ''}`} onClick={takeControls}>▸ TAKE THE CONTROLS</button>
        </div>
        {!seat && <div className="fd-skip">click to skip</div>}
      </div>
      <div className={`fd-fade ${fade ? 'on' : ''}`} />
    </>
  );
}
