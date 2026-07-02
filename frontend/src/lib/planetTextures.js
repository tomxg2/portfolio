import * as THREE from 'three';

// ── Real planet textures (Solar System Scope, CC-BY 4.0) ─────────────────────
// Shared by Scene3D (planet surfaces) and Cockpit (destination holograms).
// 2K JPEGs live in /public/textures/planets/. Loaded once via a module-level
// cache, so every consumer after the first is a free GPU cache hit.
export const REAL_PLANET_TEXTURES = {
  mercury: '/textures/planets/2k_mercury.jpg',
  venus:   '/textures/planets/2k_venus_atmosphere.jpg',
  earth:   '/textures/planets/2k_earth_daymap.jpg',
  mars:    '/textures/planets/2k_mars.jpg',
  saturn:  '/textures/planets/2k_saturn.jpg',
  neptune: '/textures/planets/2k_neptune.jpg',
};
export const EARTH_CLOUDS_URL = '/textures/planets/2k_earth_clouds.jpg';
export const SATURN_RING_URL  = '/textures/planets/2k_saturn_ring_alpha.png';
export const SUN_URL          = '/textures/planets/2k_sun.jpg';

const _textureCache = new Map();
const _textureLoader = new THREE.TextureLoader();

export function loadCachedTexture(url, { srgb = true } = {}) {
  const key = url + (srgb ? '#srgb' : '#linear');
  if (_textureCache.has(key)) return _textureCache.get(key);
  const tex = _textureLoader.load(url);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  _textureCache.set(key, tex);
  return tex;
}
