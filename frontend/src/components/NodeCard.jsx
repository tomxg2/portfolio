import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, ArrowUpRight, ChevronRight, CheckCircle2, User,
  Trophy, Gamepad2, Code2, Music,
} from 'lucide-react';
import { CATEGORY_COLORS } from '../data/nodes.js';

// Lucide dropped the GitHub brand icon — inline the official SVG so the
// repo link still reads as "GitHub" instead of a generic glyph.
function GithubIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.97-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.94 10.94 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

// Lucide icon map for the Interests card. Keyed by the `icon` string in nodes.js.
const INTEREST_ICONS = {
  football: Trophy,
  gaming:   Gamepad2,
  coding:   Code2,
  music:    Music,
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Side panel ────────────────────────────────────────────────────────────────
function Card({ color, children, onClose }) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Subtle left-edge dimmer so the 3D scene doesn't fight for attention */}
      <motion.div
        className="fixed inset-0 z-40 pointer-events-none"
        style={{ background: 'linear-gradient(to left, rgba(0,0,0,0.55) 0%, transparent 60%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      />

      {/* Click-outside close area (left of panel) */}
      <motion.div
        className="fixed inset-0 z-40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={onClose}
      />

      {/* Side panel — liquid glass */}
      <motion.div
        role="dialog"
        aria-modal="true"
        className="fixed z-50 top-3 right-3 bottom-3 w-full max-w-[440px]
                   flex flex-col lg-surface lg-panel"
        style={{
          borderRadius: '24px',
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18),
                      0 24px 60px rgba(0,0,0,0.6),
                      0 0 40px ${color}22`,
        }}
        initial={{ x: 'calc(100% + 24px)', opacity: 0.4 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 'calc(100% + 24px)', opacity: 0 }}
        transition={{
          x:       { type: 'spring', stiffness: 320, damping: 34, restDelta: 0.5 },
          opacity: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
          default: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
        }}
      >
        {/* Header — always visible, never scrolls away */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${color}20` }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: color, boxShadow: `0 0 10px ${color}, 0 0 4px ${color}` }}
            />
            <span className="text-[10px] font-mono uppercase tracking-[0.24em] text-gray-500">
              Node
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-all
                       w-8 h-8 flex items-center justify-center rounded-full
                       bg-white/[0.04] border border-white/[0.06]
                       hover:bg-white/10 hover:border-white/20"
            aria-label="Close"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </motion.div>
    </>
  );
}

// ── About content ──────────────────────────────────────────────────────────────
export function AboutCard({ content, color }) {
  return (
    <>
      <div className="flex items-start gap-4 mb-5">
        {/* Photo placeholder */}
        <div
          className="w-20 h-20 rounded-2xl flex-shrink-0 flex items-center justify-center
                     bg-gradient-to-br from-white/5 to-white/10 border border-white/10"
        >
          <User size={32} strokeWidth={1.5} className="text-gray-300" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{content.title}</h2>
          <p className="text-sm mt-0.5" style={{ color }}>{content.subtitle}</p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
            <MapPin size={12} strokeWidth={1.75} className="text-gray-500" />
            <span>{content.location}</span>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {content.bio.map((para, i) => (
          <p key={i} className="text-sm text-gray-300 leading-relaxed">{para}</p>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {[content.company, content.role].map((tag) => (
          <span
            key={tag}
            className="text-xs px-3 py-1 rounded-full border"
            style={{ color, borderColor: `${color}40`, background: `${color}10` }}
          >
            {tag}
          </span>
        ))}
      </div>
    </>
  );
}

// ── Skills content ─────────────────────────────────────────────────────────────
export function SkillsCard({ content }) {
  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-5">{content.subtitle}</p>
      <div className="space-y-4">
        {content.groups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: group.color }}>
              {group.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => (
                <span
                  key={item}
                  className="text-xs px-2.5 py-1 rounded-md bg-white/5 text-gray-300 transition-all cursor-default"
                  style={{ border: `1px solid transparent` }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = `${group.color}55`}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Project content ────────────────────────────────────────────────────────────
export function ProjectCard({ content, color }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-xs px-2 py-0.5 rounded-full font-mono"
          style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
        >
          {content.status}
        </span>
        {content.private && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-500">
            Private
          </span>
        )}
      </div>
      <h2 className="text-2xl font-bold text-white mt-2">{content.title}</h2>
      <p className="text-sm mt-0.5 mb-4" style={{ color }}>{content.subtitle}</p>
      <p className="text-sm text-gray-300 leading-relaxed mb-5">{content.description}</p>
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tech Stack</p>
        <div className="flex flex-wrap gap-1.5">
          {content.tech.map((t) => (
            <span key={t} className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 font-mono">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        {content.github && (
          <a
            href={content.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-4 py-2 rounded-lg border border-white/20 text-gray-300
                       hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
          >
            <GithubIcon size={14} /> GitHub
          </a>
        )}
        {content.live && (
          <a
            href={content.live}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-4 py-2 rounded-lg text-black font-medium
                       hover:opacity-90 transition-all flex items-center gap-2"
            style={{ background: color }}
          >
            <ArrowUpRight size={14} strokeWidth={2} /> Live
          </a>
        )}
      </div>
    </>
  );
}

// ── Project list (personal or work sub-node) ──────────────────────────────────
export function ProjectsListCard({ content, color }) {
  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-1">{content.subtitle}</p>
      {content.note && (
        <p className="text-xs text-gray-600 mb-4 italic">{content.note}</p>
      )}
      <div className="space-y-4">
        {content.projects.map((project) => (
          <div
            key={project.title}
            className="p-4 rounded-xl bg-white/3 transition-all"
            style={{ border: '1px solid transparent' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${color}45`}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-mono"
                style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
              >
                {project.status}
              </span>
              {project.private && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-500">
                  Private
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-white leading-tight">{project.title}</h3>
            <p className="text-xs mt-0.5 mb-2" style={{ color }}>{project.subtitle}</p>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">{project.description}</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {project.tech.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-500 font-mono">
                  {t}
                </span>
              ))}
            </div>
            {(project.github || project.live) && (
              <div className="flex gap-2">
                {project.github && (
                  <a
                    href={project.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-gray-400
                               hover:bg-white/8 hover:text-white transition-all inline-flex items-center gap-1.5"
                  >
                    <GithubIcon size={12} /> GitHub
                  </a>
                )}
                {project.live && (
                  <a
                    href={project.live}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg text-black font-medium hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                    style={{ background: color }}
                  >
                    <ArrowUpRight size={12} strokeWidth={2} /> Live
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Experience timeline ────────────────────────────────────────────────────────
export function ExperienceCard({ content, color }) {
  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-6">{content.subtitle}</p>
      <div className="relative pl-5 border-l border-white/10 space-y-7">
        {content.timeline.map((item, i) => {
          const c = item.color ?? color;
          return (
            <div key={i} className="relative">
              {/* Dot */}
              <div
                className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 transition-colors"
                style={{
                  borderColor: c,
                  backgroundColor: item.current ? c : 'transparent',
                }}
              />
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono" style={{ color: c }}>{item.date}</span>
                {item.current && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full text-black font-semibold"
                    style={{ background: c }}
                  >
                    Now
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{item.org}</p>
              {item.bullets && (
                <ul className="mt-2.5 space-y-1.5">
                  {item.bullets.map((b, j) => (
                    <li key={j} className="text-xs text-gray-400 flex gap-1.5 leading-relaxed items-start">
                      <ChevronRight size={12} strokeWidth={2} className="flex-shrink-0 mt-0.5" style={{ color: c }} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Currently learning ─────────────────────────────────────────────────────────
export function LearningCard({ content, color }) {
  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-5">{content.subtitle}</p>
      <div className="space-y-3">
        {content.items.map((item) => {
          const c = item.color ?? color;
          return (
            <div
              key={item.name}
              className="p-3.5 rounded-xl bg-white/3 transition-all"
              style={{ border: `1px solid transparent`, borderLeft: `2px solid ${c}40` }}
              onMouseEnter={e => e.currentTarget.style.borderColor = `${c}45`}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.borderLeftColor = `${c}40`; }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-white">{item.name}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-mono"
                  style={{ color: c, background: `${c}15`, border: `1px solid ${c}30` }}
                >
                  {item.level}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2.5">{item.description}</p>
              <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${item.progress}%`, background: c, opacity: 0.7 }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Interests ──────────────────────────────────────────────────────────────────
export function InterestsCard({ content, color }) {
  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-6">{content.subtitle}</p>
      <div className="space-y-3">
        {content.interests.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-4 p-4 rounded-xl bg-white/3 transition-all"
            style={{ border: '1px solid transparent' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${color}45`}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            {(() => {
              const Icon = INTEREST_ICONS[item.icon] || Trophy;
              return (
                <div className="w-10 flex items-center justify-center shrink-0">
                  <Icon size={22} strokeWidth={1.5} style={{ color }} />
                </div>
              );
            })()}
            <div
              className="w-px self-stretch rounded-full shrink-0"
              style={{ background: `${color}50` }}
            />
            <div>
              <p className="text-sm font-semibold text-white">{item.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Contact form ───────────────────────────────────────────────────────────────
export function ContactCard({ content, color }) {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((er) => ({ ...er, [e.target.name]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim() || form.name.trim().length < 2) e.name = 'Name must be at least 2 characters';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Valid email required';
    if (!form.message.trim() || form.message.trim().length < 10) e.message = 'Message must be at least 10 characters';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setStatus('loading');
    setServerError('');
    try {
      const res = await fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details) {
          const fieldErrors = {};
          data.details.forEach((d) => { fieldErrors[d.field] = d.message; });
          setErrors(fieldErrors);
          setStatus('idle');
        } else {
          throw new Error(data.error || 'Something went wrong');
        }
        return;
      }
      setStatus('success');
    } catch (err) {
      setServerError(err.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center py-8">
        <CheckCircle2 size={48} strokeWidth={1.5} className="mx-auto mb-4 text-brand-teal" />
        <h2 className="text-xl font-bold text-white mb-2">Message sent!</h2>
        <p className="text-sm text-gray-400">Thanks for reaching out. I'll get back to you soon.</p>
      </div>
    );
  }

  const inputClass = (field) =>
    `w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white
     placeholder-gray-600 focus:outline-none focus:ring-1 transition-colors
     ${errors[field]
       ? 'border-red-500/60 focus:ring-red-500/40'
       : 'border-white/10 focus:border-white/30 focus:ring-white/10'}`;

  return (
    <>
      <h2 className="text-2xl font-bold text-white mb-1">{content.title}</h2>
      <p className="text-sm text-gray-400 mb-5">{content.subtitle}</p>

      {serverError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-sm text-red-400">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <input
            type="text"
            name="name"
            placeholder="Your name"
            value={form.name}
            onChange={handleChange}
            className={inputClass('name')}
            disabled={status === 'loading'}
          />
          {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
        </div>
        <div>
          <input
            type="email"
            name="email"
            placeholder="your@email.com"
            value={form.email}
            onChange={handleChange}
            className={inputClass('email')}
            disabled={status === 'loading'}
          />
          {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
        </div>
        <div>
          <textarea
            name="message"
            placeholder="What's on your mind?"
            value={form.message}
            onChange={handleChange}
            rows={4}
            className={`${inputClass('message')} resize-none`}
            disabled={status === 'loading'}
          />
          {errors.message && <p className="text-xs text-red-400 mt-1">{errors.message}</p>}
        </div>
        <button
          type="submit"
          disabled={status === 'loading'}
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-black
                     hover:opacity-90 active:scale-[0.98] transition-all
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: color }}
        >
          {status === 'loading' ? (
            <>
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Sending…
            </>
          ) : 'Send Message'}
        </button>
      </form>
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export default function NodeCard({ node, onClose }) {
  const color = node ? CATEGORY_COLORS[node.category] : '#ffffff';

  return (
    <AnimatePresence>
      {node && (
        <>
          <Card color={color} onClose={onClose}>
            {node.content.type === 'about'         && <AboutCard        content={node.content} color={color} />}
            {node.content.type === 'skills'        && <SkillsCard       content={node.content} />}
            {node.content.type === 'projects_list' && <ProjectsListCard content={node.content} color={color} />}
            {node.content.type === 'experience'    && <ExperienceCard   content={node.content} color={color} />}
            {node.content.type === 'learning'      && <LearningCard     content={node.content} color={color} />}
            {node.content.type === 'interests'     && <InterestsCard    content={node.content} color={color} />}
            {node.content.type === 'contact'       && <ContactCard      content={node.content} color={color} />}
          </Card>
        </>
      )}
    </AnimatePresence>
  );
}
