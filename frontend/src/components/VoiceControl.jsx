import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';

// Voice control via the Web Speech API. Browser-native, no deps.
// Recognizes loose phrases like "open projects", "show skills", "go back",
// "zurück", "atrás", and resolves them to handlers via fuzzy keyword match.

// Normalisation: lowercase + strip combining diacritics via NFD decomposition
// + drop them with the [̀-ͯ] range. So "Zurück" → "zuruck" and we
// match against "zuruck" keywords. Non-Latin scripts (Cyrillic, CJK) pass
// through unchanged — those are matched as-is.
function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

const COMMANDS = [
  { id: 'about',      keywords: ['about', 'tom', 'sun', 'home'] },
  { id: 'skills',     keywords: ['skill', 'skills', 'tech'] },
  { id: 'projects',   keywords: ['project', 'projects', 'work', 'apps'] },
  { id: 'experience', keywords: ['experience', 'career', 'job', 'job history'] },
  { id: 'learning',   keywords: ['learn', 'learning', 'study', 'studying'] },
  { id: 'interests',  keywords: ['interest', 'interests', 'hobbies', 'hobby'] },
  { id: 'contact',    keywords: ['contact', 'message', 'email', 'reach'] },
  {
    id: '__back',
    // Multilingual back/close/return. Keywords are pre-normalised (lowercase,
    // no diacritics). Transcript runs through `normalize()` before lookup so
    // e.g. "Zurück" → "zuruck" matches the keyword "zuruck".
    keywords: [
      // English
      'back', 'go back', 'close', 'escape', 'exit', 'leave', 'return', 'cancel', 'dismiss',
      // German
      'zuruck', 'schliessen', 'abbrechen', 'beenden', 'raus',
      // French
      'retour', 'retourner', 'fermer', 'annuler', 'sortir', 'quitter',
      // Spanish
      'atras', 'cerrar', 'volver', 'salir', 'cancelar',
      // Italian
      'indietro', 'chiudere', 'tornare', 'uscire', 'annullare',
      // Portuguese
      'voltar', 'fechar', 'sair', 'cancelar',
      // Dutch
      'terug', 'sluiten', 'afsluiten', 'annuleren',
      // Polish
      'wstecz', 'zamknij', 'wyjdz', 'anuluj',
      // Swedish / Norwegian / Danish
      'tillbaka', 'tilbake', 'tilbage', 'stang', 'lukk', 'luk',
      // Russian (Cyrillic — no diacritics to strip)
      'назад', 'закрыть', 'выход',
      // Japanese
      '戻る', '閉じる', '戻して',
      // Mandarin (simplified) — common back/close
      '返回', '关闭', '退出',
      // Korean
      '뒤로', '닫기', '취소',
      // Arabic
      'رجوع', 'إغلاق', 'خروج',
    ],
  },
  { id: '__deselect', keywords: ['deselect', 'reset', 'overview', 'all planets', 'show all'] },
];

function matchCommand(transcript) {
  const norm = normalize(transcript);
  for (const c of COMMANDS) {
    if (c.keywords.some((kw) => norm.includes(kw))) return c.id;
  }
  return null;
}

export default function VoiceControl({ onCommand }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recRef = useRef(null);
  const onCommandRef = useRef(onCommand);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  useEffect(() => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return;
    setSupported(true);
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    // Match the browser's language so the recognizer actually transcribes
    // German/French/etc. words as themselves instead of phonetic English.
    // Falls back to en-US when navigator.language is unavailable.
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript(interim || final);
      if (final) {
        const cmd = matchCommand(final);
        if (cmd) onCommandRef.current?.(cmd);
      }
    };
    rec.onend = () => {
      // If still meant to be listening, restart (Chrome auto-ends after ~60s)
      if (recRef.current?.shouldRestart) {
        try { rec.start(); } catch { /* already started */ }
      } else {
        setListening(false);
      }
    };
    rec.onerror = () => { setListening(false); };
    recRef.current = rec;
    return () => { try { rec.stop(); } catch { /* noop */ } };
  }, []);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) {
      rec.shouldRestart = false;
      try { rec.stop(); } catch { /* noop */ }
      setListening(false);
      setTranscript('');
    } else {
      rec.shouldRestart = true;
      try { rec.start(); setListening(true); } catch { /* already running */ }
    }
  }, [listening]);

  if (!supported) return null;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={`lg-surface lg-pill w-8 h-8 transition-colors flex items-center justify-center flex-shrink-0
                    ${listening ? 'lg-tint-teal text-brand-teal' : 'text-gray-300 hover:text-white'}`}
        aria-label={listening ? 'Stop voice control' : 'Start voice control'}
        title={listening ? 'Stop voice control' : 'Try saying "open projects"'}
      >
        {listening ? (
          <Mic size={14} strokeWidth={1.75} />
        ) : (
          <MicOff size={14} strokeWidth={1.75} />
        )}
      </button>
      {/* Live transcript bubble while listening */}
      {listening && transcript && (
        <div className="absolute top-full right-0 mt-2 max-w-[260px] lg-surface lg-card px-3 py-2
                        text-[11px] text-gray-300 font-mono leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
          “{transcript}”
        </div>
      )}
    </div>
  );
}
