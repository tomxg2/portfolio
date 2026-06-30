import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Hand, HandMetal, Pointer, MousePointer, X } from 'lucide-react';

/**
 * Small webcam preview in the bottom-right corner.
 * Shows the video feed with the hand skeleton canvas overlaid.
 *
 * IMPORTANT: This component must always be mounted (never conditionally rendered)
 * so that videoRef and canvasRef are populated before startTracking() runs.
 * Visibility is controlled via CSS/animation, not unmounting.
 */
export default function CameraPreview({ videoRef, canvasRef, isActive, gesture, onStop }) {
  const gestureIcon = {
    point: Pointer,
    pinch: MousePointer,
    palm:  HandMetal,
    none:  Hand,
  };
  const GestureIcon = gestureIcon[gesture] || Hand;

  // Portal to document.body so `position: fixed` isn't broken by the nav's CSS transform
  return createPortal(
    <motion.div
      className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.8, y: isActive ? 0 : 20 }}
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      transition={{ type: 'spring', duration: 0.4 }}
      style={{ pointerEvents: isActive ? 'auto' : 'none' }}
    >
      {/* Gesture indicator */}
      <div className="glass border border-white/10 rounded-xl px-3 py-1.5 flex items-center gap-2">
        <GestureIcon size={14} strokeWidth={1.75} className="text-brand-teal" />
        <span className="text-xs font-mono text-gray-300 capitalize">
          {gesture === 'none' ? 'waiting…' : gesture}
        </span>
      </div>

      {/* Video preview with skeleton overlay */}
      <div
        className="relative rounded-2xl overflow-hidden border-2"
        style={{
          width: 160,
          height: 120,
          borderColor: 'rgba(0, 255, 204, 0.4)',
          boxShadow: '0 0 20px rgba(0, 255, 204, 0.2)',
        }}
      >
        {/* Mirrored video — ref always populated */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
          muted
          playsInline
          autoPlay
        />

        {/* Skeleton overlay canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }}
          width={320}
          height={240}
        />

        {/* Status badge */}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1.5
                        bg-black/60 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-teal animate-pulse" />
          <span className="text-[10px] font-mono text-brand-teal">LIVE</span>
        </div>

        {/* Stop button */}
        <button
          onClick={onStop}
          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full
                     bg-black/70 text-gray-400 hover:text-white hover:bg-black/90
                     flex items-center justify-center transition-colors"
          aria-label="Stop gesture control"
          title="Disable gesture control"
        >
          <X size={11} strokeWidth={2.25} />
        </button>
      </div>
    </motion.div>,
    document.body
  );
}
