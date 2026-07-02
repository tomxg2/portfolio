import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, Hand, Timer, Maximize2, HandMetal, ShieldCheck, Sparkles } from 'lucide-react';
import { useHandTracking } from '../hooks/useHandTracking.js';
import CameraPreview from './CameraPreview.jsx';

const isMobile = () =>
  typeof window !== 'undefined' &&
  /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  // Portal to body: the nav's backdrop-filter makes it the containing block
  // for position:fixed children, so without this the toast anchors to the nav
  return createPortal(
    <motion.div
      className="fixed top-20 left-1/2 z-[100] max-w-sm w-[90vw]
                 glass border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300
                 shadow-2xl flex items-start gap-3"
      initial={{ opacity: 0, y: -12, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: -12, x: '-50%' }}
    >
      <Camera size={18} strokeWidth={1.75} className="text-gray-300 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-medium text-white mb-0.5">Camera permission required</p>
        <p className="text-xs text-gray-400 leading-relaxed">{message}</p>
      </div>
      <button onClick={onDismiss} className="ml-auto text-gray-600 hover:text-white transition-colors flex-shrink-0" aria-label="Dismiss">
        <X size={16} strokeWidth={2} />
      </button>
    </motion.div>,
    document.body
  );
}

// ── Enable gesture modal ──────────────────────────────────────────────────────
function GestureModal({ onEnable, onDismiss }) {
  // Portal to body for the same containing-block reason as Toast/CameraPreview
  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onDismiss}
      />
      <motion.div
        className="fixed z-[91] top-1/2 left-1/2 w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto
                   glass border border-white/10 rounded-2xl p-6 shadow-2xl"
        initial={{ opacity: 0, scale: 0.9, x: '-50%', y: '-50%' }}
        animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
        exit={{ opacity: 0, scale: 0.9, x: '-50%', y: '-50%' }}
        transition={{ type: 'spring', duration: 0.35 }}
      >
        <div className="mb-3 flex justify-center">
          <div className="w-12 h-12 rounded-2xl lg-surface lg-tint-teal flex items-center justify-center">
            <Hand size={22} strokeWidth={1.75} className="text-brand-teal" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-white text-center mb-1">Gesture Control</h2>
        <p className="text-sm text-gray-400 text-center mb-5 leading-relaxed">
          Control this site with your hand via webcam.
        </p>

        <div className="space-y-2.5 mb-6 bg-white/5 rounded-xl p-4">
          {[
            [Hand,      'Point', 'Navigate the 3D graph'],
            [Timer,     'Hover', 'Hold over a planet to select'],
            [Maximize2, 'Zoom',  'Spread both hands apart / together'],
            [HandMetal, 'Palm',  'Go back / deselect'],
          ].map(([Icon, gesture, desc]) => (
            <div key={gesture} className="flex items-center gap-3 text-sm">
              <Icon size={16} strokeWidth={1.75} className="w-6 text-brand-teal" />
              <span className="font-medium text-white w-16">{gesture}</span>
              <span className="text-gray-500 text-xs">{desc}</span>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 mb-6 p-3 rounded-lg bg-brand-teal/5
                        border border-brand-teal/20">
          <ShieldCheck size={14} strokeWidth={1.75} className="text-brand-teal mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-400 leading-relaxed">
            Your camera runs entirely in your browser.{' '}
            <span className="text-gray-300">No video is recorded, stored, or transmitted anywhere.</span>
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400
                       hover:bg-white/5 hover:text-white transition-all"
          >
            Maybe later
          </button>
          <button
            onClick={onEnable}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-black
                       bg-brand-teal hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Enable Camera
          </button>
        </div>
      </motion.div>
    </>,
    document.body
  );
}

// ── Main GestureControl component ─────────────────────────────────────────────
/**
 * Renders the "✋ Enable Gesture Control" nav button, handles the enable flow,
 * and passes tracking data upward via onGestureData callback.
 *
 * Props:
 *   onGestureData(data) — called on gesture/active changes with { dataRef, gesture, isActive }
 */
const HINT_KEY = 'gesture_hint_dismissed';

export default function GestureControl({ onGestureData }) {
  const [showModal, setShowModal]   = useState(false);
  const [showToast, setShowToast]   = useState(false);
  const [toastMsg, setToastMsg]     = useState('');
  const [showHint, setShowHint]     = useState(false);
  const mobile = isMobile();

  const {
    isActive, isLoading, error,
    gesture, dataRef,
    videoRef, canvasRef,
    startTracking, stopTracking,
  } = useHandTracking();

  // Propagate tracking state to parent. High-frequency data travels via
  // dataRef (mutated per frame, read in rAF/useFrame loops) — this effect
  // now fires only when the committed gesture or active state changes,
  // instead of on every camera frame.
  useEffect(() => {
    onGestureData?.({ dataRef, gesture, isActive });
  }, [gesture, isActive, dataRef, onGestureData]);

  // Handle camera errors
  useEffect(() => {
    if (!error) return;
    if (error === 'camera_denied') {
      setToastMsg(
        'Camera access was denied. To enable it, click the camera icon in your browser address bar and allow access, then try again.'
      );
    } else {
      setToastMsg(`Could not start gesture control: ${error}`);
    }
    setShowToast(true);
    setShowModal(false);
  }, [error]);

  // Show callout hint once per session after a short delay
  useEffect(() => {
    if (mobile || sessionStorage.getItem(HINT_KEY)) return;
    const show = setTimeout(() => setShowHint(true), 2500);
    const hide = setTimeout(() => setShowHint(false), 10500);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissHint = () => {
    setShowHint(false);
    sessionStorage.setItem(HINT_KEY, '1');
  };

  const handleEnableClick = () => { dismissHint(); setShowModal(true); };

  const handleConfirmEnable = async () => {
    setShowModal(false);
    await startTracking();
  };

  const handleStop = () => stopTracking();

  // Don't render gesture button on mobile
  if (mobile) return null;

  return (
    <>
      {/* Nav button + hint callout */}
      <div className="relative">
        {/* Hero CTA — the gesture control is the marquee feature, so this
            button breaks out of the navbar styling: larger, stronger glow,
            pulsing teal halo, animated hand emoji, "TRY IT" badge. */}
        <button
          onClick={isActive ? handleStop : handleEnableClick}
          disabled={isLoading}
          className={`
            relative flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold
            lg-surface lg-pill lg-tint-teal transition-all duration-300
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isActive ? 'text-brand-teal' : 'text-brand-teal'}
            ${!isActive ? 'gesture-cta-pulse' : ''}
          `}
          style={{
            // Reinforce the teal halo beyond what lg-tint-teal provides
            boxShadow: isActive
              ? 'inset 0 1px 0 rgba(255,255,255,0.26), 0 0 24px rgba(0,255,204,0.32), 0 0 48px rgba(0,255,204,0.18)'
              : 'inset 0 1px 0 rgba(255,255,255,0.26), 0 0 28px rgba(0,255,204,0.38), 0 0 56px rgba(0,255,204,0.20)',
          }}
          aria-label={isActive ? 'Disable gesture control' : 'Enable gesture control'}
        >
          {isLoading ? (
            <span className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className={!isActive ? 'gesture-cta-wave' : ''}>
              <Hand size={16} strokeWidth={2} />
            </span>
          )}

          <span className="hidden sm:inline tracking-tight">
            {isLoading ? 'Starting…' : isActive ? 'Gesture ON' : 'Try Hand Gestures'}
          </span>

          {isActive ? (
            <span className="w-1.5 h-1.5 rounded-full bg-brand-teal shadow-[0_0_6px_#00ffcc] animate-pulse" />
          ) : (
            <span className="hidden xl:inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-full
                             bg-brand-teal/15 border border-brand-teal/40 text-[9px] font-mono uppercase tracking-[0.14em]
                             text-brand-teal">
              <Sparkles size={9} strokeWidth={2} /> New
            </span>
          )}
        </button>

        {/* Hint callout — floats below the button, points up */}
        <AnimatePresence>
          {showHint && !isActive && (
            <motion.div
              className="absolute top-full right-0 mt-3 z-50 w-64"
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            >
              {/* Arrow pointing up */}
              <div
                className="absolute -top-[7px] right-7 w-3.5 h-3.5 rotate-45"
                style={{
                  background: 'rgba(17,17,17,0.95)',
                  borderLeft: '1px solid rgba(96,165,250,0.25)',
                  borderTop:  '1px solid rgba(96,165,250,0.25)',
                }}
              />
              {/* Card */}
              <div
                className="relative rounded-xl px-4 py-3 shadow-2xl"
                style={{
                  background: 'rgba(17,17,17,0.95)',
                  border: '1px solid rgba(96,165,250,0.25)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
                    Control with your hands
                    <Hand size={13} strokeWidth={2} className="text-brand-teal" />
                  </p>
                  <button
                    onClick={dismissHint}
                    className="text-gray-600 hover:text-white transition-colors flex-shrink-0 mt-0.5"
                    aria-label="Dismiss"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed mb-3">
                  Navigate the 3D scene via your webcam — no video stored or sent anywhere.
                </p>
                <button
                  onClick={handleEnableClick}
                  className="w-full py-1.5 rounded-lg text-xs font-semibold text-black
                             bg-brand-teal hover:opacity-90 transition-all"
                >
                  Try it now →
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <GestureModal
            onEnable={handleConfirmEnable}
            onDismiss={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Camera preview + skeleton overlay — always mounted so videoRef is ready */}
      <CameraPreview
        videoRef={videoRef}
        canvasRef={canvasRef}
        isActive={isActive}
        gesture={gesture}
        onStop={handleStop}
      />

      {/* Permission toast */}
      <AnimatePresence>
        {showToast && (
          <Toast message={toastMsg} onDismiss={() => setShowToast(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
