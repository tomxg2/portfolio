import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUpRight, Plus, MapPin } from 'lucide-react';
import { ContactCard } from './components/NodeCard.jsx';
import { NODES, PROJECTS_DATA } from './data/nodes.js';
import './portfolio.css';

const experience = NODES.find((node) => node.id === 'experience').content;
const contact = NODES.find((node) => node.id === 'contact').content;
const navigation = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'experience', label: 'Experience' },
  { id: 'contact', label: 'Contact' },
];
const projects = [
  ...PROJECTS_DATA.personal.content.projects.slice(1).map((project) => ({ ...project, category: 'Personal' })),
];

export default function Portfolio() {
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
    });
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) setActiveSection(visible[visible.length - 1].target.id);
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    navigation.forEach(({ id }) => observer.observe(document.getElementById(id)));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="portfolio">
      <a className="portfolio-skip" href="#main-content">Skip to content</a>
      <header className="portfolio-header">
        <a className="portfolio-wordmark" href="#top" aria-label="Tom Hiestand, home">th.</a>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label }) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined}>{label}</a>)}
        </nav>
        <a className="portfolio-github" href="https://github.com/tomxg2" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={16} /></a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="portfolio-intro portfolio-container" id="top" aria-labelledby="portfolio-name">
          <p className="portfolio-eyebrow"><span /> Software developer apprentice</p>
          <h1 id="portfolio-name">Tom Hiestand<span>.</span></h1>
          <div className="portfolio-intro-bottom">
            <p>I build useful tools at <strong>Swisscom</strong>.<br />And unusual things on the internet.</p>
            <p className="portfolio-location"><MapPin size={16} /> Zurich, Switzerland</p>
            <a className="portfolio-text-link" href="#work">Selected work <ArrowDown size={18} /></a>
          </div>
        </section>

        <section className="portfolio-work portfolio-container" id="work" aria-labelledby="work-heading">
          <div className="portfolio-section-heading">
            <h2 id="work-heading">Selected work</h2>
            <span className="portfolio-eyebrow">Interactive projects</span>
          </div>
          <article className="portfolio-feature">
            <div className="portfolio-feature-caption">
              <div><span className="portfolio-project-number">01</span><h3>Solar system portfolio</h3></div>
              <p>React / Three.js / MediaPipe</p>
              <a className="portfolio-text-link" href="/lab">Open experiment <ArrowUpRight size={17} /></a>
            </div>
            <a className="portfolio-feature-image" href="/lab" aria-label="Open the interactive solar-system portfolio">
              <img src="/solar-system.jpg" alt="The actual 3D portfolio: a glowing sun surrounded by textured planets and orbital paths" width="1920" height="720" fetchPriority="high" />
              <span className="portfolio-feature-label">Interactive experiment</span>
              <span className="portfolio-feature-open"><ArrowUpRight size={24} aria-hidden="true" /></span>
            </a>
          </article>
          <div className="portfolio-projects">
            {projects.map((project, index) => (
              <details className="portfolio-project" key={project.title}>
                <summary>
                  <span className="portfolio-project-number">{String(index + 2).padStart(2, '0')}</span>
                  <span className="portfolio-project-title"><h3>{project.title}</h3><span>{project.subtitle}</span></span>
                  <span className="portfolio-project-category">{project.category}</span>
                  <span className="portfolio-project-status">{project.status}</span>
                  <Plus size={20} className="portfolio-project-expand" aria-hidden="true" />
                </summary>
                <div className="portfolio-project-detail">
                  <p>{project.description}</p>
                  <ul aria-label="Technologies">{project.tech.map((technology) => <li key={technology}>{technology}</li>)}</ul>
                  {project.private && <p className="portfolio-project-note">Internal Swisscom project. Source code and client details are confidential.</p>}
                  {project.github && <a className="portfolio-text-link" href={project.github} target="_blank" rel="noreferrer">Source code <ArrowUpRight size={16} /></a>}
                  {project.live && <a className="portfolio-text-link" href={project.live} target="_blank" rel="noreferrer">Live project <ArrowUpRight size={16} /></a>}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="portfolio-about" id="about" aria-labelledby="about-heading">
          <div className="portfolio-container portfolio-about-grid">
            <div><p className="portfolio-eyebrow">A little context</p><h2 id="about-heading">Practical by day.<br />Curious by default.</h2></div>
            <div className="portfolio-about-copy">
              <p>I'm a software developer apprentice at Swisscom Powerbuilders in Zurich. My work spans internal applications, workflow automation, and full-stack web development.</p>
              <p>Outside of work, I explore 3D graphics, interactive experiences, and the small details that make software feel good to use.</p>
              <p>Also: football, games, and something playing in my headphones.</p>
              <div className="portfolio-skills"><h3>What I work with</h3><p>React, TypeScript, Node.js, Power Apps, Power Automate, SharePoint, Supabase, Three.js, and Azure DevOps.</p></div>
            </div>
          </div>
        </section>

        <section className="portfolio-experience portfolio-container" id="experience" aria-labelledby="experience-heading">
          <div className="portfolio-section-heading"><h2 id="experience-heading">Learning by building.</h2><span className="portfolio-eyebrow">The path so far</span></div>
          <div className="portfolio-timeline">
            {experience.timeline.map((item) => (
              <article key={item.title} className="portfolio-role">
                <p className="portfolio-role-date">{item.date}</p>
                <div><h3>{item.title}</h3><p className="portfolio-role-org">{item.org}</p><ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul></div>
                {item.current && <span className="portfolio-current">Current</span>}
              </article>
            ))}
          </div>
        </section>

        <section className="portfolio-contact" id="contact" aria-labelledby="contact-heading">
          <div className="portfolio-container portfolio-contact-grid">
            <div><p className="portfolio-eyebrow">Have something in mind?</p><h2 id="contact-heading">Let's make<br />something good.</h2><p>A project, a question, or a conversation.<br />I'd be glad to hear from you.</p><a className="portfolio-contact-direct" href="https://github.com/tomxg2" target="_blank" rel="noreferrer">Find me on GitHub <ArrowUpRight size={17} /></a></div>
            <div className="portfolio-contact-form"><ContactCard content={contact} color="#ddf866" showHeading={false} showLinks={false} /></div>
          </div>
        </section>
      </main>

      <footer className="portfolio-footer portfolio-container"><a href="#top">Tom Hiestand</a><span>Zurich, Switzerland</span><a href="/lab">The 3D experiment <ArrowUpRight size={15} /></a></footer>
    </div>
  );
}