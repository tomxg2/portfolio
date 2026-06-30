import { createXRStore } from '@react-three/xr';

// Single shared XR store — Scene3D wraps its R3F children with <XR store={xrStore}>,
// and the VRButton calls xrStore.enterVR() to start the session.
export const xrStore = createXRStore();
