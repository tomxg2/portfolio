// ─── Node categories → colors (used by NodeCard) ──────────────────────────────
export const CATEGORY_COLORS = {
  work: '#60a5fa',
  creative: '#a78bfa',
  about: '#00ffcc',
};

// ─── Projects drill-down data (2D overlay, not 3D planets) ────────────────────
export const PROJECTS_DATA = {
  personal: {
    id: 'projects_personal',
    label: 'Personal',
    category: 'creative',
    content: {
      type: 'projects_list',
      title: 'Personal Projects',
      subtitle: 'Side projects I build for fun and learning',
      projects: [
        {
          title: 'This Portfolio',
          subtitle: 'The site you\'re looking at right now',
          description:
            'An interactive 3D solar-system portfolio built with React Three Fiber. Each planet is a section of the portfolio. Navigate with mouse, touch, or hand gestures via MediaPipe.',
          tech: ['React', 'Three.js', 'MediaPipe', 'Tailwind CSS', 'Framer Motion', 'Express', 'Supabase'],
          status: 'Live',
          live: null, // it's the site you're on — add a GitHub repo link here instead if public
        },
        {
          title: 'Airform',
          subtitle: 'A gesture-controlled instrument',
          description:
            'A browser instrument you play with hand gestures, mouse, touch, or keyboard. It has three FM synth voices and selectable keys and scales, and it records takes you can download. The 3D field reacts to the audio.',
          tech: ['React', 'Three.js', 'Tone.js', 'MediaPipe', 'Web Audio'],
          status: 'Playable',
          live: '/instrument',
        },
      ],
    },
  },
  work: {
    id: 'projects_work',
    label: 'Work',
    category: 'work',
    content: {
      type: 'projects_list',
      title: 'Work Projects',
      subtitle: 'Apps & automations built during my apprenticeship at Swisscom',
      note: 'Internal tools — details are kept general for confidentiality.',
      projects: [
        {
          title: 'Process Automation App',
          subtitle: 'Power Apps + Power Automate',
          description:
            'Internal apps that automate repetitive workflows for Swisscom teams.',
          tech: ['Power Apps', 'Power Automate', 'SharePoint'],
          status: 'Production',
          private: true,
        },
        {
          title: 'Analytics Dashboard',
          subtitle: 'Power BI reporting',
          description:
            'Power BI dashboard team leads use to track project metrics.',
          tech: ['Power BI', 'SharePoint', 'Azure DevOps'],
          status: 'Production',
          private: true,
        },
      ],
    },
  },
};

// ─── Solar system nodes ────────────────────────────────────────────────────────
// isSun: true  → rendered as the central star (About)
// orbitRadius  → distance from sun in scene units
// orbitSpeed   → radians per second (inner = faster, outer = slower)
// orbitOffset  → starting angle in radians (spreads planets around the system)
// size         → sphere radius
// color        → planet's unique color (distinct within category families)
export const NODES = [
  // ── Sun — About ────────────────────────────────────────────────────────────
  {
    id: 'about',
    label: 'About',
    category: 'about',
    isSun: true,
    size: 1.7,
    color: '#fff8e8',
    content: {
      type: 'about',
      title: "Hey, I'm Tom 👋",
      subtitle: 'Software Developer Apprentice @ Swisscom Zurich',
      bio: [
        "I'm a 17-year-old developer apprentice at Swisscom Powerbuilders in Zurich, Switzerland. I build internal tools, Power Platform solutions, and full-stack web applications.",
        "Outside work I do creative coding: 3D graphics and interactive experiments in the browser.",
        "This portfolio is one of those experiments: a solar system you can navigate with your mouse, touch, or even hand gestures via your webcam.",
      ],
      location: 'Zurich, Switzerland',
      company: 'Swisscom Powerbuilders',
      role: 'Software Developer Apprentice',
    },
  },

  // ── Planet 1 — Contact (closest, fastest) ──────────────────────────────────
  {
    id: 'contact',
    label: 'Contact',
    category: 'about',
    orbitRadius: 4.0,
    orbitSpeed: 0.52,
    orbitOffset: 0.0,
    size: 0.65,
    color: '#00ffcc',
    textureStyle: 'icy',
    realPlanet: 'mercury',
    content: {
      type: 'contact',
      title: 'Get in touch',
      subtitle: "Send a message and I'll reply by email.",
      location: 'Zurich, Switzerland',
      // shown under the form; type picks the icon (github | email | anything
      // else gets an arrow), e.g.
      //   { type: 'email', label: 'Email', handle: 'you@example.com', href: 'mailto:you@example.com' }
      //   { type: 'linkedin', label: 'LinkedIn', handle: 'in/you', href: 'https://www.linkedin.com/in/you' }
      links: [
        { type: 'github', label: 'GitHub', handle: 'github.com/tomxg2', href: 'https://github.com/tomxg2' },
      ],
    },
  },

  // ── Planet 2 — Skills ──────────────────────────────────────────────────────
  {
    id: 'skills',
    label: 'Skills',
    category: 'work',
    orbitRadius: 7.5,
    orbitSpeed: 0.33,
    orbitOffset: 1.1,
    size: 1.4,
    color: '#60a5fa',
    textureStyle: 'gas',
    realPlanet: 'neptune',
    content: {
      type: 'skills',
      title: 'Skills & Tools',
      subtitle: 'What I work with daily and what I explore in my own time',
      groups: [
        {
          label: 'Microsoft Power Platform',
          color: '#60a5fa',
          items: ['Power Apps', 'Power Automate', 'Power BI', 'SharePoint'],
        },
        {
          label: 'Cloud & DevOps',
          color: '#60a5fa',
          items: ['Azure DevOps', 'Docker', 'CI/CD Pipelines', 'GitHub Actions', 'GitLab', 'Linux / Bash'],
        },
        {
          label: 'Frontend',
          color: '#a78bfa',
          items: ['React', 'JavaScript (ES2024)', 'TypeScript', 'HTML & CSS', 'Tailwind CSS', 'Framer Motion'],
        },
        {
          label: 'Backend & Data',
          color: '#a78bfa',
          items: ['Node.js', 'Express', 'Python', 'Supabase', 'PostgreSQL', 'MySQL', 'MongoDB', 'SQL'],
        },
        {
          label: 'AI & Tools',
          color: '#00ffcc',
          items: ['GitHub Copilot', 'Generative AI', 'Prompt Engineering'],
        },
        {
          label: '3D & Creative',
          color: '#00ffcc',
          items: ['Three.js', 'React Three Fiber', 'WebGL', 'MediaPipe'],
        },
      ],
    },
  },

  // ── Planet 3 — Experience ──────────────────────────────────────────────────
  {
    id: 'experience',
    label: 'Experience',
    category: 'work',
    orbitRadius: 11.0,
    orbitSpeed: 0.21,
    orbitOffset: 2.3,
    size: 0.95,
    color: '#f97316',
    textureStyle: 'gas',
    realPlanet: 'mars',
    content: {
      type: 'experience',
      title: 'Experience',
      subtitle: 'Apprenticeship and school',
      timeline: [
        {
          date: 'Aug 2025 – Present',
          title: 'Powerbuilders',
          org: 'Swisscom · Zurich, CH',
          color: '#f97316',
          current: true,
          bullets: [
            'Canvas Apps, Power Automate flows & SharePoint solutions for internal clients',
            'Shipped EVA/LB (apprentice management app) and CPP Buddy Notifications to production',
            'Scrum sprints tracked in Azure DevOps',
          ],
        },
        {
          date: 'Feb 2025 – Aug 2025',
          title: 'Apps Team',
          org: 'Swisscom · Bern, CH',
          color: '#60a5fa',
          bullets: [
            'Built a Memory app in TypeScript and React',
          ],
        },
        {
          date: 'Aug 2024 – Feb 2025',
          title: 'CodemIX',
          org: 'Swisscom · Zurich, CH',
          color: '#a78bfa',
          bullets: [
            'Programming foundations course across multiple languages',
            'Small independent projects',
          ],
        },
        {
          date: 'Aug 2024 – Present',
          title: 'Informatiker EFZ — App Development',
          org: 'Berufsfachschule · Zurich, CH',
          color: '#4ade80',
          current: true,
          bullets: [
            'Vocational school alongside the apprenticeship',
            'Application development track',
          ],
        },
      ],
    },
  },

  // ── Planet 4 — Projects (hub, largest planet, shows floating signs when zoomed) ─
  {
    id: 'projects',
    label: 'Projects',
    category: 'creative',
    orbitRadius: 15.5,
    orbitSpeed: 0.14,
    orbitOffset: 3.5,
    size: 1.15,
    color: '#a78bfa',
    textureStyle: 'gas',
    hasRing: true,
    realPlanet: 'saturn',
    content: { type: 'projects_hub' },
  },

  // ── Planet 5 — Learning ────────────────────────────────────────────────────
  {
    id: 'learning',
    label: 'Learning',
    category: 'creative',
    orbitRadius: 19.5,
    orbitSpeed: 0.09,
    orbitOffset: 4.7,
    size: 0.6,
    color: '#4ade80',
    textureStyle: 'cloud',
    realPlanet: 'earth',
    content: {
      type: 'learning',
      title: 'Currently Learning',
      subtitle: "Things I'm exploring on the side",
      items: [
        {
          name: 'GLSL / WebGL Shaders',
          level: 'Exploring',
          color: '#00ffcc',
          description: 'Custom shader programs, post-processing effects for 3D scenes.',
          progress: 35,
        },
        {
          name: 'TypeScript (Advanced)',
          level: 'Intermediate',
          color: '#60a5fa',
          description: 'Deep type system — generics, conditional types, mapped types.',
          progress: 55,
        },
        {
          name: 'Rust',
          level: 'Beginner',
          color: '#f97316',
          description: 'Systems programming, memory safety without a garbage collector.',
          progress: 20,
        },
        {
          name: 'Machine Learning Basics',
          level: 'Beginner',
          color: '#f472b6',
          description: 'Neural nets, gradient descent — curious how it all really works.',
          progress: 15,
        },
        {
          name: 'Power Platform — Advanced ALM',
          level: 'Intermediate',
          color: '#4ade80',
          description: 'Environment strategies, automated solution deployments and full CI/CD pipelines for enterprise Power Platform via Azure DevOps.',
          progress: 60,
        },
      ],
    },
  },

  // ── Planet 6 — Interests (outermost, slowest) ──────────────────────────────
  {
    id: 'interests',
    label: 'Interests',
    category: 'creative',
    orbitRadius: 23.5,
    orbitSpeed: 0.06,
    orbitOffset: 5.9,
    size: 0.75,
    color: '#f472b6',
    textureStyle: 'gas',
    realPlanet: 'venus',
    content: {
      type: 'interests',
      title: 'Outside the Code',
      subtitle: "What keeps me busy when I'm not staring at a screen",
      interests: [
        { name: 'Football',        icon: 'football', desc: 'Playing and watching' },
        { name: 'Gaming',          icon: 'gaming',   desc: 'Competitive FPS & strategy games' },
        { name: 'Creative Coding', icon: 'coding',   desc: 'Experiments & interactive demos' },
        { name: 'Music',           icon: 'music',    desc: 'Always something in the headphones' },
      ],
    },
  },
];
