// ── Ship sound design — pure WebAudio, fully synthesized, no assets ───────────
// Deliberately NOT built on Tone.js: MusicControl owns a Tone graph and ramps
// its own gain for mute, and keeping the ship on a separate AudioContext means
// neither system can ever silence or glitch the other.
//
// Everything is quiet by design — this is cabin ambience, not a soundtrack.
// The AudioContext is created lazily on first use; by then the user has
// clicked ENTER COCKPIT, so sticky user activation lets resume() succeed.

let ctx = null;
let master = null;
let hum = null; // { gain, stop() }
let noiseBuffer = null;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Low engine hum: two slightly detuned sines beat against each other, plus
// heavily low-passed noise for the "air system" bed. Fades in/out gently.
export function startHum() {
  if (!ensureCtx() || hum) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 2.5);
  gain.connect(master);

  const oscA = ctx.createOscillator();
  oscA.type = 'sine'; oscA.frequency.value = 55;
  const oscB = ctx.createOscillator();
  oscB.type = 'sine'; oscB.frequency.value = 55.7; // ~0.7Hz beat
  const oscGain = ctx.createGain(); oscGain.gain.value = 0.6;
  oscA.connect(oscGain); oscB.connect(oscGain); oscGain.connect(gain);

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(); noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.4;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.35;
  noise.connect(lp); lp.connect(noiseGain); noiseGain.connect(gain);

  oscA.start(); oscB.start(); noise.start();
  hum = {
    gain,
    stop() {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 1.2);
      [oscA, oscB, noise].forEach((n) => n.stop(t + 1.3));
      setTimeout(() => gain.disconnect(), 1500);
    },
  };
}

export function stopHum() {
  if (!hum) return;
  hum.stop();
  hum = null;
}

// Warp whoosh: band-passed noise swept up then released, with a rising drone
// underneath. Duration roughly matches the ~2.5s travel flight.
export function warpWhoosh() {
  if (!ensureCtx()) return;
  const t = ctx.currentTime;

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(); noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(160, t);
  bp.frequency.exponentialRampToValueAtTime(1900, t + 1.4);
  bp.frequency.exponentialRampToValueAtTime(320, t + 2.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.5);
  g.gain.setValueAtTime(0.16, t + 1.6);
  g.gain.linearRampToValueAtTime(0, t + 2.9);
  noise.connect(bp); bp.connect(g); g.connect(master);
  noise.start(t); noise.stop(t + 3);

  const drone = ctx.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.setValueAtTime(70, t);
  drone.frequency.exponentialRampToValueAtTime(240, t + 2.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(0, t);
  dg.gain.linearRampToValueAtTime(0.05, t + 0.6);
  dg.gain.linearRampToValueAtTime(0, t + 2.8);
  drone.connect(lp); lp.connect(dg); dg.connect(master);
  drone.start(t); drone.stop(t + 3);
}

function beep(freq, dur, vol, type = 'sine', when = 0) {
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// Soft tick when the nav cursor moves onto a new row.
export function hoverBlip() {
  if (!ensureCtx()) return;
  beep(660, 0.06, 0.04);
}

// Two-tone confirm when a destination is engaged.
export function engageBeep() {
  if (!ensureCtx()) return;
  beep(740, 0.09, 0.07);
  beep(1108, 0.14, 0.07, 'sine', 0.09);
}

// Gentle arrival chime when the ship reaches the destination.
export function arrivalChime() {
  if (!ensureCtx()) return;
  beep(880, 0.25, 0.05);
  beep(1318, 0.35, 0.04, 'sine', 0.12);
}
