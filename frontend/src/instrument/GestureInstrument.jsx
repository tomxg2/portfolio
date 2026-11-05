import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Circle, Download, Hand, MousePointer2, Pause, Play, Square, Volume2, VolumeX, Webcam, X } from 'lucide-react';
import { useHandTracking } from '../hooks/useHandTracking.js';
import { createInstrument, makeScale, normalized, noteAtPosition, NOTE_NAMES, SCALES, VOICES } from './instrumentAudio.js';
import SoundField from './SoundField.jsx';
import './instrument.css';

const KEY_CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL'];
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export default function GestureInstrument() {
  const [audioStatus, setAudioStatus] = useState('off');
  const [inputMode, setInputMode] = useState('pointer');
  const [voice, setVoice] = useState('glass');
  const [root, setRoot] = useState('D');
  const [scale, setScale] = useState('pentatonic');
  const [volume, setVolume] = useState(55);
  const [space, setSpace] = useState(45);
  const [error, setError] = useState('');
  const [display, setDisplay] = useState({ note: '--', level: 0, active: false, brightness: 0.5 });
  const [recordPhase, setRecordPhase] = useState('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recording, setRecording] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const engineRef = useRef(null);
  const enabledRef = useRef(false);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const focusedRef = useRef(true);
  const stageRef = useRef(null);
  const cursorRef = useRef(null);
  const pointerRef = useRef({ active: false, x: 0.5, y: 0.5 });
  const keysRef = useRef(new Map());
  const padRef = useRef(null);
  const tapRef = useRef(null);
  const playbackRef = useRef(null);
  const recordingRef = useRef(null);
  const settingsRef = useRef({ volume, space, voice });
  const recordPhaseRef = useRef('idle');
  const recordStartRef = useRef(0);
  const signalRef = useRef({ active: false, x: 0.5, brightness: 0.5, level: 0, waveform: new Float32Array(128) });
  const tracking = useHandTracking();
  const { isActive, isLoading, gesture, dataRef, startTracking, stopTracking } = tracking;
  const notes = makeScale(root, scale);
  const controlsRef = useRef({ notes, inputMode, gesture, isActive });

  useEffect(() => { controlsRef.current = { notes, inputMode, gesture, isActive }; }, [notes, inputMode, gesture, isActive]);

  const finishRecording = useCallback(async () => {
    if (recordPhaseRef.current !== 'recording') return;
    recordPhaseRef.current = 'stopping';
    setRecordPhase('stopping');
    const engine = engineRef.current;
    try {
      const blob = await engine.stopRecording();
      if (!mountedRef.current || engine !== engineRef.current) return;
      playbackRef.current?.pause();
      if (recordingRef.current) URL.revokeObjectURL(recordingRef.current.url);
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      const take = { url: URL.createObjectURL(blob), extension, bytes: blob.size, seconds: Math.max(1, Math.round((performance.now() - recordStartRef.current) / 1000)) };
      recordingRef.current = take;
      setRecording(take);
      setPlaying(false);
    } catch {
      if (mountedRef.current) setError('The recording could not be saved.');
    } finally {
      recordPhaseRef.current = 'idle';
      if (mountedRef.current) setRecordPhase('idle');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const previousTitle = document.title;
    document.title = 'Airform | Gesture Instrument';
    return () => {
      document.title = previousTitle;
      mountedRef.current = false;
      enabledRef.current = false;
      engineRef.current?.dispose();
      engineRef.current = null;
      if (recordingRef.current) URL.revokeObjectURL(recordingRef.current.url);
    };
  }, []);

  useEffect(() => {
    let frame;
    let lastDisplay = 0;
    const tick = (time) => {
      const controls = controlsRef.current;
      const pointer = pointerRef.current;
      if (tapRef.current && time >= tapRef.current.until) tapRef.current = null;
      const tap = tapRef.current;
      const keyboardIndex = [...keysRef.current.values()].at(-1);
      const padIndex = padRef.current;
      const hand = controls.inputMode === 'hands' && controls.isActive ? dataRef.current.pointerNorm : null;
      const handPlaying = !!hand && controls.gesture === 'pinch';
      const selectedIndex = tap?.index ?? keyboardIndex ?? padIndex;
      const position = selectedIndex != null
        ? { x: (selectedIndex + 0.5) / controls.notes.length, y: pointer.y }
        : hand ?? pointer;
      const active = enabledRef.current && focusedRef.current && !document.hidden &&
        (selectedIndex != null || (controls.inputMode === 'hands' ? handPlaying : pointer.active || tap?.pointer));
      const note = noteAtPosition(controls.notes, position.x);
      const brightness = 1 - normalized(position.y);
      const engine = engineRef.current;
      if (active && note) engine?.play(note.midi, brightness);
      else engine?.release();
      const waveform = engine?.waveform() ?? signalRef.current.waveform;
      let squared = 0;
      for (const sample of waveform) squared += sample * sample;
      const level = Math.min(1, Math.sqrt(squared / waveform.length) * 7);
      signalRef.current = { active, x: normalized(position.x), brightness, level, waveform };
      if (cursorRef.current) {
        cursorRef.current.style.left = `${normalized(position.x) * 100}%`;
        cursorRef.current.style.top = `${normalized(position.y) * 100}%`;
        cursorRef.current.style.opacity = active ? '1' : '0';
      }
      if (time - lastDisplay > 80) {
        lastDisplay = time;
        setDisplay({ note: active ? note.label : '--', level, active, brightness });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dataRef]);

  useEffect(() => {
    const release = () => {
      pointerRef.current.active = false;
      keysRef.current.clear();
      padRef.current = null;
      tapRef.current = null;
      engineRef.current?.release();
    };
    const onBlur = () => { focusedRef.current = false; release(); };
    const onFocus = () => { focusedRef.current = true; };
    const onVisibility = () => {
      if (document.hidden) { release(); void finishRecording(); }
    };
    const onKeyDown = (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target?.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return;
      if (event.key === 'Escape') { release(); return; }
      const index = KEY_CODES.indexOf(event.code);
      if (index < 0 || index >= controlsRef.current.notes.length || !enabledRef.current) return;
      event.preventDefault();
      keysRef.current.set(event.code, index);
      tapRef.current = { index, until: performance.now() + 100 };
    };
    const onKeyUp = (event) => keysRef.current.delete(event.code);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [finishRecording]);

  useEffect(() => {
    if (!tracking.error) return;
    stopTracking();
    setInputMode('pointer');
    setError(tracking.error === 'camera_denied' ? 'Camera access was denied.' : 'Hand tracking could not start.');
  }, [tracking.error, stopTracking]);

  useEffect(() => {
    if (recordPhase !== 'recording') return;
    const timer = setInterval(() => {
      const seconds = Math.floor((performance.now() - recordStartRef.current) / 1000);
      setRecordSeconds(seconds);
      if (seconds >= 120) void finishRecording();
    }, 250);
    return () => clearInterval(timer);
  }, [recordPhase, finishRecording]);

  const enableAudio = async () => {
    if (startingRef.current) return;
    if (enabledRef.current) {
      enabledRef.current = false;
      engineRef.current?.release();
      engineRef.current?.setVolume(0);
      playbackRef.current?.pause();
      pointerRef.current.active = false;
      keysRef.current.clear();
      padRef.current = null;
      tapRef.current = null;
      setAudioStatus('off');
      void finishRecording();
      return;
    }
    startingRef.current = true;
    setAudioStatus('starting');
    setError('');
    try {
      const engine = engineRef.current ?? await createInstrument({ volume: volume / 100, space: space / 100, voice });
      await engine.resume();
      if (!mountedRef.current) { engine.dispose(); return; }
      engineRef.current = engine;
      engine.setVolume(settingsRef.current.volume / 100);
      engine.setSpace(settingsRef.current.space / 100);
      engine.setVoice(settingsRef.current.voice);
      enabledRef.current = true;
      focusedRef.current = true;
      setRecordingSupported(engine.recordingSupported);
      setAudioStatus('on');
      stageRef.current?.focus({ preventScroll: true });
    } catch {
      if (mountedRef.current) { setError('Audio could not start in this browser.'); setAudioStatus('off'); }
    } finally { startingRef.current = false; }
  };

  const changeInput = (mode) => {
    setError('');
    pointerRef.current.active = false;
    keysRef.current.clear();
    tapRef.current = null;
    engineRef.current?.release();
    setInputMode(mode);
    if (mode === 'hands') void startTracking();
    else stopTracking();
  };

  const updatePointer = (event) => {
    const bounds = stageRef.current.getBoundingClientRect();
    pointerRef.current.x = normalized((event.clientX - bounds.left) / bounds.width);
    pointerRef.current.y = normalized((event.clientY - bounds.top) / bounds.height);
  };

  const toggleRecording = async () => {
    if (recordPhaseRef.current === 'recording') { await finishRecording(); return; }
    if (recordPhaseRef.current !== 'idle' || !enabledRef.current) return;
    recordPhaseRef.current = 'starting';
    setRecordPhase('starting');
    setError('');
    playbackRef.current?.pause();
    try {
      await engineRef.current.startRecording();
      if (!mountedRef.current) return;
      recordStartRef.current = performance.now();
      recordPhaseRef.current = 'recording';
      setRecordSeconds(0);
      setRecordPhase('recording');
    } catch {
      recordPhaseRef.current = 'idle';
      if (mountedRef.current) { setRecordPhase('idle'); setError('Recording is unavailable in this browser.'); }
    }
  };

  const playRecording = async () => {
    if (!playbackRef.current) return;
    if (playing) { playbackRef.current.pause(); return; }
    try { playbackRef.current.volume = volume / 100; await playbackRef.current.play(); }
    catch { setError('This recording could not be played.'); }
  };

  const activeVoice = VOICES[voice];
  const isRecording = recordPhase === 'recording';

  return (
    <main className="airform" style={{ '--air-accent': activeVoice.color }}>
      <header className="airform-header">
        <div className="airform-brand"><a href="/lab" aria-label="Back to galaxy" title="Back to galaxy"><ArrowLeft size={19} /></a><div><h1>Airform<span>.</span></h1><p>Gesture instrument</p></div></div>
        <div className="airform-inputs" role="group" aria-label="Input mode">
          <button type="button" aria-pressed={inputMode === 'pointer'} onClick={() => changeInput('pointer')}><MousePointer2 size={15} /> <span>Pointer</span></button>
          <button type="button" aria-pressed={inputMode === 'hands'} disabled={isLoading && inputMode === 'hands'} onClick={() => changeInput('hands')} title="Hand tracking: pinch to play"><Hand size={16} /> <span>Hands</span></button>
        </div>
        <button className="airform-audio" type="button" aria-label={audioStatus === 'on' ? 'Mute instrument' : 'Enable audio'} onClick={enableAudio} disabled={audioStatus === 'starting'}>
          {audioStatus === 'on' ? <Volume2 size={18} /> : <VolumeX size={18} />}<span>{audioStatus === 'starting' ? 'Starting...' : audioStatus === 'on' ? 'Audio on' : 'Audio off'}</span>
        </button>
      </header>

      {error && <div className="airform-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

      <section className="airform-stage" ref={stageRef} tabIndex={0} aria-label="Pitch and tone performance surface"
        onPointerDown={(event) => {
          if (!event.isPrimary || inputMode !== 'pointer' || !enabledRef.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerRef.current.active = true;
          tapRef.current = { pointer: true, until: performance.now() + 100 };
          updatePointer(event);
          event.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={updatePointer}
        onPointerUp={() => { pointerRef.current.active = false; }}
        onPointerCancel={() => { pointerRef.current.active = false; tapRef.current = null; }}
        onLostPointerCapture={() => { pointerRef.current.active = false; }}>
        <div className="airform-field" aria-hidden="true"><SoundField signalRef={signalRef} color={activeVoice.color} /></div>
        <div className="airform-stage-meta"><span><i className={display.active ? 'active' : ''} />{inputMode === 'hands' ? isLoading ? 'Camera starting' : isActive ? gesture === 'pinch' ? 'Pinch' : 'Hands ready' : 'Camera off' : 'Live instrument'}</span><span>{root} / {SCALES[scale].label}</span></div>
        <div className="airform-note"><span className="airform-small-label">Pitch</span><output aria-label="Current note" aria-live="off">{display.note}</output></div>
        <div className="airform-cursor" ref={cursorRef} aria-hidden="true"><span /><i /></div>
        {audioStatus !== 'on' && <div className="airform-start"><AudioLines size={30} /><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={enableAudio} disabled={audioStatus === 'starting'}><Play size={16} fill="currentColor" />{audioStatus === 'starting' ? 'Starting audio...' : 'Start playing'}</button></div>}
        <div className="airform-axis" aria-hidden="true"><span>{notes[0].label}</span><span>Pitch</span><span>{notes.at(-1).label}</span></div>
      </section>

      <aside className={`airform-camera ${inputMode === 'hands' ? 'is-visible' : ''}`} aria-hidden={inputMode !== 'hands'}>
        <video ref={tracking.videoRef} muted playsInline autoPlay />
        <canvas ref={tracking.canvasRef} width="320" height="240" />
        <span><Webcam size={12} />{isLoading ? 'Starting' : 'Local camera'}</span>
      </aside>

      <section className="airform-controls" aria-label="Instrument controls">
        <div className="airform-settings">
          <fieldset className="airform-voices"><legend>Voice</legend><div>{Object.entries(VOICES).map(([id, preset]) => <button key={id} type="button" aria-pressed={voice === id} onClick={() => { settingsRef.current.voice = id; setVoice(id); engineRef.current?.setVoice(id); }}><i style={{ background: preset.color }} />{preset.label}</button>)}</div></fieldset>
          <label className="airform-select">Key<select value={root} onChange={(event) => { setRoot(event.target.value); keysRef.current.clear(); padRef.current = null; tapRef.current = null; }}>{NOTE_NAMES.map((note) => <option key={note}>{note}</option>)}</select></label>
          <label className="airform-select airform-scale">Scale<select value={scale} onChange={(event) => { setScale(event.target.value); keysRef.current.clear(); padRef.current = null; tapRef.current = null; }}>{Object.entries(SCALES).map(([id, mode]) => <option key={id} value={id}>{mode.label}</option>)}</select></label>
          <label className="airform-slider">Space <output aria-hidden="true">{space}%</output><input aria-label="Space" type="range" min="0" max="100" value={space} onChange={(event) => { const value = Number(event.target.value); settingsRef.current.space = value; setSpace(value); engineRef.current?.setSpace(value / 100); }} /></label>
          <label className="airform-slider">Volume <output aria-hidden="true">{volume}%</output><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => { const value = Number(event.target.value); settingsRef.current.volume = value; setVolume(value); engineRef.current?.setVolume(enabledRef.current ? value / 100 : 0); if (playbackRef.current) playbackRef.current.volume = value / 100; }} /></label>
        </div>
        <div className="airform-keybed" role="group" aria-label="Playable notes">
          {notes.map((note, index) => <button type="button" key={note.midi} disabled={audioStatus !== 'on'} aria-label={`Play ${note.label}`} aria-pressed={display.active && display.note === note.label}
            onPointerDown={(event) => { if (!event.isPrimary) return; event.currentTarget.setPointerCapture(event.pointerId); padRef.current = index; tapRef.current = { index, until: performance.now() + 100 }; }}
            onPointerUp={() => { padRef.current = null; }} onPointerCancel={() => { padRef.current = null; }} onLostPointerCapture={() => { padRef.current = null; }}
            onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); padRef.current = index; tapRef.current = { index, until: performance.now() + 100 }; } }}
            onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') padRef.current = null; }} onBlur={() => { if (padRef.current === index) padRef.current = null; }}><span>{note.label}</span></button>)}
        </div>
        <div className="airform-transport">
          <div className="airform-recording"><button type="button" className={isRecording ? 'is-recording' : ''} aria-label={isRecording ? 'Stop recording' : 'Record performance'} title={recordingSupported ? 'Record performance' : 'Recording is not supported in this browser'} disabled={audioStatus !== 'on' || !recordingSupported || recordPhase === 'starting' || recordPhase === 'stopping'} onClick={toggleRecording}>{isRecording ? <Square size={15} fill="currentColor" /> : <Circle size={15} fill="currentColor" />}</button><span className="airform-time">{formatTime(isRecording ? recordSeconds : recording?.seconds ?? 0)}</span><span className="airform-record-status">{isRecording ? 'Recording' : recordPhase === 'stopping' ? 'Saving...' : recording ? 'Take 01' : 'Recorder'}</span></div>
          <div className="airform-take">{recording && <><button type="button" onClick={playRecording} disabled={recordPhase !== 'idle'} aria-label={playing ? 'Pause recording playback' : 'Play recording'} title={playing ? 'Pause recording' : 'Play recording'}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><a href={recording.url} download={`airform-take.${recording.extension}`} aria-label="Download recording" title="Download recording"><Download size={17} /></a><audio ref={playbackRef} src={recording.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /></>}</div>
          <div className="airform-output"><span>Output</span><div role="meter" aria-label="Output level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(display.level * 100)}><i style={{ transform: `scaleX(${display.level})` }} /></div></div>
        </div>
      </section>
    </main>
  );
}