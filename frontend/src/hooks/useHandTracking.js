import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * useHandTracking
 * Wraps MediaPipe Hands to provide real-time hand landmark data and
 * derived gesture state. Camera runs only when `isActive` is true.
 *
 * PERFORMANCE: high-frequency values (pointer, zoom distances) are exposed
 * via `dataRef` — a mutable ref updated per camera frame WITHOUT React
 * re-renders. Only low-frequency values (gesture commits, isActive, errors)
 * go through state. Consumers read dataRef.current inside their own
 * rAF / useFrame loops.
 *
 * Returns:
 *   isActive        — whether camera + detection is running
 *   isLoading       — MediaPipe is still initialising
 *   error           — string error message, or null
 *   gesture         — 'point' | 'pinch' | 'palm' | 'none' (state, commits only)
 *   dataRef         — ref → { pointerNorm, zoomDist, twoHandDist } (per-frame, no re-render)
 *   videoRef        — ref to attach to <video> element for preview
 *   canvasRef       — ref to attach to <canvas> for skeleton overlay
 *   startTracking   — async function, requests camera + starts detection
 *   stopTracking    — stops camera + detection
 */

// EMA alpha for pointer smoothing — higher = more responsive, more jitter
const POINTER_ALPHA = 0.35;
// EMA alpha for zoom distances — higher = more responsive, less smoothing
const ZOOM_ALPHA = 0.4;
// Frames a gesture must be stable before it commits
const GESTURE_STABLE_FRAMES = 3;
// Fallback inference cap when requestVideoFrameCallback is unavailable (ms)
const MIN_INFER_INTERVAL = 33;

export function useHandTracking() {
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [gesture, setGesture] = useState('none');

  // High-frequency data — mutated per frame, never triggers React renders
  const dataRef = useRef({ pointerNorm: null, zoomDist: null, twoHandDist: null });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false); // an inference is in flight — never queue another

  // Smoothing state
  const smoothedPointerRef  = useRef(null);
  const smoothedZoomRef     = useRef(null);
  const smoothedTwoHandRef  = useRef(null);
  const gestureBufferRef    = useRef({ pending: 'none', count: 0 });
  const committedGestureRef = useRef('none');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Gesture classification ────────────────────────────────────────────────
  const classifyGesture = useCallback((lm) => {
    if (!lm || lm.length < 21) return 'none';

    const thumbTip   = lm[4];
    const indexTip   = lm[8];
    const middleTip  = lm[12];
    const ringTip    = lm[16];
    const pinkyTip   = lm[20];
    const indexMCP   = lm[5];
    const middleMCP  = lm[9];
    const ringMCP    = lm[13];
    const pinkyMCP   = lm[17];

    const dist = (a, b) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

    const indexExtended  = indexTip.y  < indexMCP.y;
    const middleExtended = middleTip.y < middleMCP.y;
    const ringExtended   = ringTip.y   < ringMCP.y;
    const pinkyExtended  = pinkyTip.y  < pinkyMCP.y;

    const thumbIndexDist = dist(thumbTip, indexTip);

    // Pinch: thumb + index very close together
    if (thumbIndexDist < 0.07) return 'pinch';

    // Palm: 4 fingers extended
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) return 'palm';

    // Point: only index extended (thumb tucked or neutral)
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 'point';

    return 'none';
  }, []);

  // ── Draw skeleton overlay on canvas ──────────────────────────────────────
  const drawSkeleton = useCallback((lm, ctx, w, h) => {
    if (!lm) return;

    const CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17],
    ];

    ctx.strokeStyle = 'rgba(0, 255, 204, 0.8)';
    ctx.lineWidth = 1.5;
    CONNECTIONS.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    });

    lm.forEach((pt, i) => {
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, i === 8 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#00ffcc' : 'rgba(0,255,204,0.6)';
      ctx.fill();
    });
  }, []);

  // ── Detection loop ────────────────────────────────────────────────────────
  // Uses requestVideoFrameCallback where available: inference runs ONLY when
  // the webcam delivers a NEW frame (≤30fps) instead of on every display
  // refresh (60–144fps) — roughly halves CPU vs. a plain rAF loop and never
  // wastes an inference on a duplicate frame. busyRef guarantees inferences
  // never queue up on slow machines: if one is still running, the frame is
  // simply skipped and the EMA smoothing bridges the gap.
  const lastInferRef = useRef(0);

  const detect = useCallback(async () => {
    const video = videoRef.current;
    if (!handsRef.current || !video || !mountedRef.current) return;

    const hasRVFC = typeof video.requestVideoFrameCallback === 'function';
    const schedule = () => {
      if (!mountedRef.current || !handsRef.current) return;
      rafRef.current = hasRVFC
        ? video.requestVideoFrameCallback(detect)
        : requestAnimationFrame(detect);
    };

    // Tab hidden → don't burn CPU/battery in the background
    if (document.hidden || video.readyState < 2) { schedule(); return; }

    // Previous inference still running, or (rAF fallback) called too soon
    const now = performance.now();
    if (busyRef.current || (!hasRVFC && now - lastInferRef.current < MIN_INFER_INTERVAL)) {
      schedule();
      return;
    }

    busyRef.current = true;
    lastInferRef.current = now;
    try {
      await handsRef.current.send({ image: video });
    } catch {
      // MediaPipe errors are non-fatal during teardown
    }
    busyRef.current = false;
    schedule();
  }, []);

  // ── Start tracking ────────────────────────────────────────────────────────
  const startTracking = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Reset smoothing state
    smoothedPointerRef.current = null;
    smoothedZoomRef.current = null;
    smoothedTwoHandRef.current = null;
    gestureBufferRef.current = { pending: 'none', count: 0 };
    committedGestureRef.current = 'none';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (!window.Hands) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          // Self-hosted (public/mediapipe) — no third-party CDN at runtime
          script.src = '/mediapipe/hands.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load MediaPipe'));
          document.head.appendChild(script);
        });
      }

      const hands = new window.Hands({
        locateFile: (file) => `/mediapipe/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results) => {
        if (!mountedRef.current) return;

        const lmList  = results.multiHandLandmarks?.[0] ?? null;
        const lmList2 = results.multiHandLandmarks?.[1] ?? null;

        // ── Two-hand zoom distance (wrist-to-wrist, mirrored x, EMA smoothed) ──
        if (lmList && lmList2) {
          const w0 = lmList[0];
          const w1 = lmList2[0];
          const dx = (1 - w0.x) - (1 - w1.x);
          const dy = w0.y - w1.y;
          const raw = Math.sqrt(dx * dx + dy * dy);
          smoothedTwoHandRef.current = smoothedTwoHandRef.current == null
            ? raw
            : ZOOM_ALPHA * raw + (1 - ZOOM_ALPHA) * smoothedTwoHandRef.current;
          dataRef.current.twoHandDist = smoothedTwoHandRef.current;
        } else {
          smoothedTwoHandRef.current = null;
          dataRef.current.twoHandDist = null;
        }

        // ── Gesture stability buffer ──────────────────────────────────────
        // Only commit a gesture after GESTURE_STABLE_FRAMES consecutive frames
        const raw = classifyGesture(lmList);
        const buf = gestureBufferRef.current;
        if (raw === buf.pending) {
          buf.count++;
        } else {
          buf.pending = raw;
          buf.count = 1;
        }
        if (buf.count >= GESTURE_STABLE_FRAMES && raw !== committedGestureRef.current) {
          committedGestureRef.current = raw;
          setGesture(raw);
        }

        // ── EMA pointer smoothing ─────────────────────────────────────────
        if (lmList) {
          const tip = lmList[8];
          const rawX = 1 - tip.x; // mirror for natural feel
          const rawY = tip.y;

          if (!smoothedPointerRef.current) {
            smoothedPointerRef.current = { x: rawX, y: rawY };
          } else {
            smoothedPointerRef.current = {
              x: POINTER_ALPHA * rawX + (1 - POINTER_ALPHA) * smoothedPointerRef.current.x,
              y: POINTER_ALPHA * rawY + (1 - POINTER_ALPHA) * smoothedPointerRef.current.y,
            };
          }
          dataRef.current.pointerNorm = smoothedPointerRef.current;

          // ── Single-hand zoom distance (thumb tip ↔ index tip, EMA smoothed) ──
          const thumb = lmList[4];
          const index = lmList[8];
          const dx = (1 - thumb.x) - (1 - index.x);
          const dy = thumb.y - index.y;
          const rawZoom = Math.sqrt(dx * dx + dy * dy);
          smoothedZoomRef.current = smoothedZoomRef.current == null
            ? rawZoom
            : ZOOM_ALPHA * rawZoom + (1 - ZOOM_ALPHA) * smoothedZoomRef.current;
          dataRef.current.zoomDist = smoothedZoomRef.current;
        } else {
          smoothedPointerRef.current = null;
          dataRef.current.pointerNorm = null;
          dataRef.current.zoomDist = null;
        }

        // ── Draw skeleton(s) ──────────────────────────────────────────────
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (lmList)  drawSkeleton(lmList,  ctx, canvas.width, canvas.height);
          if (lmList2) drawSkeleton(lmList2, ctx, canvas.width, canvas.height);
        }
      });

      await hands.initialize();
      handsRef.current = hands;

      if (!mountedRef.current) {
        hands.close();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      setIsActive(true);
      setIsLoading(false);

      detect();
    } catch (err) {
      if (!mountedRef.current) return;
      setIsLoading(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('camera_denied');
      } else {
        setError(err.message || 'Failed to start hand tracking');
      }
    }
  }, [classifyGesture, drawSkeleton, detect]);

  // ── Stop tracking ─────────────────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      // rafRef may hold a requestVideoFrameCallback handle instead
      if (videoRef.current?.cancelVideoFrameCallback) {
        videoRef.current.cancelVideoFrameCallback(rafRef.current);
      }
      rafRef.current = null;
    }

    if (handsRef.current) {
      handsRef.current.close();
      handsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    smoothedPointerRef.current = null;
    smoothedZoomRef.current = null;
    smoothedTwoHandRef.current = null;
    gestureBufferRef.current = { pending: 'none', count: 0 };
    committedGestureRef.current = 'none';
    busyRef.current = false;
    dataRef.current.pointerNorm = null;
    dataRef.current.zoomDist = null;
    dataRef.current.twoHandDist = null;

    setIsActive(false);
    setGesture('none');
  }, []);

  useEffect(() => {
    return () => stopTracking();
  }, [stopTracking]);

  return {
    isActive,
    isLoading,
    error,
    gesture,
    dataRef,
    videoRef,
    canvasRef,
    startTracking,
    stopTracking,
  };
}
