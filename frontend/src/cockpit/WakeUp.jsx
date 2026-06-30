import { useEffect, useRef, useState } from 'react';
import { useShipStore } from './useShipStore.js';
import './cockpit.css';

const LINES = ['...cryo-cycle complete', '...systems online', '...where am I?', 'welcome back, pilot'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Wake-up sequence: eyes blink open → vision focuses → "take the controls".
// On click it fades to black, flips the ship store to `cockpit`, and unmounts.
export default function WakeUp() {
  const board = useShipStore((s) => s.board);
  const [shut, setShut] = useState(false);
  const [clear, setClear] = useState(false);
  const [seat, setSeat] = useState(false);
  const [whisper, setWhisper] = useState('');
  const [fade, setFade] = useState(false);
  const [gone, setGone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    (async () => {
      await wait(600); setShut(true); await wait(850); setShut(false);
      await wait(450); setShut(true); await wait(480); setShut(false);
      setClear(true);
      for (const l of LINES) { setWhisper(l); await wait(850); }
      setWhisper(''); setSeat(true);
    })();
  }, []);

  if (gone) return null;

  const takeControls = async () => {
    setSeat(false); setFade(true);
    await wait(500);
    board();           // → mode 'cockpit'
    setGone(true);
  };

  return (
    <>
      <div className={`fd-boot ${shut ? 'shut' : ''}`}>
        <div className="fd-lidT" /><div className="fd-lidB" />
        <div className={`fd-bc ${clear ? 'clear' : ''}`}>
          <div className="fd-w">{whisper}</div>
          <div className="fd-t">FLIGHT DECK</div>
          <div className="fd-s">Tom Hiestand · Interactive Portfolio</div>
          <button className={`fd-seat ${seat ? 'on' : ''}`} onClick={takeControls}>▸ TAKE THE CONTROLS</button>
        </div>
      </div>
      <div className={`fd-fade ${fade ? 'on' : ''}`} />
    </>
  );
}
