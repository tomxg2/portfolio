import { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Code2, Building2, ArrowLeft } from 'lucide-react';
import NodeCard from './components/NodeCard.jsx';
import HUD from './components/HUD.jsx';
import GestureControl from './components/GestureControl.jsx';
import VoiceControl from './components/VoiceControl.jsx';
import MusicControl from './components/MusicControl.jsx';
import VRButton from './components/VRButton.jsx';
import EyeTrackingControl from './components/EyeTrackingControl.jsx';
import MultiplayerCursors from './components/MultiplayerCursors.jsx';
import { PROJECTS_DATA, NODES } from './data/nodes.js';

// Lazy-load the heavy 3D scene so it doesn't block initial paint
const Scene3D = lazy(() => import('./components/Scene3D.jsx'));

const IS_MOBILE = typeof window !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-brand-bg flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-brand-teal/20 animate-spin-slow" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-t-brand-teal border-transparent animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-400 font-mono">Initialising 3D scene</p>
          <p className="text-xs text-gray-600 mt-1">Loading Three.js + shaders…</p>
        </div>
      </div>
    </div>
  );
}

function NavBar({ onVoiceCommand, focusedCategory, onEyeData }) {
  return (
    <motion.nav
      className="fixed top-4 left-4 z-30 inline-flex items-center gap-3
                 px-3 py-1.5 lg-surface lg-pill"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold
                     text-brand-teal lg-surface lg-pill lg-tint-teal flex-shrink-0"
        >
          T
        </div>
        <span className="font-semibold text-white tracking-tight">Tom</span>
      </div>

      <span className="w-px h-5 bg-white/10" aria-hidden="true" />

      <div className="flex items-center gap-1.5">
        <MusicControl focusedCategory={focusedCategory} />
        <VoiceControl onCommand={onVoiceCommand} />
        <EyeTrackingControl onTrackingData={onEyeData} />
        <VRButton />
      </div>
    </motion.nav>
  );
}

function GestureFloater({ onGestureData }) {
  return (
    <motion.div
      className="fixed top-4 right-4 z-30"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <GestureControl onGestureData={onGestureData} />
    </motion.div>
  );
}

function HeroText({ hasSelectedNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {!hasSelectedNode && (
        <motion.div
          className="absolute bottom-10 left-8 pointer-events-none z-10 max-w-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.6, duration: 0.6 }}
        >
          <motion.div
            className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 lg-surface lg-pill lg-tint-teal"
            animate={reduceMotion ? { opacity: 1 } : { opacity: [0.85, 1, 0.85] }}
            transition={reduceMotion ? undefined : { duration: 3, repeat: Infinity }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-brand-teal shadow-[0_0_8px_#00ffcc]" />
            <span className="text-[10px] font-mono text-brand-teal tracking-[0.3em] uppercase">
              Interactive Portfolio
            </span>
          </motion.div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-[1.05] mb-3 tracking-tight">
            Hi, I'm{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #00ffcc 0%, #60a5fa 60%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Tom
            </span>
          </h1>
          <p className="text-sm text-gray-300 leading-relaxed">
            Dev apprentice at <span className="text-white font-medium">Swisscom Zurich</span>.
            <br />
            <span className="text-gray-500 text-xs">Drag · Scroll · Click the planets</span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const EMPTY_TRACKING = { dataRef: null, gesture: 'none', isActive: false };

export default function App() {
  const [selectedNode, setSelectedNode]     = useState(null);
  const [selectedPlanetId, setSelectedPlanetId] = useState(null);
  // Hand and eye tracking each populate their own state. Hand wins when both
  // are active (it's the higher-precision marquee feature); eye is the
  // fallback hands-free path. Either source feeds the SAME GestureRaycaster
  // dwell pipeline downstream, so consumers don't need to know which is live.
  const [handData, setHandData] = useState(EMPTY_TRACKING);
  const [eyeData,  setEyeData]  = useState(EMPTY_TRACKING);
  const gestureData = handData.isActive ? handData : eyeData;

  const dwellRingRef = useRef(null);
  const handleDwellProgress = useCallback((progress) => {
    const ring = dwellRingRef.current;
    if (!ring) return;
    const circumference = 2 * Math.PI * 14;
    ring.setAttribute('stroke-dasharray', `${progress * circumference} ${circumference}`);
    ring.style.opacity = progress > 0 ? '1' : '0';
  }, []);

  const cursorRef = useRef(null);
  useEffect(() => {
    if (!gestureData.isActive || !gestureData.dataRef) return;
    let raf;
    const tick = () => {
      const el = cursorRef.current;
      if (el) {
        const p = gestureData.dataRef.current.pointerNorm;
        if (p) {
          el.style.left = `${p.x * 100}%`;
          el.style.top  = `${p.y * 100}%`;
          el.style.opacity = '1';
        } else {
          el.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gestureData.isActive, gestureData.dataRef]);

  const handlePlanetSelect = useCallback((id) => {
    setSelectedPlanetId(id);
  }, []);

  const handleNodeSelect = useCallback((node) => {
    setSelectedNode(node);
  }, []);

  const handleProjectSelect = useCallback((type) => {
    setSelectedNode(PROJECTS_DATA[type]);
  }, []);

  const handleClose = useCallback(() => {
    const wasProjectsList = selectedNode?.content?.type === 'projects_list';
    setSelectedNode(null);
    if (!wasProjectsList) {
      setSelectedPlanetId(null);
    }
  }, [selectedNode]);

  const handleDeselect = useCallback(() => {
    setSelectedNode(null);
    setSelectedPlanetId(null);
  }, []);

  const handleVoiceCommand = useCallback((cmd) => {
    if (cmd === '__back') {
      if (selectedNode) {
        const wasProjectsList = selectedNode.content?.type === 'projects_list';
        setSelectedNode(null);
        if (!wasProjectsList) setSelectedPlanetId(null);
      } else if (selectedPlanetId) {
        setSelectedPlanetId(null);
      }
      return;
    }
    if (cmd === '__deselect') {
      setSelectedNode(null);
      setSelectedPlanetId(null);
      return;
    }
    const node = NODES.find((n) => n.id === cmd);
    if (!node) return;
    setSelectedPlanetId(node.id);
    setSelectedNode(node.content?.type === 'projects_hub' ? null : node);
  }, [selectedNode, selectedPlanetId]);

  const focusedCategory =
    selectedNode?.category
    ?? NODES.find((n) => n.id === selectedPlanetId)?.category
    ?? null;

  const handleGestureData = useCallback((data) => {
    setHandData(data);
  }, []);

  const handleEyeData = useCallback((data) => {
    setEyeData(data);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape' && !selectedNode && selectedPlanetId) {
        setSelectedPlanetId(null);
        return;
      }

      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= NODES.length) {
        const node = NODES[idx - 1];
        setSelectedPlanetId(node.id);
        setSelectedNode(node.content?.type === 'projects_hub' ? null : node);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode, selectedPlanetId]);

  useEffect(() => {
    if (gestureData.gesture !== 'palm') return;
    if (selectedNode?.content?.type === 'projects_list') {
      setSelectedNode(null);
    } else if (selectedNode) {
      setSelectedNode(null);
      setSelectedPlanetId(null);
    } else if (selectedPlanetId) {
      setSelectedPlanetId(null);
    }
  }, [gestureData.gesture]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-brand-bg">
      <NavBar
        onVoiceCommand={handleVoiceCommand}
        focusedCategory={focusedCategory}
        onEyeData={handleEyeData}
      />
      <GestureFloater onGestureData={handleGestureData} />

      <div className="absolute inset-0">
        <Suspense fallback={<LoadingScreen />}>
          <Scene3D
            onNodeSelect={handleNodeSelect}
            onPlanetSelect={handlePlanetSelect}
            onProjectSelect={handleProjectSelect}
            onDeselect={handleDeselect}
            selectedPlanetId={selectedPlanetId}
            gestureMode={gestureData.isActive}
            gestureDataRef={gestureData.dataRef}
            gesture={gestureData.gesture}
            onDwellProgress={handleDwellProgress}
            cardOpen={!!selectedNode}
          />
        </Suspense>
      </div>

      <AnimatePresence>
        {selectedPlanetId === 'projects' && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 5, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.72) 100%)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPlanetId && !selectedNode && (
          <motion.button
            className="fixed bottom-8 left-1/2 z-30 flex items-center gap-2
                       px-5 py-2.5 lg-surface lg-pill text-xs text-gray-300 hover:text-white
                       transition-colors"
            initial={{ opacity: 0, y: 10, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 10, x: '-50%' }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleDeselect}
          >
            <ArrowLeft size={13} strokeWidth={2} /> Back
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {IS_MOBILE && selectedPlanetId === 'projects' && !selectedNode && (
          <motion.div
            className="fixed z-20 left-0 right-0 flex justify-center gap-4 px-6"
            style={{ bottom: '5rem' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.1 }}
          >
            <button
              onClick={() => handleProjectSelect('personal')}
              className="flex-1 lg-surface lg-card lg-tint-purple py-3.5 px-4 flex flex-col items-center gap-1.5"
            >
              <Code2 size={20} strokeWidth={1.75} className="text-[#c4b5fd]" />
              <span className="font-mono text-[13px] font-semibold tracking-wider text-[#c4b5fd]">Personal</span>
              <span className="font-mono text-[10px] text-[#c4b5fd]/60">Side projects</span>
            </button>
            <button
              onClick={() => handleProjectSelect('work')}
              className="flex-1 lg-surface lg-card lg-tint-blue py-3.5 px-4 flex flex-col items-center gap-1.5"
            >
              <Building2 size={20} strokeWidth={1.75} className="text-[#93c5fd]" />
              <span className="font-mono text-[13px] font-semibold tracking-wider text-[#93c5fd]">Work</span>
              <span className="font-mono text-[10px] text-[#93c5fd]/60">Swisscom apps</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <HeroText hasSelectedNode={!!selectedNode || !!selectedPlanetId} />

      <NodeCard
        node={selectedNode}
        onClose={handleClose}
      />

      {gestureData.isActive && !selectedNode && (
        <div
          ref={cursorRef}
          className="pointer-events-none fixed z-40"
          style={{
            left: '-100px',
            top: '-100px',
            opacity: 0,
            transform: 'translate(-50%, -50%)',
            transition: 'opacity 0.15s',
          }}
        >
          <svg width="44" height="44" style={{ overflow: 'visible' }}>
            <circle cx="22" cy="22" r="4" fill="#00ffcc" opacity="0.9" />
            <circle cx="22" cy="22" r="14" fill="none" stroke="rgba(0,255,204,0.18)" strokeWidth="1.5" />
            <circle
              ref={dwellRingRef}
              cx="22" cy="22" r="14"
              fill="none"
              stroke="#00ffcc"
              strokeWidth="2.5"
              strokeDasharray="0 87.96"
              strokeLinecap="round"
              transform="rotate(-90 22 22)"
              style={{ opacity: 0 }}
            />
          </svg>
        </div>
      )}

      <HUD gestureMode={gestureData.isActive} />

      <MultiplayerCursors />

      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(10,10,10,0.7) 100%)',
        }}
      />
    </div>
  );
}
