export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  pentatonic: { label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  major: { label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
};

export const VOICES = {
  glass: { label: 'Glass', color: '#8de4d6', harmonicity: 3, modulationIndex: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.012, decay: 0.25, sustain: 0.55, release: 0.9 } },
  reed: { label: 'Reed', color: '#f8b88e', harmonicity: 1, modulationIndex: 5, oscillator: { type: 'sine' }, envelope: { attack: 0.06, decay: 0.2, sustain: 0.8, release: 0.45 } },
  current: { label: 'Current', color: '#b6c4ff', harmonicity: 1.5, modulationIndex: 1.2, oscillator: { type: 'triangle' }, envelope: { attack: 0.018, decay: 0.18, sustain: 0.7, release: 0.6 } },
};

export function normalized(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export function makeScale(root = 'D', scale = 'pentatonic') {
  const rootIndex = NOTE_NAMES.indexOf(root);
  if (rootIndex < 0 || !SCALES[scale]) throw new RangeError('Unknown key or scale');
  const intervals = SCALES[scale].intervals;
  return [...intervals, ...intervals.map((interval) => interval + 12), 24].map((interval) => {
    const midi = 48 + rootIndex + interval;
    return { midi, label: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}` };
  });
}

export function noteAtPosition(notes, position) {
  return notes[Math.min(notes.length - 1, Math.floor(normalized(position) * notes.length))] ?? null;
}

export async function createInstrument({ volume = 0.55, space = 0.45, voice = 'glass' } = {}) {
  const Tone = await import('tone');
  await Tone.start();

  const limiter = new Tone.Limiter(-2).toDestination();
  const master = new Tone.Gain(normalized(volume) * 0.7).connect(limiter);
  const silence = new Tone.Zero().connect(master);
  const delay = new Tone.FeedbackDelay({ delayTime: 0.27, feedback: 0.22, wet: normalized(space) * 0.3 }).connect(master);
  const reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.025, wet: normalized(space) * 0.65 }).connect(delay);
  const filter = new Tone.Filter({ frequency: 2200, type: 'lowpass', Q: 0.7, rolloff: -12 }).connect(reverb);
  const synth = new Tone.FMSynth({
    harmonicity: 3,
    modulationIndex: 2,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.012, decay: 0.25, sustain: 0.55, release: 0.9 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.8 },
    portamento: 0.055,
    volume: -12,
  }).connect(filter);
  const analyser = new Tone.Waveform(128);
  limiter.connect(analyser);
  const mimeType = typeof MediaRecorder === 'function'
    ? ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) =>
      MediaRecorder.isTypeSupported(type) && document.createElement('audio').canPlayType(type))
    : null;
  const recorder = mimeType ? new Tone.Recorder({ mimeType }) : null;
  if (recorder) limiter.connect(recorder);

  let activeMidi = null;
  let currentVoice = voice;
  let disposed = false;

  const setVoice = (id) => {
    const selected = VOICES[id];
    if (!selected || disposed) return;
    currentVoice = id;
    const { harmonicity, modulationIndex, oscillator, envelope } = selected;
    synth.set({ harmonicity, modulationIndex, oscillator, envelope });
  };
  setVoice(voice);

  return {
    recordingSupported: !!recorder,
    async resume() { if (!disposed) await Tone.start(); },
    play(midi, brightness = 0.5) {
      if (disposed || !Number.isFinite(midi)) return;
      const frequency = Tone.Frequency(midi, 'midi').toFrequency();
      const tone = normalized(brightness);
      filter.frequency.rampTo(350 + tone * tone * 6500, 0.06);
      synth.modulationIndex.rampTo(VOICES[currentVoice].modulationIndex * (0.3 + tone * 1.7), 0.06);
      if (activeMidi === null) synth.triggerAttack(frequency, Tone.now(), 0.7);
      else if (activeMidi !== midi) synth.setNote(frequency, Tone.now());
      activeMidi = midi;
    },
    release() {
      if (!disposed && activeMidi !== null) synth.triggerRelease(Tone.now());
      activeMidi = null;
    },
    setVoice,
    setVolume(value) { if (!disposed) master.gain.rampTo(normalized(value) * 0.7, 0.05); },
    setSpace(value) {
      if (disposed) return;
      reverb.wet.rampTo(normalized(value) * 0.65, 0.15);
      delay.wet.rampTo(normalized(value) * 0.3, 0.15);
    },
    waveform() { return disposed ? new Float32Array(128) : analyser.getValue(); },
    async startRecording() {
      if (!recorder || disposed) throw new Error('Audio recording is not supported in this browser.');
      await recorder.start();
    },
    async stopRecording() {
      if (!recorder || disposed) throw new Error('The recorder is unavailable.');
      return recorder.stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (recorder?.state === 'started') recorder.stop().catch(() => {}).finally(() => recorder.dispose());
      else recorder?.dispose();
      [synth, filter, reverb, delay, silence, master, analyser, limiter].forEach((node) => node.dispose());
    },
  };
}