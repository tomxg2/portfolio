import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ContactCard } from './components/NodeCard.jsx';
import { NODES } from './data/nodes.js';
import AirformWaves from './home/AirformWaves.jsx';
import SolarOrbits from './home/SolarOrbits.jsx';
import './portfolio.css';

const OrbitField = lazy(() => import('./home/OrbitField.jsx'));

const experience = NODES.find((node) => node.id === 'experience').content;
const contact = NODES.find((node) => node.id === 'contact').content;

const navigation = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'experience', label: 'Experience' },
  { id: 'contact', label: 'Contact' },
];

const projects = [
  {
    title: 'Solar system portfolio',
    kind: 'Interactive 3D',
    year: '2025–26',
    description: 'My first portfolio, built as a solar system you fly through. Each planet is a section. You can steer with mouse, touch, webcam hand gestures, or your eyes, and step into a cockpit that has its own flight audio.',
    tech: ['React Three Fiber', 'Three.js', 'MediaPipe', 'WebXR', 'Supabase'],
    art: 'solar',
    href: '/lab',
    cta: 'Fly through it',
  },
  {
    title: 'Airform',
    kind: 'Instrument',
    year: '2026',
    description: 'A browser instrument you play by pinching the air in front of your webcam, or with mouse, touch, and keyboard. Three FM synth voices and a choice of keys and scales. It records takes you can download, and the wave field reacts to the sound.',
    tech: ['Tone.js', 'Web Audio', 'MediaPipe Hands', 'Three.js'],
    art: 'airform',
    href: '/instrument',
    cta: 'Play it',
  },
  {
    title: 'Desk OS',
    kind: 'Interactive site',
    year: '2026',
    description: 'This portfolio again, as a small desktop. Drag windows around, run commands in a working terminal, play a pocket version of Airform, and send me a message from the mail app.',
    tech: ['React', 'Canvas 2D', 'Web Audio', 'Pointer Events'],
    art: 'desk',
    href: '/desk',
    cta: 'Boot it',
  },
  {
    title: 'Powerbuilders apps',
    kind: 'Work · Swisscom',
    year: '2025–',
    description: 'Internal Power Platform apps for Swisscom teams. I shipped EVA/LB, which manages apprentices, and CPP Buddy Notifications. Both are Canvas Apps backed by Power Automate flows and SharePoint, planned in Scrum sprints on Azure DevOps.',
    tech: ['Power Apps', 'Power Automate', 'SharePoint', 'Azure DevOps'],
    internal: ['EVA/LB', 'CPP Buddy Notifications'],
  },
];

const statement = [
  ['I', 'build', 'internal', 'tools', 'at', 'Swisscom', 'by', 'day:', 'Power', 'Apps,', 'flows', 'and', 'SharePoint', 'for', 'teams', 'that', 'need', 'them', 'to', 'just', 'work.'],
  ['After', 'hours', 'I', 'write', 'shaders,', 'synths', 'and', 'hand', 'tracking', 'for', 'the', 'browser.'],
];

const tools = ['React', 'TypeScript', 'Three.js', 'WebGL', 'Node.js', 'Supabase', 'Tone.js', 'MediaPipe', 'Power Apps', 'Power Automate', 'SharePoint', 'Azure DevOps'];

function useZurichTime() {
  const [time, setTime] = useState(() => formatZurich());
  useEffect(() => {
    const id = setInterval(() => setTime(formatZurich()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatZurich() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function useMotionAllowed() {
  const [allowed, setAllowed] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAllowed(!query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return allowed;
}

function Clock() {
  const time = useZurichTime();
  return <span className="mono">ZRH <time aria-label="Local time in Zurich">{time}</time></span>;
}

function ProjectCard({ project, index }) {
  const mediaRef = useRef(null);
  const videoRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const motion = useMotionAllowed();
  const Media = project.href ? 'a' : 'div';

  const onMove = (event) => {
    const rect = mediaRef.current.getBoundingClientRect();
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const onEnter = () => { videoRef.current?.play().catch(() => {}); };
  const onLeave = () => {
    setCursor(null);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  };

  return (
    <article className="work-card reveal" aria-labelledby={`project-${index}`}>
      <Media
        ref={mediaRef}
        className={`work-media${project.image ? '' : project.art ? ` work-media--${project.art}` : ' work-media--type'}`}
        {...(project.href ? { href: project.href, 'aria-label': `${project.cta}: ${project.title}` } : {})}
        onPointerMove={project.href ? onMove : undefined}
        onPointerEnter={project.href ? onEnter : undefined}
        onPointerLeave={project.href ? onLeave : undefined}
      >
        {project.image ? (
          <>
            <img src={project.image} alt={project.alt} width="1920" height="720" loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : undefined} />
            {project.video && <video ref={videoRef} src={project.video} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />}
          </>
        ) : project.art === 'solar' ? (
          <>
            <SolarOrbits animate={motion} />
            <span className="work-art-label mono" aria-hidden="true"><span className="dot" />Live · tilts with your cursor</span>
          </>
        ) : project.art === 'airform' ? (
          <>
            <AirformWaves animate={motion} />
            <span className="work-art-label mono" aria-hidden="true"><span className="dot" />Live · moves with your cursor</span>
          </>
        ) : project.art === 'desk' ? (
          <DeskPreview />
        ) : (
          <div className="work-type" aria-hidden="true">
            {project.internal.map((name) => <span key={name}>{name}</span>)}
          </div>
        )}
        {cursor && <span className="work-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) translate(-50%, -50%)` }} aria-hidden="true">{project.cta} <ArrowUpRight size={14} /></span>}
      </Media>
      <div className="work-info">
        <span className="mono work-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="work-title">
          <h3 id={`project-${index}`}>{project.title}</h3>
          <p className="mono">{project.kind} · {project.year}</p>
        </div>
        <p className="work-description">{project.description}</p>
        <ul className="work-tech" aria-label="Technologies">{project.tech.map((item) => <li key={item}>{item}</li>)}</ul>
        {project.href
          ? <a className="pill-link work-link" href={project.href}>{project.cta} <ArrowUpRight size={15} /></a>
          : <p className="mono work-note">Internal to Swisscom, so there's no public demo.</p>}
      </div>
    </article>
  );
}

function DeskPreview() {
  return (
    <div className="desk-preview" aria-hidden="true">
      <div className="dp-bar"><b>th<span>.</span>os</b><span>About</span><span>Projects</span><span>Contact</span><span className="dp-clock">Zurich</span></div>
      <div className="dp-win dp-about"><i>About.txt</i><p>Tom <em>Hiestand</em></p></div>
      <div className="dp-win dp-projects"><i>Projects</i><div className="dp-orbit"><span /><span /><span /></div></div>
      <div className="dp-win dp-term"><i>Terminal</i><code>tom@zurich ~ % fetch<br />role  apprentice developer<br />stack React · Three.js</code></div>
      <div className="dp-dock"><span /><span /><span /><span /><span /><span /></div>
    </div>
  );
}

function Statement() {
  const ref = useRef(null);
  const [progress, setProgress] = useState(1);
  const motion = useMotionAllowed();
  const total = statement.flat().length;

  useEffect(() => {
    if (!motion) { setProgress(1); return undefined; }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = ref.current.getBoundingClientRect();
      const start = window.innerHeight * 0.85;
      const end = window.innerHeight * 0.3;
      setProgress(Math.min(Math.max((start - rect.top) / (start - end + rect.height * 0.6), 0), 1));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [motion]);

  let count = 0;
  return (
    <p ref={ref} className="statement">
      {statement.map((line, lineIndex) => (
        <span key={lineIndex} className={lineIndex ? 'statement-line serif' : 'statement-line'}>
          {line.map((word, wordIndex) => {
            const lit = count++ / total < progress;
            return <span key={wordIndex} className={lit ? 'is-lit' : undefined}>{word}{' '}</span>;
          })}
        </span>
      ))}
    </p>
  );
}

export default function Portfolio() {
  const [activeSection, setActiveSection] = useState('');
  const [fieldFailed, setFieldFailed] = useState(false);
  const motion = useMotionAllowed();
  const onUnavailable = useCallback(() => setFieldFailed(true), []);

  useEffect(() => {
    document.documentElement.classList.add('home-root');
    const frame = requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
    });
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) setActiveSection(visible[visible.length - 1].target.id);
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    navigation.forEach(({ id }) => observer.observe(document.getElementById(id)));

    const reveals = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-in'); reveals.unobserve(entry.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach((element) => reveals.observe(element));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reveals.disconnect();
      document.documentElement.classList.remove('home-root');
    };
  }, []);

  return (
    <div className="portfolio">
      <a className="portfolio-skip" href="#main-content">Skip to content</a>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Tom Hiestand, home">th<span>.</span></a>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label }) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined}>{label}</a>)}
        </nav>
        <a className="header-github" href="https://github.com/tomxg2" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14} /></a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="portfolio-name">
          <div className={`hero-backdrop${motion && !fieldFailed ? '' : ' is-static'}`} aria-hidden="true">
            {motion && !fieldFailed && <Suspense fallback={null}><OrbitField onUnavailable={onUnavailable} /></Suspense>}
          </div>
          <div className="hero-corners mono">
            <p><span className="dot" aria-hidden="true" />Software developer apprentice</p>
            <p>Swisscom · Zurich, CH</p>
            <p className="hero-clock"><Clock /></p>
          </div>
          <div className="hero-body">
            <p className="hero-lede">I build internal apps and workflow automations at Swisscom. In my own time I make browser experiments with 3D graphics, sound, and hand tracking.</p>
            <h1 id="portfolio-name" className="hero-name">
              <span className="hero-name-first">Tom</span> <span className="hero-name-last serif">Hiestand</span>
            </h1>
          </div>
        </section>

        <section className="work" id="work" aria-labelledby="work-heading">
          <div className="section-bar">
            <h2 id="work-heading">Selected work</h2>
            <span className="mono">({String(projects.length).padStart(2, '0')})</span>
          </div>
          <div className="work-list">
            {projects.map((project, index) => <ProjectCard key={project.title} project={project} index={index} />)}
          </div>
        </section>

        <section className="about" id="about" aria-labelledby="about-heading">
          <div className="section-bar">
            <h2 id="about-heading">About</h2>
            <span className="mono">Zurich, CH</span>
          </div>
          <Statement />
          <div className="about-grid">
            <dl className="facts reveal">
              <div><dt className="mono">Now</dt><dd>Apprentice software developer, Powerbuilders team at Swisscom</dd></div>
              <div><dt className="mono">Training</dt><dd>Informatiker EFZ, application development, since 2024</dd></div>
              <div><dt className="mono">Off screen</dt><dd>Football, games, and usually music on</dd></div>
            </dl>
            <div className="tools reveal" aria-labelledby="tools-heading">
              <h3 id="tools-heading" className="mono">Tools I use</h3>
              <ul>{tools.map((tool) => <li key={tool}>{tool}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="experience" id="experience" aria-labelledby="experience-heading">
          <div className="section-bar">
            <h2 id="experience-heading">Experience</h2>
            <span className="mono">2024 — now</span>
          </div>
          <ol className="roles">
            {experience.timeline.map((item) => (
              <li key={item.title} className="role reveal">
                <p className="mono role-date">{item.date}</p>
                <div className="role-main">
                  <h3>{item.title}</h3>
                  <p className="role-org">{item.org}</p>
                </div>
                <ul className="role-points">{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
                {item.current && <span className="role-current mono">Current</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="contact" id="contact" aria-labelledby="contact-heading">
          <div className="contact-grid">
            <div className="contact-intro">
              <p className="mono"><span className="dot" aria-hidden="true" />Replies by email</p>
              <h2 id="contact-heading">Contact</h2>
              <p>Questions about a project, an apprenticeship, or something you'd like built: send a message and I'll write back.</p>
              <a className="pill-link" href="https://github.com/tomxg2" target="_blank" rel="noreferrer">github.com/tomxg2 <ArrowUpRight size={15} /></a>
            </div>
            <div className="contact-form"><ContactCard content={contact} color="#ddf866" showHeading={false} showLinks={false} /></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p className="footer-name">Tom Hiestand</p>
        <ul className="footer-links">
          <li><a href="/lab">3D version <ArrowUpRight size={13} /></a></li>
          <li><a href="/instrument">Airform <ArrowUpRight size={13} /></a></li>
          <li><a href="https://github.com/tomxg2" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a></li>
        </ul>
        <p className="mono footer-meta"><Clock /> · © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
