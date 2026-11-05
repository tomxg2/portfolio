import { Component, useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Code2, Building2, ArrowLeft, UserRound, Mail, FolderCode, Menu, BriefcaseBusiness, GraduationCap, Heart } from 'lucide-react';
import NodeCard from './components/NodeCard.jsx';
import SunTransition from './components/SunTransition.jsx';
import HUD from './components/HUD.jsx';
import GestureControl from './components/GestureControl.jsx';
import VoiceControl from './components/VoiceControl.jsx';
import MusicControl from './components/MusicControl.jsx';
import VRButton from './components/VRButton.jsx';
import EyeTrackingControl from './components/EyeTrackingControl.jsx';
import MultiplayerCursors from './components/MultiplayerCursors.jsx';
import CockpitToggle from './cockpit/CockpitToggle.jsx';
import WakeUp, { seenWake, markWake } from './cockpit/WakeUp.jsx';
import { useShipStore } from './cockpit/useShipStore.js';
import { PROJECTS_DATA, NODES, CATEGORY_COLORS } from './data/nodes.js';
import { IS_MOBILE } from './lib/device.js';

// Lazy-load the heavy 3D scene so it doesn't block initial paint
const Scene3D = lazy(() => import('./components/Scene3D.jsx'));

class SceneErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onUnavailable();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="status" className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">
          The 3D scene could not be loaded.
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingScreen() {
  return (
    <div className="pointer-events-none fixed inset-0 bg-brand-bg flex items-center justify-center z-10">
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

function NavBar({ onVoiceCommand, focusedCategory, onEyeData, sceneAvailable }) {
  return (
    <motion.nav
      aria-label="Experience controls"
      className="pointer-events-auto inline-flex items-center gap-3
                 px-3 py-1.5 lg-surface lg-pill"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <a href="/" aria-label="Back to portfolio" className="flex items-center gap-2.5 text-sm text-white">
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Portfolio</span>
      </a>

      <span className="w-px h-5 bg-white/10" aria-hidden="true" />

      <div className="flex items-center gap-1.5">
        <MusicControl focusedCategory={focusedCategory} />
        <VoiceControl onCommand={onVoiceCommand} />
        {sceneAvailable && <EyeTrackingControl onTrackingData={onEyeData} />}
        {sceneAvailable && <VRButton />}
      </div>
    </motion.nav>
  );
}

// Top-right control row: cockpit toggle + gesture CTA. Gestures only drive the
// solar view, so the CTA is hidden (kept mounted, tracking state intact)
// while you're inside the ship.
function TopRightControls({ onGestureData, onEnterCockpit, onExitCockpit, inSolar }) {
  return (
    <motion.div
      className="pointer-events-auto ml-auto flex items-center gap-2"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <CockpitToggle onEnter={onEnterCockpit} onExit={onExitCockpit} />
      <div className={inSolar ? 'contents' : 'hidden'}>
        <GestureControl onGestureData={onGestureData} />
      </div>
    </motion.div>
  );
}

const SECTION_ICONS = {
  about: UserRound,
  contact: Mail,
  skills: Code2,
  experience: BriefcaseBusiness,
  projects: FolderCode,
  learning: GraduationCap,
  interests: Heart,
};

function SectionNavigation({ selectedPlanetId, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const navigationRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    if (!expanded) return;
    navigationRef.current?.querySelector('#portfolio-sections button')?.focus();
    const onPointerDown = (event) => {
      if (!navigationRef.current?.contains(event.target)) setExpanded(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setExpanded(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [expanded]);

  return (
    <nav ref={navigationRef} aria-label="Portfolio sections" className="fixed bottom-6 left-4 sm:left-8 z-30 max-w-[calc(100%-2rem)]">
      {expanded && (
        <div id="portfolio-sections" className="absolute bottom-full left-0 mb-3 w-64 max-w-full p-1.5 lg-surface lg-panel rounded-lg">
          {NODES.map((node) => {
            const Icon = SECTION_ICONS[node.id];
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  menuButtonRef.current?.focus();
                  setExpanded(false);
                  onSelect(node);
                }}
                aria-pressed={selectedPlanetId === node.id}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-gray-200 hover:bg-white/10 hover:text-white"
              >
                <Icon size={16} aria-hidden="true" style={{ color: CATEGORY_COLORS[node.category] }} />
                {node.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-1 p-1.5 lg-surface lg-pill">
        {['about', 'projects', 'contact'].map((id) => {
          const node = NODES.find((section) => section.id === id);
          const Icon = SECTION_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => { setExpanded(false); onSelect(node); }}
              aria-pressed={selectedPlanetId === id}
              className="flex min-h-10 items-center gap-2 rounded-full px-2.5 sm:px-3 text-xs text-gray-200 hover:bg-white/10 hover:text-white"
            >
              <Icon size={15} aria-hidden="true" className="hidden min-[380px]:block" />
              {node.label}
            </button>
          );
        })}
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="All sections"
          title="All sections"
          aria-expanded={expanded}
          aria-controls="portfolio-sections"
          onClick={() => setExpanded((open) => !open)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-200 hover:bg-white/10 hover:text-white"
        >
          <Menu size={17} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function HeroText({ hasSelectedNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {!hasSelectedNode && (
        <motion.div
          className="absolute bottom-28 left-4 sm:left-8 pointer-events-none z-10 max-w-[calc(100%-2rem)] sm:max-w-sm"
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
  const [sunTransition, setSunTransition]   = useState(false);
  const [wakeOpen, setWakeOpen]             = useState(false);
  const [sceneUnavailable, setSceneUnavailable] = useState(false);
  const sunTransitionTimer = useRef(null);
  const setMode = useShipStore((s) => s.setMode);
  const enterCockpit = useShipStore((s) => s.enterCockpit);
  const exitCockpit = useShipStore((s) => s.exitCockpit);
  const mode = useShipStore((s) => s.mode);
  const showSolarHud = mode === 'solar';

  const cancelSunTransition = useCallback(() => {
    clearTimeout(sunTransitionTimer.current);
    setSunTransition(false);
  }, []);

  useEffect(() => () => clearTimeout(sunTransitionTimer.current), []);

  const handleSceneUnavailable = useCallback(() => {
    cancelSunTransition();
    setSceneUnavailable(true);
    setWakeOpen(false);
    setMode('solar');
  }, [cancelSunTransition, setMode]);

  // First boarding ever (button or 3D ship click) plays the WakeUp intro;
  // it flips the ship store itself at the black point of its exit fade.
  const handleEnterCockpit = useCallback(() => {
    cancelSunTransition();
    setSelectedNode(null);
    setSelectedPlanetId(null);
    if (!seenWake()) { setWakeOpen(true); return; }
    enterCockpit();
  }, [enterCockpit, cancelSunTransition]);

  const handleExitCockpit = useCallback(() => {
    cancelSunTransition();
    setSelectedNode(null);
    setSelectedPlanetId(null);
    exitCockpit();
  }, [exitCockpit, cancelSunTransition]);
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
    cancelSunTransition();
    setSelectedPlanetId(id);
  }, [cancelSunTransition]);

  const handleNodeSelect = useCallback((node) => {
    cancelSunTransition();
    // Sun click gets a full-screen warp overlay; the card slides in as the
    // video fades to black so the two motions overlap and feel continuous.
    // Skipped for users who prefer reduced motion — the card opens directly.
    const reduceMotion = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (node?.id === 'about' && !selectedNode && !sunTransition && !reduceMotion) {
      setSunTransition(true);
      clearTimeout(sunTransitionTimer.current);
      sunTransitionTimer.current = setTimeout(() => setSelectedNode(node), 1350);
      return;
    }
    setSelectedNode(node);
  }, [selectedNode, sunTransition, cancelSunTransition]);

  const handleProjectSelect = useCallback((type) => {
    cancelSunTransition();
    setSelectedNode(PROJECTS_DATA[type]);
  }, [cancelSunTransition]);

  const handleSectionSelect = useCallback((node) => {
    cancelSunTransition();
    setSelectedPlanetId(node.id);
    setSelectedNode(node.content?.type === 'projects_hub' ? null : node);
  }, [cancelSunTransition]);

  const handleClose = useCallback(() => {
    cancelSunTransition();
    const wasProjectsList = selectedNode?.content?.type === 'projects_list';
    setSelectedNode(null);
    if (!wasProjectsList) setSelectedPlanetId(null);
    if (useShipStore.getState().mode === 'section') setMode('cockpit');
  }, [selectedNode, setMode, cancelSunTransition]);

  const handleDeselect = useCallback(() => {
    cancelSunTransition();
    setSelectedNode(null);
    setSelectedPlanetId(null);
    if (useShipStore.getState().mode === 'section') setMode('cockpit');
  }, [setMode, cancelSunTransition]);

  const handleVoiceCommand = useCallback((cmd) => {
    if (cmd === '__back') {
      if (selectedNode) {
        handleClose();
      } else if (selectedPlanetId) {
        handleDeselect();
      }
      return;
    }
    if (cmd === '__deselect') {
      handleDeselect();
      return;
    }
    const node = NODES.find((n) => n.id === cmd);
    if (!node) return;
    handleSectionSelect(node);
  }, [selectedNode, selectedPlanetId, handleClose, handleDeselect, handleSectionSelect]);

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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        e.target?.isContentEditable || (selectedNode && e.target?.closest('[role="dialog"]')) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape' && !selectedNode) {
        handleDeselect();
        return;
      }

      if (e.defaultPrevented) return;

      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= NODES.length) {
        const node = NODES[idx - 1];
        handleSectionSelect(node);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode, selectedPlanetId, handleSectionSelect, handleDeselect]);

  useEffect(() => {
    if (gestureData.gesture !== 'palm') return;
    if (selectedNode) {
      handleClose();
    } else if (selectedPlanetId) {
      handleDeselect();
    }
  }, [gestureData.gesture]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="relative w-full h-screen overflow-hidden bg-brand-bg" style={{ height: '100dvh' }}>
      <header className="pointer-events-none fixed top-4 left-4 right-4 z-30 flex flex-wrap items-start justify-between gap-2">
        <NavBar
          onVoiceCommand={handleVoiceCommand}
          focusedCategory={focusedCategory}
          onEyeData={handleEyeData}
          sceneAvailable={!sceneUnavailable}
        />
        {!sceneUnavailable && <TopRightControls
          onGestureData={handleGestureData}
          onEnterCockpit={handleEnterCockpit}
          onExitCockpit={handleExitCockpit}
          inSolar={showSolarHud}
        />}
      </header>

      {showSolarHud && <SectionNavigation selectedPlanetId={selectedPlanetId} onSelect={handleSectionSelect} />}

      <div className="absolute inset-0">
        <SceneErrorBoundary onUnavailable={handleSceneUnavailable}>
          <Suspense fallback={<LoadingScreen />}>
          <Scene3D
            onNodeSelect={handleNodeSelect}
            onPlanetSelect={handlePlanetSelect}
            onProjectSelect={handleProjectSelect}
            onEnterCockpit={handleEnterCockpit}
            onDeselect={handleDeselect}
            selectedPlanetId={selectedPlanetId}
            gestureMode={gestureData.isActive}
            gestureDataRef={gestureData.dataRef}
            gesture={gestureData.gesture}
            onDwellProgress={handleDwellProgress}
            cardOpen={!!selectedNode}
            onUnavailable={handleSceneUnavailable}
          />
          </Suspense>
        </SceneErrorBoundary>
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
            className="fixed top-20 left-4 z-30 flex items-center gap-2
                       px-5 py-2.5 lg-surface lg-pill text-xs text-gray-300 hover:text-white"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleDeselect}
          >
            <ArrowLeft size={13} strokeWidth={2} /> Back
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPlanetId === 'projects' && !selectedNode && (
          <motion.div
            className={`fixed z-20 left-0 right-0 mx-auto flex max-w-md justify-center gap-4 px-4 ${IS_MOBILE || sceneUnavailable ? '' : 'md:hidden'}`}
            style={{ bottom: '6rem' }}
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
              <span className="text-[14px] font-semibold tracking-tight text-[#c4b5fd]">Personal</span>
              <span className="text-[11px] text-gray-400">Side projects</span>
            </button>
            <button
              onClick={() => handleProjectSelect('work')}
              className="flex-1 lg-surface lg-card lg-tint-blue py-3.5 px-4 flex flex-col items-center gap-1.5"
            >
              <Building2 size={20} strokeWidth={1.75} className="text-[#93c5fd]" />
              <span className="text-[14px] font-semibold tracking-tight text-[#93c5fd]">Work</span>
              <span className="text-[11px] text-gray-400">Swisscom apps</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {showSolarHud && <HeroText hasSelectedNode={!!selectedNode || !!selectedPlanetId} />}

      <NodeCard
        node={selectedNode}
        onClose={handleClose}
      />

      <AnimatePresence>
        {sunTransition && (
          <SunTransition onDone={() => setSunTransition(false)} />
        )}
      </AnimatePresence>

      {wakeOpen && (
        <WakeUp
          onBoard={() => { markWake(); enterCockpit(); }}
          onDone={() => setWakeOpen(false)}
        />
      )}

      {gestureData.isActive && !selectedNode && showSolarHud && (
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

      {showSolarHud && <HUD gestureMode={gestureData.isActive} />}

      <MultiplayerCursors />

      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(10,10,10,0.7) 100%)',
        }}
      />
    </main>
  );
}
