import { create } from 'zustand';

// ── Ship / flight-deck mode ──────────────────────────────────────────────────
// solar    → DEFAULT. Your original galaxy overview: OrbitControls + CameraController
//            + hand-gesture / voice / VR all active. The cockpit is hidden.
// cockpit  → opt-in flight deck: first-person look (drag) + walk (WASD), pick a
//            destination on the dashboard screen.
// travel   → warping out to the selected planet (camera owned by the cockpit)
// section  → arrived; your NodeCard content is open
export const useShipStore = create((set) => ({
  mode: 'solar',
  setMode: (mode) => set({ mode }),
  enterCockpit: () => set({ mode: 'cockpit' }),
  exitCockpit: () => set({ mode: 'solar' }),
}));

// dev-only: lets scripts/snap.mjs drive mode changes from Playwright
if (import.meta.env.DEV) window.__ship = useShipStore;
