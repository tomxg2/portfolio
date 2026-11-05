# Tom Hiestand — Portfolio

A work-first portfolio: selected projects, experience, background, and a
contact form are available on a normal, accessible scrolling page.

The original solar-system portfolio lives at `/lab`. It is an optional
interactive project, not a prerequisite for reading the portfolio. Three.js,
the cockpit, and tracking tools are loaded only when that route is opened.

The experiment retains hand gestures (MediaPipe Hands), webcam eye tracking,
voice commands, VR, ambient music, and live visitor cursors. Its navigation
and content remain usable when WebGL 2 is unavailable.

## Airform

`/instrument` opens Airform, a gesture-controlled musical instrument with an
audio-reactive 3D field. It is linked from the galaxy's Personal Projects and
the homepage. Audio and camera access are off by default.

- Select **Start playing**, then hold and drag on the field: horizontal position
  selects pitch; vertical position changes the tone's brightness.
- The on-screen keys work with mouse and touch. Keyboard notes use
  `A W S E D F T G Y H U J K O L`, in scale order. Focus a note key and use
  Space or Enter for accessible keyboard play.
- Select **Hands** to enable the camera. Pinch thumb and index finger to play;
  move the pinch to change pitch and tone. Releasing the pinch releases the note.
- Glass, Reed, and Current are distinct FM voices. Key and scale select the note
  range; Space controls reverb/delay and Volume controls output.
- Record captures only synthesized audio, never microphone or camera audio.
  Takes stop automatically after two minutes and can be played back or downloaded.
  Export uses a format the browser can record and play, usually WebM/Opus in Chrome.
- Hand tracking runs locally using the self-hosted MediaPipe model. Switching
  to Pointer, cancelling startup, or leaving the instrument stops camera tracks.

Camera processing has been tested with generated video and the real local model;
gesture mapping also has deterministic landmark tests. Real lighting, camera
placement, and individual hand-tracking accuracy still need a physical-device check.
Recording and playback are verified in standalone Chrome. VS Code's embedded
browser rejected its WebM recordings during testing, so use Chrome for that workflow.

Live: https://tomhiestand.dev

## Structure

```
frontend/   Vite + React 18 + React Three Fiber + Tailwind
  src/main.jsx              lazy entry selection: homepage or /lab
  src/Portfolio.jsx         homepage, project index, experience, contact
  src/portfolio.css         homepage visual system and responsive layout
  src/instrument/           Airform audio engine, visual field, controls, and unit tests
  src/data/nodes.js         project details and experience data
  src/App.jsx               optional 3D portfolio and input wiring
  src/components/Scene3D.jsx  the 3D scene: planets, camera, post-processing
  src/components/NodeCard.jsx content panels + contact form
  src/cockpit/              flight-deck mode (geometry, nav screen, audio)
  src/index.css             "liquid glass" UI system (.lg-*)
  scripts/snap.mjs          deterministic visual-regression screenshots
  scripts/verify-portfolio.mjs  browser regression checks and screenshots
backend/    Express API — POST /api/contact → Supabase + Resend email
  src/app.test.js           API validation and CORS regression checks
  supabase/schema.sql       table for contact submissions
```

## Development

```bash
cd frontend && npm install && npm run dev     # http://localhost:5173
cd backend  && npm install && npm run dev     # http://localhost:3001
```

Copy `.env.example` to `.env` in each folder. The frontend runs without any
env vars (multiplayer cursors just switch off); the contact form needs the
backend, which needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (email via
`RESEND_API_KEY` is optional). Create the table with `backend/supabase/schema.sql`.

Development defaults to the API at `http://localhost:3001`. For a separately
deployed backend, set `VITE_API_URL` to its origin before building the frontend,
and allow the frontend origin through the backend's `FRONTEND_URL` and optional
`FRONTEND_URL_WWW`. In production, omitting `VITE_API_URL` uses `/api/contact` on
the same origin; that deployment must route `/api` to the backend. A standalone
Vite preview does not provide the contact API.

`npm run lint` / `npm run build` in `frontend/`.

### Verification

From the repository root:

```bash
npm --prefix frontend run lint
npm --prefix frontend run test:portfolio
npm --prefix frontend run test:instrument
npm --prefix backend test
```

The browser checks build the app, start an isolated production preview on a
free port, use local Chrome, and clean up the server and browser. They cover
the homepage's JavaScript budget, keyboard project controls, section links,
contact validation and failures, six viewport sizes, the optional 3D route,
the WebGL fallback, and Airform. The instrument-only command also runs the scale
and pointer-mapping unit tests. Instrument checks decode recorded audio, verify
playback/download, exercise camera denial and cancellation, run the actual local
hand model against generated video, and check desktop/mobile controls.
Screenshots and test recordings go to `frontend/scripts/snapshots/portfolio/`.

Contact requests in browser tests are intercepted. Backend tests use dummy
service configuration and invalid submissions, so neither suite writes to
Supabase or sends email. Live delivery and real camera, microphone, and VR
hardware still require a separate check.

### Visual regression

```bash
cd frontend
npx vite --port 5199                    # dev build: exposes the window.__* hooks
node scripts/snap.mjs --baseline        # capture reference shots
node scripts/snap.mjs                   # diff against them → scripts/snapshots/diff/
```

The legacy scene snapshot command targets `/lab` by default. It needs local
Chrome. All generated test screenshots are gitignored.

Note: in dev the WebXR emulator (Meta Quest 3) is injected on localhost and
overrides `navigator.userAgent`, so mobile detection doesn't work there — test
mobile layouts against `npm run build && npx vite preview`.

## Deployment

Frontend and backend deploy to Vercel (`frontend/vercel.json` carries the CSP
and COOP/COEP headers MediaPipe needs). The backend also has a Railway config.

## Credits

Planet textures: Solar System Scope (CC BY 4.0). Player ship: Quaternius (CC0).
Cockpit seat model and panel textures: generated with Higgsfield. See
`frontend/public/**/CREDITS.txt`.
