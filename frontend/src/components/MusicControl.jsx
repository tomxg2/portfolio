import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

// Generative ambient music — one shared Tone.js graph that switches its
// harmonic mood based on which planet is in focus. Pure synth, no audio
// assets. Off by default; the user toggles it on with a glass pill button.
//
// Each category maps to a chord. We pick the chord from a deterministic
// progression every ~8 bars so the music breathes instead of looping.
export default function MusicControl({ focusedCategory }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady]     = useState(false);
  const refs = useRef({ Tone: null, synth: null, reverb: null, filter: null, loop: null });
  const focusedRef = useRef(focusedCategory);

  // Track the latest category without re-creating the audio graph
  useEffect(() => { focusedRef.current = focusedCategory; }, [focusedCategory]);

  // Lazy-load Tone.js only when the user first enables sound
  useEffect(() => {
    if (!enabled || refs.current.Tone) return;
    let cancelled = false;
    (async () => {
      const Tone = await import('tone');
      if (cancelled) return;
      await Tone.start();
      // Build the graph: Synth → filter → reverb → master
      const reverb = new Tone.Reverb({ decay: 8, wet: 0.55 }).toDestination();
      const filter = new Tone.Filter(820, 'lowpass').connect(reverb);
      filter.Q.value = 0.6;
      const synth = new Tone.PolySynth(Tone.AmSynth, {
        harmonicity: 1.5,
        oscillator: { type: 'sine' },
        envelope:   { attack: 2.2, decay: 1.0, sustain: 0.65, release: 4.5 },
        modulationEnvelope: { attack: 1.2, decay: 0.8, sustain: 0.5, release: 3.0 },
        volume: -22,
      }).connect(filter);

      // Chord palette per category — each pad lives in a different key/mood
      const CHORDS = {
        about:    ['C3', 'E3', 'G3', 'B3'],         // soft major
        work:     ['A2', 'C3', 'E3', 'G3'],         // contemplative minor 7
        creative: ['D3', 'F#3', 'A3', 'C#4'],       // bright lifted
        default:  ['G2', 'B2', 'D3', 'F#3'],        // wandering open
      };

      // Fire every measure (~4.3s at 56 BPM). Chord sustains exactly one
      // measure, so when the user switches planet, the next chord change
      // happens within ~4 seconds — slow enough to feel ambient, fast enough
      // to actually hear the change.
      let bar = 0;
      const loop = new Tone.Loop((time) => {
        const cat = focusedRef.current || 'default';
        const chord = CHORDS[cat] || CHORDS.default;
        synth.triggerAttackRelease(chord, '1m', time, 0.45);
        filter.frequency.rampTo(700 + Math.sin(bar * 0.7) * 220, 4);
        bar++;
      }, '1m').start(0);
      Tone.Transport.bpm.value = 56;
      Tone.Transport.start();

      refs.current = { Tone, synth, reverb, filter, loop };
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  // Master gain ramp on toggle
  useEffect(() => {
    const { Tone } = refs.current;
    if (!Tone) return;
    Tone.Destination.volume.rampTo(enabled ? 0 : -80, 0.6);
  }, [enabled]);

  return (
    <button
      onClick={() => setEnabled((v) => !v)}
      className="lg-surface lg-pill w-8 h-8 text-gray-300
                 hover:text-white transition-colors flex items-center justify-center flex-shrink-0"
      aria-label={enabled ? 'Mute ambient music' : 'Play ambient music'}
      title={enabled ? 'Mute ambient music' : 'Play ambient music'}
    >
      {enabled ? (
        <Volume2 size={14} strokeWidth={1.75} className="text-brand-teal" />
      ) : (
        <VolumeX size={14} strokeWidth={1.75} />
      )}
    </button>
  );
}
