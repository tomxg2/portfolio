import { createXRStore } from '@react-three/xr';

// Single shared XR store — Scene3D wraps its R3F children with <XR store={xrStore}>,
// and the VRButton calls xrStore.enterVR() to start the session.
//
// emulate: the library defaults to a Meta Quest 3 emulator that auto-injects on
// localhost AND registers an Alt+Cmd+E hotkey even in production, which would
// lazily download ~5MB of emulator chunks (iwer + synthetic environments) on
// the live site. Restrict it to dev builds; the chunks still sit in dist/ but
// are never fetched by visitors.
export const xrStore = createXRStore({
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
});
