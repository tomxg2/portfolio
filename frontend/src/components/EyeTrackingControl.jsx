import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, X, Target, Sparkles, RotateCcw, ScanLine } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Iris-based gaze tracking via MediaPipe FaceLandmarker, with a 9-point ridge-
// regression calibration step. The webcam can't beat a Tobii (no IR cornea
// glint, much lower frame-rate, no calibrated camera-to-screen geometry) — but
// with a real calibration step we land at roughly ~3-5° angular accuracy,
// the practical ceiling for sub-RGB tracking. Plenty for hitting planets.
//
// Pipeline:
//   1) 1280×720 webcam stream (more iris pixels = sharper landmark).
//   2) MediaPipe FaceLandmarker emits 478 landmarks + blendshapes per frame.
//   3) On startup we either load a saved calibration model from localStorage
//      or run the 9-point calibration sequence (CalibrationOverlay).
//   4) At runtime, build a 10-feature polynomial vector from the iris + nose
//      positions and apply two trained ridge models (x and y) to get the
//      screen-normalized pointer (0..1).
//   5) The output plugs into the SAME GestureRaycaster + dwell pipeline that
//      hand tracking uses. Blink (both eyes ≥ 0.55 for 280–700 ms) = back.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

// ── Blink-for-back tuning ────────────────────────────────────────────────────
// `score` is `(left + right) / 2` plus a "both must clearly close" floor: we
// only accept the blink if BOTH eyes are above SOFT_FLOOR. That rejects
// winks/asymmetric squints without rejecting real blinks where one eye
// scores higher than the other (very common — MediaPipe blendshapes are
// noisy with one-sided lighting).
const BLINK_THRESHOLD  = 0.50;   // averaged score to register as "closed"
const BLINK_SOFT_FLOOR = 0.32;   // both eyes must clear this — kills winks
const MIN_BLINK_MS     = 200;    // shorter = involuntary, ignore
const MAX_BLINK_MS     = 750;
const PALM_HOLD_FRAMES = 3;      // hold longer so App's useEffect always sees it

// ── Calibration tuning ───────────────────────────────────────────────────────
// Zig-zag through a 3×3 grid so the user's eyes never have to jump diagonally.
// Inset from the edges so the target is always comfortably visible.
const CALIB_TARGETS = [
  [0.10, 0.15], [0.50, 0.15], [0.90, 0.15],
  [0.90, 0.50], [0.50, 0.50], [0.10, 0.50],
  [0.10, 0.85], [0.50, 0.85], [0.90, 0.85],
];
// Gaze-stability gating: a sample only counts when the iris position has
// been still (low variance over the last STABILITY_WINDOW_MS) — i.e. the
// user is actually fixating somewhere. Without this, the calibration
// "auto-confirms" on a timer regardless of where the user is looking, so
// the regression learns garbage. Variance is computed on normalised iris
// coords (0..1), where the iris itself spans ~10 % of the frame, so even
// careful gaze drift sits well above the threshold.
const ARM_MAX_MS              = 4000;  // hard cap waiting for first stable fix
const COLLECT_TIMEOUT_MS      = 6000;  // hard cap for collection
const LOCKIN_MS               = 260;   // confirmation flash
const STABILITY_WINDOW_MS     = 220;   // sliding window for variance check
const STABILITY_VAR_THRESHOLD = 6e-5;  // squared-radius variance ≤ this = stable
const SAMPLES_PER_TARGET      = 22;    // stable samples required to advance
const RIDGE_LAMBDA            = 1e-3;
const STORAGE_KEY             = 'eyeCalibrationModel_v3';
const MAX_TRAINING_RESIDUAL   = 0.18;  // mean abs error on train set must be below this

// ── Landmark indices ─────────────────────────────────────────────────────────
const IDX_NOSE         = 1;
const IDX_RIGHT_IRIS   = 468;
const IDX_LEFT_IRIS    = 473;
const EYE_CONTOUR_RIGHT = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const EYE_CONTOUR_LEFT  = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];

// ─────────────────────────────────────────────────────────────────────────────
// Math: solve A x = b for symmetric positive-definite A (Gauss-Jordan with
// partial pivoting). Used by the ridge regression below. Pure-JS, no deps.
// ─────────────────────────────────────────────────────────────────────────────
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i, pv = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > pv) { pv = Math.abs(M[r][i]); pivot = r; }
    }
    if (pv < 1e-12) return null;
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot], M[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// Ridge regression: minimise ‖Xθ − y‖² + λ‖θ‖². Closed-form solution:
//   θ = (XᵀX + λI)⁻¹ Xᵀy
// X is (samples × m), y is (samples). Returns θ (m-vector), or null if X is
// degenerate. We solve via solveLinearSystem rather than computing an
// explicit inverse — same result, no spurious matrix inversion.
function ridgeFit(X, y, lambda) {
  const N = X.length;
  if (N === 0) return null;
  const m = X[0].length;
  const XtX = Array.from({ length: m }, () => new Array(m).fill(0));
  const Xty = new Array(m).fill(0);
  for (let i = 0; i < N; i++) {
    const xi = X[i], yi = y[i];
    for (let j = 0; j < m; j++) {
      Xty[j] += xi[j] * yi;
      const xij = xi[j];
      for (let k = j; k < m; k++) XtX[j][k] += xij * xi[k];
    }
  }
  // Mirror upper to lower (XtX is symmetric)
  for (let j = 0; j < m; j++) for (let k = j + 1; k < m; k++) XtX[k][j] = XtX[j][k];
  for (let j = 0; j < m; j++) XtX[j][j] += lambda;
  return solveLinearSystem(XtX, Xty);
}

// 10-feature polynomial: bias, raw iris (ix, iy), raw head pose (hx, hy),
// pairwise iris/head interactions + iris² terms. Captures both linear gaze
// AND the head-pose offset that shifts the iris-to-screen mapping.
function buildFeatures(ix, iy, hx, hy) {
  return [1, ix, iy, hx, hy, ix * iy, ix * ix, iy * iy, hx * ix, hy * iy];
}
function applyModel(features, theta) {
  let s = 0;
  for (let i = 0; i < features.length; i++) s += features[i] * theta[i];
  return s;
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function loadSavedModel() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.thetaX || !obj?.thetaY) return null;
    if (obj.thetaX.length !== 10 || obj.thetaY.length !== 10) return null;
    return { thetaX: obj.thetaX, thetaY: obj.thetaY, calibratedAt: obj.calibratedAt };
  } catch {
    return null;
  }
}
function saveModel(thetaX, thetaY) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      thetaX, thetaY, calibratedAt: Date.now(),
    }));
  } catch {}
}
function clearSavedModel() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function EyeTrackingControl({ onTrackingData }) {
  const [supported, setSupported] = useState(true);
  const [active, setActive]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [gesture, setGesture]     = useState('none');

  // Phase: 'idle' | 'calibrating' | 'tracking'
  const [phase, setPhase]         = useState('idle');

  // Calibration UI tick state — only updates between sub-phases so React
  // re-renders are cheap. Per-frame progress is read from calibProgressRef.
  const [calibUiTick, setCalibUiTick] = useState({ targetIdx: 0, subPhase: 'welcome' });

  const dataRef          = useRef({ pointerNorm: null });
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const landmarkerRef    = useRef(null);
  const streamRef        = useRef(null);
  const rafRef           = useRef(null);
  const smoothRef        = useRef({ x: 0.5, y: 0.5 });
  const blinkRef         = useRef({ closed: false, closedAt: 0 });
  const palmCountdown    = useRef(0);
  const committedGesture = useRef('none');
  const mountedRef       = useRef(true);
  const busyRef          = useRef(false);

  // Trained model (loaded from storage or freshly trained)
  const modelRef         = useRef(null);  // { thetaX, thetaY }
  // Mirror of `phase` for use inside the detection loop's closure (which
  // captures the value at start() time and would otherwise go stale once
  // calibration → tracking transitions).
  const phaseRef         = useRef('idle');

  // Live calibration sampling state. The detection loop reads + writes this
  // ref to advance through targets without re-rendering on every frame.
  const calibRef = useRef({
    active: false,
    targetIdx: 0,
    subPhase: 'welcome',     // 'welcome' | 'arming' | 'collecting' | 'lockin' | 'done'
    phaseStart: 0,
    samples: [],             // flat: { ix, iy, hx, hy, tx, ty }
    stableForTarget: 0,      // stable samples collected for the current target
  });
  // Per-frame progress + stability state — the UI's CalibDot reads these in
  // its own rAF so we don't re-render every frame.
  const calibProgressRef  = useRef(0); // 0..1, "how full is the current target"
  const calibStableRef    = useRef(false); // is the iris stable right now?
  // Sliding window of recent iris positions — used to detect "user is fixating"
  // rather than "user is glancing around". Drives the stability gate.
  const irisHistoryRef    = useRef([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Surface state changes to App so the unified gestureData pipeline picks it
  // up. Pointer data rides on dataRef (no re-render).
  useEffect(() => {
    phaseRef.current = phase;
    onTrackingData?.({ dataRef, gesture, isActive: active && phase === 'tracking' });
  }, [active, phase, gesture, onTrackingData]);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.cancelVideoFrameCallback) {
        try { videoRef.current.cancelVideoFrameCallback(rafRef.current); } catch {}
      }
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    blinkRef.current = { closed: false, closedAt: 0 };
    palmCountdown.current = 0;
    busyRef.current = false;
    dataRef.current.pointerNorm = null;
    committedGesture.current = 'none';
    calibRef.current = {
      active: false, targetIdx: 0, subPhase: 'welcome',
      phaseStart: 0, samples: [], stableForTarget: 0,
    };
    calibProgressRef.current = 0;
    calibStableRef.current = false;
    irisHistoryRef.current = [];
    setGesture('none');
    setPhase('idle');
    setActive(false);
  }, []);

  // Draw face mesh overlay on the preview canvas.
  const drawOverlay = useCallback((landmarks, ctx, w, h, gestureNow) => {
    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;
    const drawContour = (idxs, colour) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      idxs.forEach((i, k) => {
        const p = landmarks[i];
        if (!p) return;
        const x = p.x * w, y = p.y * h;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
    };
    const eyeColour = gestureNow === 'palm' ? 'rgba(255, 95, 95, 0.9)' : 'rgba(0, 255, 204, 0.85)';
    drawContour(EYE_CONTOUR_RIGHT, eyeColour);
    drawContour(EYE_CONTOUR_LEFT,  eyeColour);
    ctx.fillStyle = '#00ffcc';
    [landmarks[IDX_RIGHT_IRIS], landmarks[IDX_LEFT_IRIS]].forEach((p) => {
      if (!p) return;
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2); ctx.fill();
    });
    const nose = landmarks[IDX_NOSE];
    if (nose) {
      ctx.fillStyle = 'rgba(0, 255, 204, 0.45)';
      ctx.beginPath(); ctx.arc(nose.x * w, nose.y * h, 2, 0, Math.PI * 2); ctx.fill();
    }
  }, []);

  // Train the model from the collected calibration samples and persist it.
  // Quality gate: refuse the model if the training-set residual is too high
  // — that means the samples didn't actually match the prompted targets
  // (user wasn't looking) and accepting the model would lock in garbage.
  const trainAndPersist = useCallback(() => {
    const samples = calibRef.current.samples;
    if (samples.length < SAMPLES_PER_TARGET * 4) return false; // need real coverage
    const X = samples.map((s) => buildFeatures(s.ix, s.iy, s.hx, s.hy));
    const yX = samples.map((s) => s.tx);
    const yY = samples.map((s) => s.ty);
    const thetaX = ridgeFit(X, yX, RIDGE_LAMBDA);
    const thetaY = ridgeFit(X, yY, RIDGE_LAMBDA);
    if (!thetaX || !thetaY) return false;

    // Mean abs residual on the training set. If the model can't even fit
    // its own training data within 18 % of the screen, the calibration was
    // junk (user wasn't actually fixating on the targets) and we throw it
    // out instead of saving garbage.
    let residual = 0;
    for (let i = 0; i < X.length; i++) {
      const pX = applyModel(X[i], thetaX);
      const pY = applyModel(X[i], thetaY);
      residual += Math.abs(pX - yX[i]) + Math.abs(pY - yY[i]);
    }
    residual /= (X.length * 2);
    if (residual > MAX_TRAINING_RESIDUAL) {
      modelRef.current = null;
      return false;
    }
    modelRef.current = { thetaX, thetaY };
    saveModel(thetaX, thetaY);
    return true;
  }, []);

  // Begin / restart the calibration sequence (used by the welcome screen
  // "Start" button + the "Recalibrate" button in the preview).
  const beginCalibration = useCallback(() => {
    calibRef.current = {
      active: true,
      targetIdx: 0,
      subPhase: 'arming',
      phaseStart: performance.now(),
      samples: [],
      stableForTarget: 0,
    };
    calibProgressRef.current = 0;
    calibStableRef.current = false;
    irisHistoryRef.current = [];
    setCalibUiTick({ targetIdx: 0, subPhase: 'arming' });
    setPhase('calibrating');
  }, []);

  const skipCalibration = useCallback(() => {
    // No model = use identity-ish fallback (raw iris position with simple
    // amplification). Better UX than blocking the user behind calibration.
    modelRef.current = null;
    setPhase('tracking');
  }, []);

  const recalibrate = useCallback(() => {
    clearSavedModel();
    modelRef.current = null;
    beginCalibration();
  }, [beginCalibration]);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });
      }

      // 1280×720 — sharper iris detection. Browser will downsample to whatever
      // the webcam supports if 720p isn't available (constraint is ideal, not required).
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
      await v.play();

      setActive(true);
      setLoading(false);

      // Decide initial phase: saved model → straight to tracking; otherwise
      // open the calibration welcome screen.
      const saved = loadSavedModel();
      if (saved) {
        modelRef.current = { thetaX: saved.thetaX, thetaY: saved.thetaY };
        setPhase('tracking');
      } else {
        setCalibUiTick({ targetIdx: 0, subPhase: 'welcome' });
        setPhase('calibrating');
      }
      committedGesture.current = 'point';
      setGesture('point');

      const hasRVFC = typeof v.requestVideoFrameCallback === 'function';
      const FRAME_BUDGET_MS = 1000 / 30;
      let lastT = 0;

      const detect = () => {
        if (!mountedRef.current || !landmarkerRef.current || !videoRef.current) return;
        const video = videoRef.current;
        if (document.hidden || video.readyState < 2 || busyRef.current) {
          rafRef.current = hasRVFC ? video.requestVideoFrameCallback(detect) : requestAnimationFrame(detect);
          return;
        }
        const now = performance.now();
        if (!hasRVFC && now - lastT < FRAME_BUDGET_MS) {
          rafRef.current = requestAnimationFrame(detect);
          return;
        }
        lastT = now;
        busyRef.current = true;
        let result = null;
        try { result = landmarkerRef.current.detectForVideo(video, now); } catch {}
        busyRef.current = false;

        const landmarks = result?.faceLandmarks?.[0] ?? null;
        let nextGesture = 'point';

        if (landmarks && landmarks.length >= 478) {
          const rIris = landmarks[IDX_RIGHT_IRIS];
          const lIris = landmarks[IDX_LEFT_IRIS];
          const nose  = landmarks[IDX_NOSE];
          // Mirror x so head-LEFT = cursor-LEFT
          const ix = 1 - (rIris.x + lIris.x) / 2;
          const iy =      (rIris.y + lIris.y) / 2;
          const hx = 1 - nose.x;
          const hy =     nose.y;

          // ── Iris-stability gate ──────────────────────────────────────────
          // Maintain a STABILITY_WINDOW_MS ring buffer of iris positions and
          // check the radius² variance. While the user is glancing around or
          // shifting their head, variance is high → we DON'T collect samples.
          // Only once the gaze settles on a target does sampling proceed.
          const hist = irisHistoryRef.current;
          hist.push({ x: ix, y: iy, t: now });
          while (hist.length && now - hist[0].t > STABILITY_WINDOW_MS) hist.shift();
          let stable = false;
          if (hist.length >= 5) {
            let mx = 0, my = 0;
            for (const h of hist) { mx += h.x; my += h.y; }
            mx /= hist.length; my /= hist.length;
            let v = 0;
            for (const h of hist) v += (h.x - mx) ** 2 + (h.y - my) ** 2;
            v /= hist.length;
            stable = v < STABILITY_VAR_THRESHOLD;
          }
          calibStableRef.current = stable;

          // ── Calibration: collect samples only WHILE the gaze is stable ───
          const cal = calibRef.current;
          if (cal.active && cal.subPhase !== 'welcome' && cal.subPhase !== 'done') {
            const elapsed = now - cal.phaseStart;
            if (cal.subPhase === 'arming') {
              // Show readiness via the progress ring: 0 when jittery, → 1 as
              // we approach having collected enough stable samples.
              calibProgressRef.current = 0;
              // The moment the gaze settles, jump to collecting and start
              // counting toward SAMPLES_PER_TARGET. If the user never settles
              // within ARM_MAX_MS, advance anyway (failsafe).
              if (stable || elapsed >= ARM_MAX_MS) {
                cal.subPhase = 'collecting';
                cal.phaseStart = now;
                cal.stableForTarget = 0;
                setCalibUiTick({ targetIdx: cal.targetIdx, subPhase: 'collecting' });
              }
            } else if (cal.subPhase === 'collecting') {
              const [tx, ty] = CALIB_TARGETS[cal.targetIdx];
              if (stable) {
                cal.samples.push({ ix, iy, hx, hy, tx, ty });
                cal.stableForTarget++;
              }
              calibProgressRef.current = Math.min(1, cal.stableForTarget / SAMPLES_PER_TARGET);
              const done       = cal.stableForTarget >= SAMPLES_PER_TARGET;
              const timedOut   = elapsed >= COLLECT_TIMEOUT_MS;
              if (done || timedOut) {
                cal.subPhase = 'lockin';
                cal.phaseStart = now;
                calibProgressRef.current = done ? 1 : 0;
                setCalibUiTick({ targetIdx: cal.targetIdx, subPhase: 'lockin' });
              }
            } else if (cal.subPhase === 'lockin') {
              calibProgressRef.current = Math.min(1, elapsed / LOCKIN_MS);
              if (elapsed >= LOCKIN_MS) {
                if (cal.targetIdx >= CALIB_TARGETS.length - 1) {
                  cal.subPhase = 'done';
                  cal.active = false;
                  const ok = trainAndPersist();
                  if (!ok) {
                    setError('Calibration failed — your gaze was too unstable. Try again with steadier eyes.');
                    setCalibUiTick({ targetIdx: cal.targetIdx, subPhase: 'welcome' });
                    cal.samples = [];
                  } else {
                    setCalibUiTick({ targetIdx: cal.targetIdx, subPhase: 'done' });
                    setTimeout(() => {
                      if (mountedRef.current) setPhase('tracking');
                    }, 700);
                  }
                } else {
                  cal.targetIdx++;
                  cal.subPhase = 'arming';
                  cal.phaseStart = now;
                  calibProgressRef.current = 0;
                  setCalibUiTick({ targetIdx: cal.targetIdx, subPhase: 'arming' });
                }
              }
            }
          }

          // ── Compute the cursor position for runtime ──────────────────────
          if (modelRef.current) {
            const feat = buildFeatures(ix, iy, hx, hy);
            const px = Math.min(1, Math.max(0, applyModel(feat, modelRef.current.thetaX)));
            const py = Math.min(1, Math.max(0, applyModel(feat, modelRef.current.thetaY)));
            const s = smoothRef.current;
            s.x += (px - s.x) * 0.35;
            s.y += (py - s.y) * 0.35;
            dataRef.current.pointerNorm = { x: s.x, y: s.y };
          } else {
            // Skipped-calibration fallback: dumb amplified iris around 0.5.
            const px = Math.min(1, Math.max(0, 0.5 + (ix - 0.5) * 6));
            const py = Math.min(1, Math.max(0, 0.5 + (iy - 0.5) * 6));
            const s = smoothRef.current;
            s.x += (px - s.x) * 0.30;
            s.y += (py - s.y) * 0.30;
            dataRef.current.pointerNorm = { x: s.x, y: s.y };
          }

          // ── Blink-for-back (only counts in tracking phase) ───────────────
          // Score is the AVERAGE of both eyes — works even when MediaPipe
          // reports one eye more confidently closed than the other (very
          // common with one-sided lighting). The soft floor still rejects
          // single-eye winks because BOTH eyes must clear it.
          const blends = result?.faceBlendshapes?.[0]?.categories;
          let lB = 0, rB = 0;
          if (blends) {
            lB = blends.find((b) => b.categoryName === 'eyeBlinkLeft')?.score  ?? 0;
            rB = blends.find((b) => b.categoryName === 'eyeBlinkRight')?.score ?? 0;
          }
          const blinkAvg = (lB + rB) / 2;
          const isClosed = blinkAvg > BLINK_THRESHOLD
                        && lB > BLINK_SOFT_FLOOR
                        && rB > BLINK_SOFT_FLOOR;
          const b = blinkRef.current;
          if (isClosed && !b.closed) {
            b.closed = true; b.closedAt = now;
          } else if (!isClosed && b.closed) {
            const dur = now - b.closedAt;
            b.closed = false;
            // Only consume the blink if we're actually navigating
            if (phaseRef.current === 'tracking' && dur >= MIN_BLINK_MS && dur <= MAX_BLINK_MS) {
              palmCountdown.current = PALM_HOLD_FRAMES;
            }
          }
        } else {
          dataRef.current.pointerNorm = null;
          blinkRef.current = { closed: false, closedAt: 0 };
        }

        if (palmCountdown.current > 0) {
          nextGesture = 'palm';
          palmCountdown.current--;
        }
        if (nextGesture !== committedGesture.current) {
          committedGesture.current = nextGesture;
          setGesture(nextGesture);
        }

        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          drawOverlay(landmarks, ctx, canvasRef.current.width, canvasRef.current.height, nextGesture);
        }

        rafRef.current = hasRVFC ? video.requestVideoFrameCallback(detect) : requestAnimationFrame(detect);
      };
      rafRef.current = hasRVFC ? v.requestVideoFrameCallback(detect) : requestAnimationFrame(detect);
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Camera blocked' : 'Failed to start');
      setLoading(false);
      stop();
    }
  }, [stop, drawOverlay, trainAndPersist]);

  const toggle = useCallback(() => {
    if (active) stop(); else start();
  }, [active, start, stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) setSupported(false);
  }, []);

  if (!supported) return null;

  return (
    <>
      <button
        onClick={toggle}
        disabled={loading}
        className={`lg-surface lg-pill w-8 h-8 transition-colors
                    flex items-center justify-center flex-shrink-0 disabled:opacity-50
                    ${active ? 'lg-tint-teal text-brand-teal' : 'text-gray-300 hover:text-white'}`}
        aria-label={active ? 'Stop eye tracking' : 'Start eye tracking'}
        title={active
          ? 'Stop eye tracking'
          : 'Track your eyes — calibrate once, then dwell to select / blink to go back'}
      >
        {loading ? (
          <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
        ) : active ? (
          <Eye size={14} strokeWidth={1.75} />
        ) : (
          <EyeOff size={14} strokeWidth={1.75} />
        )}
      </button>

      <video ref={videoRef} className="hidden" muted playsInline autoPlay />

      {createPortal(
        <>
          <AnimatePresence>
            {active && phase === 'calibrating' && (
              <CalibrationOverlay
                key="calib"
                tick={calibUiTick}
                progressRef={calibProgressRef}
                onStart={beginCalibration}
                onSkip={skipCalibration}
                onCancel={stop}
              />
            )}
          </AnimatePresence>

          {active && phase === 'tracking' && (
            <EyePreview
              srcVideo={videoRef.current}
              canvasRef={canvasRef}
              gesture={gesture}
              onStop={stop}
              onRecalibrate={recalibrate}
            />
          )}

          {error && !active && (
            <div className="fixed top-20 right-4 z-[100] lg-surface lg-card px-3 py-2 text-[11px] text-gray-300">
              {error}
            </div>
          )}
        </>,
        document.body
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera preview window — same layout/position as hand tracking's preview.
// Includes a "Recalibrate" button so the user can rerun the 9-point sequence.
// ─────────────────────────────────────────────────────────────────────────────
function EyePreview({ srcVideo, canvasRef, gesture, onStop, onRecalibrate }) {
  const previewVideoRef = useRef(null);
  useEffect(() => {
    const dst = previewVideoRef.current;
    if (!dst || !srcVideo?.srcObject) return;
    dst.srcObject = srcVideo.srcObject;
    dst.play().catch(() => {});
    return () => { dst.srcObject = null; };
  }, [srcVideo]);

  const label = gesture === 'palm' ? 'blink → back' : 'tracking';
  const Icon  = gesture === 'palm' ? Sparkles : Eye;

  return (
    <motion.div
      className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 20 }}
      transition={{ type: 'spring', duration: 0.4 }}
    >
      <div className="glass border border-white/10 rounded-xl px-3 py-1.5 flex items-center gap-2">
        <Icon size={14} strokeWidth={1.75} className="text-brand-teal" />
        <span className="text-xs font-mono text-gray-300">{label}</span>
      </div>

      <div
        className="relative rounded-2xl overflow-hidden border-2"
        style={{
          width: 160, height: 120,
          borderColor: 'rgba(0, 255, 204, 0.4)',
          boxShadow: '0 0 20px rgba(0, 255, 204, 0.2)',
        }}
      >
        <video
          ref={previewVideoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
          muted playsInline autoPlay
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }}
          width={320} height={240}
        />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1.5
                        bg-black/60 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-teal animate-pulse" />
          <span className="text-[10px] font-mono text-brand-teal">LIVE</span>
        </div>
        <button
          onClick={onStop}
          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full
                     bg-black/70 text-gray-400 hover:text-white hover:bg-black/90
                     flex items-center justify-center transition-colors"
          aria-label="Stop eye tracking" title="Disable eye tracking"
        >
          <X size={11} strokeWidth={2.25} />
        </button>
      </div>

      <button
        onClick={onRecalibrate}
        className="text-[10px] font-mono text-gray-400 hover:text-brand-teal transition-colors
                   flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/40 border border-white/10"
        title="Re-run 9-point calibration"
      >
        <RotateCcw size={10} strokeWidth={2} />
        recalibrate
      </button>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sci-fi calibration overlay. Three screens:
//   1) welcome — instructions + start/skip
//   2) calibrating — 9-target sequence, the dot pulses, fills, locks in
//   3) done — brief "calibrated" flash, then dismisses
// ─────────────────────────────────────────────────────────────────────────────
function CalibrationOverlay({ tick, progressRef, onStart, onSkip, onCancel }) {
  const { targetIdx, subPhase } = tick;

  // Esc to bail out entirely.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <motion.div
      className="fixed inset-0 z-[120]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Deep backdrop with grid + scanline */}
      <div className="absolute inset-0" style={{ background: 'rgba(2,4,8,0.85)', backdropFilter: 'blur(6px)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `
          linear-gradient(rgba(0,255,204,0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,204,0.045) 1px, transparent 1px)
        `,
        backgroundSize: '36px 36px',
      }} />
      <ScanLineEffect />

      {/* HUD: top-left identity, top-right target counter, bottom progress */}
      <div className="absolute top-6 left-6 flex items-center gap-2 text-brand-teal font-mono text-[11px] tracking-[0.18em]">
        <Target size={14} strokeWidth={2} className="animate-pulse" />
        NEURAL · CALIBRATION
      </div>
      {subPhase !== 'welcome' && subPhase !== 'done' && (
        <div className="absolute top-6 right-6 flex items-center gap-2 text-brand-teal font-mono text-[11px] tracking-[0.18em]">
          <ScanLine size={14} strokeWidth={2} />
          TARGET {String(targetIdx + 1).padStart(2, '0')} / {String(CALIB_TARGETS.length).padStart(2, '0')}
        </div>
      )}

      {/* Welcome screen */}
      {subPhase === 'welcome' && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center px-6"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="max-w-md w-full lg-surface lg-card rounded-2xl px-8 py-7 text-center"
            style={{ borderColor: 'rgba(0,255,204,0.25)', boxShadow: '0 0 60px rgba(0,255,204,0.12)' }}
          >
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl lg-surface lg-tint-teal flex items-center justify-center">
              <Eye size={26} strokeWidth={1.5} className="text-brand-teal" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Calibrate your gaze</h2>
            <p className="text-sm text-gray-400 leading-relaxed mb-6">
              Look at each of <span className="text-brand-teal">9 targets</span> for about a second.
              Takes ~20 seconds. Sit still and keep your head roughly level — only your eyes
              need to move.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onSkip}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400
                           hover:bg-white/5 hover:text-white transition-all"
              >
                Skip
              </button>
              <button
                onClick={onStart}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-black
                           bg-brand-teal hover:opacity-90 active:scale-[0.98] transition-all
                           shadow-[0_0_24px_rgba(0,255,204,0.4)]"
              >
                Start calibration
              </button>
            </div>
            <p className="text-[10px] font-mono text-gray-600 mt-4 tracking-wide">
              Esc to cancel · runs once per device
            </p>
          </div>
        </motion.div>
      )}

      {/* Active calibration: 9 dots, current one is alive */}
      {(subPhase === 'arming' || subPhase === 'collecting' || subPhase === 'lockin') && (
        <>
          {CALIB_TARGETS.map(([tx, ty], idx) => (
            <CalibDot
              key={idx}
              x={tx} y={ty}
              state={
                idx < targetIdx ? 'done'
                : idx === targetIdx ? subPhase
                : 'pending'
              }
              progressRef={progressRef}
              active={idx === targetIdx}
            />
          ))}

          {/* Bottom progress bar */}
          <CalibProgressBar targetIdx={targetIdx} total={CALIB_TARGETS.length} subPhase={subPhase} />
        </>
      )}

      {/* Done flash */}
      {subPhase === 'done' && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full lg-surface lg-tint-teal flex items-center justify-center"
              style={{ boxShadow: '0 0 80px rgba(0,255,204,0.5)' }}>
              <Sparkles size={36} strokeWidth={1.5} className="text-brand-teal" />
            </div>
            <p className="font-mono text-brand-teal text-sm tracking-[0.24em]">CALIBRATED</p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// One calibration dot at (x,y) in viewport-normalized coords. Drives its own
// rAF loop to read the per-frame `progressRef` without triggering React
// re-renders for every sample.
function CalibDot({ x, y, state, progressRef, active }) {
  const ringRef = useRef(null);
  const dotRef  = useRef(null);

  useEffect(() => {
    if (!active) return;
    let raf;
    const tick = () => {
      const ring = ringRef.current;
      if (ring) {
        // SVG circle: stroke-dashoffset 0..C — fill clockwise as progress→1
        const C = 2 * Math.PI * 22; // ring radius 22
        ring.style.strokeDasharray = `${C}`;
        ring.style.strokeDashoffset = `${C * (1 - progressRef.current)}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, progressRef]);

  // Sharper visual contrast between the three live states so the user can
  // SEE when the iris-stability gate trips:
  //   arming     = dim teal, slowly pulsing — "I'm waiting for your eyes"
  //   collecting = bright solid teal, fully glowing — "got you, sampling"
  //   lockin     = white expand — "target locked"
  const colour = state === 'done'      ? 'rgba(0,255,204,0.45)'
              : state === 'lockin'     ? '#ffffff'
              : state === 'collecting' ? '#00ffcc'
              : state === 'arming'     ? 'rgba(0,255,204,0.55)'
              :                          'rgba(0,255,204,0.18)';
  const glow = state === 'collecting'
      ? '0 0 50px rgba(0,255,204,0.95), 0 0 100px rgba(0,255,204,0.55)'
    : state === 'lockin'
      ? '0 0 80px rgba(255,255,255,1)'
    : state === 'arming'
      ? '0 0 10px rgba(0,255,204,0.35)'
      : 'none';
  const scale = state === 'lockin'     ? 1.5
              : state === 'collecting' ? 1.05
              : state === 'arming'     ? 0.8
              :                          0.55;

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left:  `${x * 100}%`,
        top:   `${y * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}
      animate={{ scale }}
      transition={{ type: 'spring', duration: 0.35 }}
    >
      <svg width="60" height="60" style={{ overflow: 'visible' }}>
        {/* Outer guide ring */}
        <circle cx="30" cy="30" r="22" fill="none"
          stroke="rgba(0,255,204,0.18)" strokeWidth="1.5" />
        {/* Progress ring (only meaningful when active) */}
        {active && (
          <circle
            ref={ringRef}
            cx="30" cy="30" r="22" fill="none"
            stroke="#00ffcc" strokeWidth="2.5" strokeLinecap="round"
            transform="rotate(-90 30 30)"
          />
        )}
        {/* Center dot — softly pulses while arming so the user sees "waiting" */}
        {state === 'arming' ? (
          <motion.circle
            cx="30" cy="30" r="5"
            fill={colour}
            style={{ filter: `drop-shadow(${glow})` }}
            animate={{ opacity: [0.4, 1, 0.4], r: [4, 6, 4] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <circle
            ref={dotRef}
            cx="30" cy="30" r={state === 'lockin' ? 9 : 5}
            fill={colour}
            style={{ filter: `drop-shadow(${glow})`, transition: 'fill 0.18s, r 0.18s' }}
          />
        )}
        {/* Cross-hair when active — same as before */}
        {(state === 'arming' || state === 'collecting') && (
          <>
            <line x1="30" y1="0"  x2="30" y2="14" stroke="rgba(0,255,204,0.4)" strokeWidth="1" />
            <line x1="30" y1="46" x2="30" y2="60" stroke="rgba(0,255,204,0.4)" strokeWidth="1" />
            <line x1="0"  y1="30" x2="14" y2="30" stroke="rgba(0,255,204,0.4)" strokeWidth="1" />
            <line x1="46" y1="30" x2="60" y2="30" stroke="rgba(0,255,204,0.4)" strokeWidth="1" />
          </>
        )}
      </svg>
    </motion.div>
  );
}

function CalibProgressBar({ targetIdx, total, subPhase }) {
  const pct = ((targetIdx) / total) * 100;
  const status = subPhase === 'arming'
    ? 'WAITING · LOOK AT THE TARGET'
    : subPhase === 'collecting'
      ? `SAMPLING · ${String(targetIdx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
      : subPhase === 'lockin'
        ? `LOCKED · ${String(targetIdx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
        : '';
  const colour = subPhase === 'arming' ? 'text-gray-500' : 'text-brand-teal';
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-80">
      <div className={`font-mono text-[10px] tracking-[0.20em] ${colour} transition-colors`}>
        {status}
      </div>
      <div className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #00ffcc, #60a5fa)',
            boxShadow: '0 0 12px rgba(0,255,204,0.6)',
          }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// A horizontal scan-line sweeping the whole overlay. Pure CSS animation —
// no JS cost.
function ScanLineEffect() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div
        className="absolute left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,204,0.55), transparent)' }}
        animate={{ y: ['0vh', '100vh'] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}
