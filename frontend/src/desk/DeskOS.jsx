import { useEffect, useRef } from 'react';
import { ContactCard } from '../components/NodeCard.jsx';
import { NODES } from '../data/nodes.js';
import './desk.css';

// Desk OS: the portfolio as a small desktop. Windows are plain DOM; the
// wallpaper, project previews and the Airform mini synth are 2D canvases.

const contact = NODES.find((node) => node.id === 'contact').content;

const PROJECTS = [
  { title: 'Solar system portfolio', desc: 'My first portfolio, built as a solar system you fly through. Steer it with mouse, touch, webcam hand gestures or your eyes, and step into a cockpit with its own flight audio.', tags: ['Three.js', 'R3F', 'MediaPipe', 'WebXR', '2025–26'], href: '/lab', cta: 'Open', viz: 'orbit' },
  { title: 'Airform', desc: 'A browser instrument you play by pinching the air in front of your webcam, or with mouse, touch and keyboard. Three FM voices, keys and scales, and a recorder for takes.', tags: ['Tone.js', 'Web Audio', 'MediaPipe Hands', '2026'], href: '/instrument', cta: 'Play', viz: 'waves' },
  { title: 'Powerbuilders apps', desc: 'Internal Power Platform apps for Swisscom teams. I shipped EVA/LB, which manages apprentices, and CPP Buddy Notifications. Internal, so there is no public demo.', tags: ['Power Apps', 'Power Automate', 'SharePoint', '2025–'], viz: 'flow' },
];

const NOTES = ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4', 'G4', 'A4', 'C5', 'D5'];
const FREQ = [146.83, 174.61, 196, 220, 261.63, 293.66, 349.23, 392, 440, 523.25, 587.33];
const APPS = [
  { id: 'about', label: 'About.txt', glyph: 'Hi', color: 'var(--yellow)' },
  { id: 'projects', label: 'Projects', glyph: '◧', color: 'var(--pink)' },
  { id: 'airform', label: 'Airform.app', glyph: '∿', color: 'var(--mint)' },
  { id: 'exp', label: 'Experience.pdf', glyph: 'CV', color: 'var(--lilac)' },
  { id: 'term', label: 'Terminal', glyph: '>_', color: 'var(--ink)', fg: 'var(--win)' },
  { id: 'mail', label: 'Contact', glyph: '@', color: 'var(--orange)' },
];

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function DeskOS() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const q = (selector) => root.querySelector(selector);
    const qa = (selector) => Array.from(root.querySelectorAll(selector));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = () => window.matchMedia('(max-width: 760px)').matches;
    const cleanups = [];
    const on = (target, type, handler, options) => { target.addEventListener(type, handler, options); cleanups.push(() => target.removeEventListener(type, handler, options)); };

    document.documentElement.classList.add('desk-root');
    const previousTitle = document.title;
    document.title = 'Desk OS — Tom Hiestand';

    // Clock
    const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
    const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'short' });
    const tick = () => { const now = new Date(); q('[data-clock]').textContent = timeFormat.format(now); q('[data-date]').textContent = dateFormat.format(now); };
    tick();
    const clockId = setInterval(tick, 5000);

    // Wallpaper
    const wall = q('.desk-wall');
    const wg = wall.getContext('2d');
    let wd = 1;
    const mouse = { x: -999, y: -999 };
    const sizeWall = () => { wd = Math.min(window.devicePixelRatio || 1, 2); wall.width = window.innerWidth * wd; wall.height = window.innerHeight * wd; };
    sizeWall();
    on(window, 'pointermove', (event) => { mouse.x = event.clientX; mouse.y = event.clientY; }, { passive: true });
    const drawWall = (t) => {
      const w = window.innerWidth; const h = window.innerHeight;
      wg.setTransform(wd, 0, 0, wd, 0, 0);
      wg.fillStyle = '#9fb0b6'; wg.fillRect(0, 0, w, h);
      wg.fillStyle = '#23343b';
      const step = 18; const cx = w * 0.72; const cy = h * 0.5;
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          const ring = Math.sin(Math.hypot(x - cx, y - cy) / 70 - t * 0.6) * 0.5 + 0.5;
          const near = Math.max(0, 1 - Math.hypot(x - mouse.x, y - mouse.y) / 160);
          wg.globalAlpha = 0.18 + ring * 0.22 + near * 0.5;
          wg.beginPath(); wg.arc(x, y, 0.6 + ring * 1.6 + near * 4.5, 0, Math.PI * 2); wg.fill();
        }
      }
      wg.globalAlpha = 1;
    };

    // Windows
    const wins = qa('.window');
    const byName = (name) => wins.find((win) => win.dataset.win === name);
    let zTop = 20;
    const focusWin = (win) => { wins.forEach((other) => other.classList.remove('focused')); win.classList.add('focused'); win.style.zIndex = ++zTop; };
    const placeWindows = () => {
      if (mobile()) return;
      const W = window.innerWidth; const H = window.innerHeight;
      wins.forEach((win) => {
        if (win.dataset.placed) return;
        const width = Math.min(+win.dataset.w, W - 40);
        win.style.width = `${width}px`;
        if (win.dataset.h) win.style.height = `${Math.min(+win.dataset.h, H - 140)}px`;
        win.style.left = `${Math.min(Math.max(130, W * +win.dataset.x), W - width - 20)}px`;
        win.style.top = `${Math.min(+win.dataset.y, H - 200)}px`;
        win.dataset.placed = '1';
      });
    };
    const updateDock = () => qa('.dock button').forEach((button) => { const win = byName(button.dataset.open); button.classList.toggle('open', !!win && !win.hidden); });
    const openWin = (name) => {
      const win = byName(name);
      if (!win) return;
      const wasHidden = win.hidden;
      win.hidden = false;
      placeWindows();
      if (wasHidden && !reduce) { win.classList.add('opening'); requestAnimationFrame(() => requestAnimationFrame(() => win.classList.remove('opening'))); }
      focusWin(win);
      updateDock();
      if (mobile()) win.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      if (name === 'term') setTimeout(() => q('#desk-term-in').focus(), 50);
      if (name === 'airform' || name === 'projects') sizeCanvases();
    };
    placeWindows();
    qa('[data-open]').forEach((button) => on(button, 'click', () => openWin(button.dataset.open)));
    wins.forEach((win) => {
      on(win, 'pointerdown', () => focusWin(win));
      on(win.querySelector('.close'), 'click', (event) => { event.stopPropagation(); win.hidden = true; updateDock(); });
      const bar = win.querySelector('.titlebar');
      let sx = 0; let sy = 0; let ox = 0; let oy = 0;
      on(bar, 'pointerdown', (event) => {
        if (mobile() || event.target.closest('.close')) return;
        bar.setPointerCapture(event.pointerId);
        sx = event.clientX; sy = event.clientY; ox = win.offsetLeft; oy = win.offsetTop;
      });
      on(bar, 'pointermove', (event) => {
        if (!bar.hasPointerCapture(event.pointerId)) return;
        win.style.left = `${Math.min(Math.max(ox + event.clientX - sx, -win.offsetWidth + 80), window.innerWidth - 80)}px`;
        win.style.top = `${Math.min(Math.max(oy + event.clientY - sy, 34), window.innerHeight - 60)}px`;
      });
    });
    focusWin(byName('projects'));
    updateDock();

    // Projects
    let current = 0;
    const showProject = (index) => {
      current = index;
      const project = PROJECTS[index];
      qa('.finder .list button').forEach((button) => button.setAttribute('aria-selected', String(+button.dataset.p === index)));
      q('[data-p-title]').textContent = project.title;
      q('[data-p-desc]').textContent = project.desc;
      q('[data-p-tags]').innerHTML = project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
      q('[data-p-action]').innerHTML = project.href ? `<a class="btn" href="${project.href}">${project.cta} ↗</a>` : '<span class="status">Internal to Swisscom</span>';
    };
    qa('.finder .list button').forEach((button) => on(button, 'click', () => showProject(+button.dataset.p)));
    showProject(0);

    const pc = q('[data-p-canvas]'); const px = pc.getContext('2d');
    const air = q('[data-air]'); const ax = air.getContext('2d');
    let cd = 1;
    function sizeCanvases() {
      cd = Math.min(window.devicePixelRatio || 1, 2);
      [pc, air].forEach((canvas) => { const rect = canvas.getBoundingClientRect(); if (rect.width) { canvas.width = rect.width * cd; canvas.height = rect.height * cd; } });
    }
    sizeCanvases();
    on(window, 'resize', () => { sizeWall(); placeWindows(); sizeCanvases(); });

    const drawProject = (t) => {
      const w = pc.width; const h = pc.height; const d = cd;
      if (!w) return;
      const kind = PROJECTS[current].viz;
      px.fillStyle = kind === 'flow' ? '#ffe15c' : kind === 'waves' ? '#87ecc4' : '#121416';
      px.fillRect(0, 0, w, h);
      if (kind === 'orbit') {
        for (let r = 1; r <= 4; r++) {
          const rx = r * w * 0.1; const ry = rx * 0.36;
          px.strokeStyle = 'rgba(251,251,249,.3)'; px.lineWidth = d;
          px.beginPath(); px.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2); px.stroke();
          const a = t * (1.2 / r) + r * 1.7;
          px.fillStyle = ['#ff9cc4', '#87ecc4', '#c4b5ff', '#ffe15c'][r - 1];
          px.beginPath(); px.arc(w / 2 + Math.cos(a) * rx, h / 2 + Math.sin(a) * ry, (3 + r) * d, 0, Math.PI * 2); px.fill();
        }
        px.fillStyle = '#ff8a3d'; px.beginPath(); px.arc(w / 2, h / 2, 12 * d, 0, Math.PI * 2); px.fill();
      } else if (kind === 'waves') {
        px.strokeStyle = '#121416'; px.lineWidth = 1.5 * d;
        for (let k = 0; k < 9; k++) {
          px.beginPath();
          for (let i = 0; i <= 60; i++) { const u = i / 60; const y = h * (0.18 + k * 0.08) + Math.sin(u * 8 + t * 1.6 + k * 0.4) * h * 0.07 * Math.sin(Math.PI * u); if (i) px.lineTo(u * w, y); else px.moveTo(u * w, y); }
          px.stroke();
        }
      } else {
        const nodes = [[0.18, 0.32, 'Form'], [0.5, 0.32, 'Flow'], [0.82, 0.32, 'List'], [0.34, 0.72, 'Mail'], [0.66, 0.72, 'Teams']];
        const edges = [[0, 1], [1, 2], [1, 3], [1, 4]];
        px.strokeStyle = '#121416'; px.lineWidth = 1.5 * d;
        edges.forEach(([a, b]) => { px.beginPath(); px.moveTo(nodes[a][0] * w, nodes[a][1] * h); px.lineTo(nodes[b][0] * w, nodes[b][1] * h); px.stroke(); });
        edges.forEach(([a, b], i) => { const p = (t * 0.5 + i * 0.3) % 1; px.fillStyle = '#ff8a3d'; px.beginPath(); px.arc((nodes[a][0] + (nodes[b][0] - nodes[a][0]) * p) * w, (nodes[a][1] + (nodes[b][1] - nodes[a][1]) * p) * h, 4 * d, 0, Math.PI * 2); px.fill(); });
        px.font = `600 ${12 * d}px Geist, sans-serif`; px.textAlign = 'center'; px.textBaseline = 'middle';
        nodes.forEach(([a, b, label]) => { px.fillStyle = '#fbfbf9'; px.fillRect(a * w - 30 * d, b * h - 13 * d, 60 * d, 26 * d); px.strokeRect(a * w - 30 * d, b * h - 13 * d, 60 * d, 26 * d); px.fillStyle = '#121416'; px.fillText(label, a * w, b * h); });
      }
    };

    // Airform mini synth
    let audio = null; let osc = null; let mod = null; let gain = null; let held = null; let hover = null;
    const noteAt = (u) => Math.min(NOTES.length - 1, Math.max(0, Math.floor(u * NOTES.length)));
    const airPos = (event) => { const rect = air.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
    const noteRead = q('[data-note]');
    on(air, 'pointermove', (event) => {
      hover = airPos(event);
      if (!held) return;
      held = hover;
      const n = noteAt(held.x);
      noteRead.textContent = NOTES[n];
      if (osc) { osc.frequency.setTargetAtTime(FREQ[n], audio.currentTime, 0.02); mod.frequency.setTargetAtTime(FREQ[n] * 2, audio.currentTime, 0.02); }
    });
    on(air, 'pointerleave', () => { hover = null; });
    on(air, 'pointerdown', (event) => {
      air.setPointerCapture(event.pointerId);
      held = airPos(event);
      const n = noteAt(held.x);
      noteRead.textContent = NOTES[n];
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        osc = audio.createOscillator(); mod = audio.createOscillator(); gain = audio.createGain();
        const depth = audio.createGain();
        osc.frequency.value = FREQ[n]; mod.frequency.value = FREQ[n] * 2; depth.gain.value = 90;
        mod.connect(depth).connect(osc.frequency); osc.connect(gain).connect(audio.destination);
        gain.gain.value = 0; gain.gain.setTargetAtTime(0.14, audio.currentTime, 0.02);
        osc.start(); mod.start();
      } catch { noteRead.textContent = 'no audio'; }
    });
    const release = () => {
      held = null;
      noteRead.textContent = '--';
      if (!osc) return;
      gain.gain.setTargetAtTime(0, audio.currentTime, 0.08);
      const [o, m] = [osc, mod];
      setTimeout(() => { o.stop(); m.stop(); }, 300);
      osc = null; mod = null;
    };
    on(air, 'pointerup', release);
    on(air, 'pointercancel', release);
    const drawAir = (t) => {
      const w = air.width; const h = air.height; const d = cd;
      if (!w) return;
      ax.fillStyle = '#0f1513'; ax.fillRect(0, 0, w, h);
      const focus = held || hover;
      for (let k = 0; k < 16; k++) {
        const base = h * (0.16 + k * 0.045);
        ax.strokeStyle = held ? 'rgba(135,236,196,.9)' : 'rgba(220,255,240,.55)';
        ax.globalAlpha = k % 5 === 2 ? 1 : 0.45;
        ax.lineWidth = (k % 5 === 2 ? 1.6 : 1) * d;
        ax.beginPath();
        for (let i = 0; i <= 70; i++) {
          const u = i / 70; const env = Math.sin(Math.PI * u);
          let y = base + Math.sin(u * 7 + t * 1.4 + k * 0.2) * h * 0.03 * env;
          if (focus) { const dx = (u - focus.x) / 0.14; y += Math.exp(-dx * dx) * (focus.y * h - base) * (held ? 0.8 : 0.45) * env; }
          if (i) ax.lineTo(u * w, y); else ax.moveTo(u * w, y);
        }
        ax.stroke();
      }
      ax.globalAlpha = 1;
    };

    // Terminal
    const out = q('[data-term-out]');
    const termBody = q('[data-term-body]');
    const print = (html) => { out.insertAdjacentHTML('beforeend', `${html}\n`); termBody.scrollTop = termBody.scrollHeight; };
    const commands = {
      help: () => '<span class="y">commands</span>  about · projects · open &lt;about|projects|airform|exp|mail&gt; · fetch · date · home · clear',
      about: () => 'Tom Hiestand. Apprentice software developer, Powerbuilders team at Swisscom, Zurich.\nAfter hours: Three.js, Web Audio, hand tracking.',
      projects: () => '<span class="p">solar-system/</span>  interactive 3D portfolio   → /lab\n<span class="p">airform/</span>       gesture instrument         → /instrument\n<span class="p">powerbuilders/</span> EVA/LB, CPP Buddy Notifications (internal)',
      fetch: () => '<span class="c">tom</span>@<span class="c">zurich</span>\n----------\nrole     apprentice developer\nemployer Swisscom (Powerbuilders)\nschool   Informatiker EFZ, app development\nstack    React · TypeScript · Three.js · Power Platform\nuptime   since Aug 2024',
      date: () => `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'full', timeStyle: 'short' }).format(new Date())} (Zurich)`,
      home: () => { window.location.href = '/'; return 'leaving desk…'; },
      clear: () => { out.innerHTML = ''; return null; },
    };
    print('<span class="c">th.os</span> 1.0 · type <span class="y">help</span> to list commands');
    print('<span class="c">tom@zurich ~ %</span> fetch');
    print(commands.fetch());
    on(q('[data-term-form]'), 'submit', (event) => {
      event.preventDefault();
      const input = q('#desk-term-in');
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;
      print(`<span class="c">tom@zurich ~ %</span> ${escapeHtml(raw)}`);
      const [cmd, arg] = raw.toLowerCase().split(/\s+/);
      if (cmd === 'open') {
        if (arg && byName(arg)) { openWin(arg); print(`opened ${escapeHtml(arg)}`); } else print('usage: open about|projects|airform|exp|mail');
        return;
      }
      if (commands[cmd]) { const result = commands[cmd](); if (result) print(result); } else print(`zsh: command not found: ${escapeHtml(cmd)}. Try help.`);
    });

    // Render loop
    let frame = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      drawWall(reduce ? 0 : t);
      if (!byName('projects').hidden) drawProject(reduce ? 1 : t);
      if (!byName('airform').hidden) drawAir(reduce ? 1 : t);
      frame = requestAnimationFrame(loop);
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { if (rootRef.current) { sizeCanvases(); loop(); } });

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(clockId);
      cleanups.forEach((fn) => fn());
      if (osc) { osc.stop(); mod.stop(); }
      audio?.close();
      document.documentElement.classList.remove('desk-root');
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="desk-os" ref={rootRef}>
      <canvas className="desk-wall" aria-hidden="true" />

      <div className="menubar" role="banner">
        <span className="logo">th<span>.</span>os</span>
        <nav className="app-menu" aria-label="Open windows">
          <button type="button" data-open="about">About</button>
          <button type="button" data-open="projects">Projects</button>
          <button type="button" data-open="exp">Experience</button>
          <button type="button" data-open="mail">Contact</button>
        </nav>
        <div className="right">
          <span className="date" data-date="" />
          <span>Zurich <b data-clock="">--:--</b></span>
          <a href="/">Back to portfolio</a>
        </div>
      </div>

      <div className="icons" role="list" aria-label="Desktop">
        {APPS.map((app) => (
          <button key={app.id} type="button" className="icon" role="listitem" data-open={app.id}>
            <span className="glyph" style={{ background: app.color, color: app.fg }}>{app.glyph}</span>
            <span>{app.label}</span>
          </button>
        ))}
      </div>

      <main className="desktop">
        <h1 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Desk OS, Tom Hiestand's portfolio as a desktop</h1>

        <section className="window w-about" data-win="about" data-x="0.1" data-y="56" data-w="430" aria-labelledby="t-about">
          <div className="titlebar"><h2 id="t-about">About.txt</h2><span className="meta">1 KB</span><button type="button" className="close" aria-label="Close About">×</button></div>
          <div className="body about">
            <p className="about-name">Tom <em>Hiestand</em></p>
            <p>Apprentice software developer at Swisscom in Zurich. At work I build Power Apps, flows and SharePoint tools for internal teams. In my own time I make browser things: 3D scenes, instruments, hand tracking.</p>
            <dl className="facts">
              <dt>Team</dt><dd>Powerbuilders, Swisscom</dd>
              <dt>Training</dt><dd>Informatiker EFZ, app development</dd>
              <dt>Stack</dt><dd>React, TypeScript, Three.js, Power Platform</dd>
              <dt>Off screen</dt><dd>Football, games, music</dd>
            </dl>
          </div>
        </section>

        <section className="window w-projects" data-win="projects" data-x="0.43" data-y="56" data-w="600" data-h="430" aria-labelledby="t-proj">
          <div className="titlebar"><h2 id="t-proj">Projects</h2><span className="meta">3 items</span><button type="button" className="close" aria-label="Close Projects">×</button></div>
          <div className="body" style={{ padding: 0 }}>
            <div className="finder">
              <div className="list" role="tablist" aria-label="Projects">
                {PROJECTS.map((project, index) => (
                  <button key={project.title} type="button" role="tab" aria-selected={index === 0} data-p={index}><i />{project.title.replace(' portfolio', '').replace(' apps', '')}</button>
                ))}
              </div>
              <div className="detail" role="tabpanel">
                <canvas data-p-canvas="" aria-hidden="true" />
                <h3 data-p-title="" />
                <p data-p-desc="" />
                <div className="tags" data-p-tags="" />
                <div data-p-action="" />
              </div>
            </div>
          </div>
        </section>

        <section className="window w-airform" data-win="airform" data-x="0.1" data-y="420" data-w="430" aria-labelledby="t-air">
          <div className="titlebar"><h2 id="t-air">Airform.app</h2><span className="meta">mini</span><button type="button" className="close" aria-label="Close Airform">×</button></div>
          <div className="body airform">
            <canvas data-air="" aria-label="Wave field. Press and drag to play a note; left to right changes pitch." />
            <div className="row"><span>Press and drag to play</span><span className="note-read" data-note="">--</span><a className="btn ghost" href="/instrument">Full version ↗</a></div>
          </div>
        </section>

        <section className="window w-term" data-win="term" data-x="0.56" data-y="510" data-w="470" data-h="240" aria-labelledby="t-term">
          <div className="titlebar"><h2 id="t-term">Terminal</h2><span className="meta">zsh</span><button type="button" className="close" aria-label="Close Terminal">×</button></div>
          <div className="body" data-term-body="">
            <div className="term-out" data-term-out="" aria-live="polite" />
            <form className="term-line" data-term-form=""><label htmlFor="desk-term-in">tom@zurich ~ %</label><input id="desk-term-in" autoComplete="off" spellCheck="false" aria-label="Terminal command" /></form>
          </div>
        </section>

        <section className="window w-exp" data-win="exp" data-x="0.35" data-y="140" data-w="460" hidden aria-labelledby="t-exp">
          <div className="titlebar"><h2 id="t-exp">Experience.pdf</h2><span className="meta">page 1 of 1</span><button type="button" className="close" aria-label="Close Experience">×</button></div>
          <div className="body cv">
            <article><span className="when">Aug 2025 – now</span><div><h3>Powerbuilders <span className="now">current</span></h3><p>Swisscom, Zurich. Canvas Apps, Power Automate flows and SharePoint for internal clients. Shipped EVA/LB and CPP Buddy Notifications.</p></div></article>
            <article><span className="when">Feb – Aug 2025</span><div><h3>Apps Team</h3><p>Swisscom, Bern. Built a Memory app in TypeScript and React.</p></div></article>
            <article><span className="when">Aug 2024 – Feb 2025</span><div><h3>CodemIX</h3><p>Swisscom, Zurich. Programming foundations and small independent projects.</p></div></article>
            <article><span className="when">Aug 2024 – now</span><div><h3>Informatiker EFZ <span className="now">current</span></h3><p>Vocational school alongside the apprenticeship, application development track.</p></div></article>
          </div>
        </section>

        <section className="window w-mail" data-win="mail" data-x="0.4" data-y="90" data-w="480" hidden aria-labelledby="t-mail">
          <div className="titlebar"><h2 id="t-mail">New message</h2><span className="meta">to Tom</span><button type="button" className="close" aria-label="Close message">×</button></div>
          <div className="body mail">
            <p className="mail-intro">Questions about a project, an apprenticeship, or something you'd like built. I reply by email.</p>
            <ContactCard content={contact} color="#ff8a3d" showHeading={false} showLinks={false} />
          </div>
        </section>
      </main>

      <nav className="dock" aria-label="Dock">
        {APPS.map((app) => (
          <button key={app.id} type="button" style={{ background: app.color, color: app.fg }} data-open={app.id} aria-label={app.label}>{app.glyph}</button>
        ))}
      </nav>
    </div>
  );
}
