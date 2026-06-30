import { motion, AnimatePresence } from 'framer-motion';
import { Mouse, ZoomIn, MousePointerClick, Keyboard, Hand, Timer, Maximize2, HandMetal } from 'lucide-react';

const MOUSE_HINTS = [
  { Icon: Mouse,             text: 'Drag to rotate' },
  { Icon: ZoomIn,            text: 'Scroll to zoom' },
  { Icon: MousePointerClick, text: 'Click a planet to explore' },
  { Icon: Keyboard,          text: '1–7 jump · Esc back' },
];

const GESTURE_HINTS = [
  { Icon: Hand,      text: 'Point to navigate' },
  { Icon: Timer,     text: 'Hold on node to select' },
  { Icon: Maximize2, text: 'Spread thumb & index to zoom' },
  { Icon: HandMetal, text: 'Palm to go back' },
];

/**
 * HUD — subtle control hints at bottom-left.
 * Shows different hints depending on gesture mode.
 */
export default function HUD({ gestureMode }) {
  const hints = gestureMode ? GESTURE_HINTS : MOUSE_HINTS;

  return (
    <div className="fixed bottom-6 right-6 z-30 select-none hidden sm:block">
      <AnimatePresence mode="wait">
        <motion.div
          key={gestureMode ? 'gesture' : 'mouse'}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="lg-surface lg-card px-4 py-3 flex flex-col gap-2 min-w-[200px]"
        >
          <div className="flex items-center gap-2 pb-1 mb-1 border-b border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-teal shadow-[0_0_6px_#00ffcc]" />
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-400">
              {gestureMode ? 'Hand controls' : 'Controls'}
            </span>
          </div>
          {hints.map(({ Icon, text }) => (
            <div
              key={text}
              className="flex items-center gap-2.5 text-[11px] text-gray-400"
            >
              <Icon size={13} strokeWidth={1.75} className="text-gray-300 flex-shrink-0" />
              <span className="font-mono">{text}</span>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
