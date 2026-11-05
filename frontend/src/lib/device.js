// Phone / tablet detection, evaluated ONCE at startup and shared by every
// consumer. Separate checks could disagree: in dev the WebXR emulator swaps
// navigator.userAgent shortly after load, so the lazily-loaded scene (and any
// per-render check) saw a different device than App did.
export const IS_MOBILE = typeof window !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as "Macintosh" — detect via multi-touch
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));
