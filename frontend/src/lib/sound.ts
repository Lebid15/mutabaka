let audioEl: HTMLAudioElement | null = null;
let primed = false;
let lastPlayed = 0;
const MIN_INTERVAL_MS = 3000; // rate limit
const STORAGE_KEY = 'settings.soundEnabled';

// Allow overriding the sound file via env (set in Next.js build)
let SOUND_URL = (process.env.NEXT_PUBLIC_NOTIFICATION_SOUND_URL || '/sounds/notify.mp3').trim() || '/sounds/notify.mp3';

// Allow runtime override from backend admin via apiClient helper
export function setRuntimeSoundUrl(url: string | null | undefined) {
  if (typeof url === 'string' && url.trim()) {
    SOUND_URL = url.trim();
    // reset audio element so next play uses new source
    try { audioEl = null; } catch {}
  }
}

function getStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true; // default enabled
    return v === '1' || v === 'true';
  } catch { return true; }
}

let enabled = (typeof window !== 'undefined') ? getStoredEnabled() : true;

export function isSoundEnabled() { return enabled; }
export function setSoundEnabled(val: boolean) {
  enabled = !!val;
  try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch {}
}

export function initSoundOnUserGesture() {
  if (primed) return;
  try {
    if (!audioEl) audioEl = new Audio(SOUND_URL);
    // Attempt to play and immediately pause to unlock
    audioEl.volume = 1.0;
    const p = audioEl.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { try { audioEl?.pause(); } catch {} primed = true; }).catch(() => { /* ignored until user interacts again */ });
    } else {
      primed = true;
      try { audioEl?.pause(); } catch {}
    }
  } catch {}
}

export async function tryPlayMessageSound(): Promise<boolean> {
  if (!enabled) return false;
  if (!audioEl) audioEl = new Audio(SOUND_URL);
  const now = Date.now();
  if (now - lastPlayed < MIN_INTERVAL_MS) return true; // treat as success but rate-limited
  try {
    await audioEl.play();
    lastPlayed = now;
    return true;
  } catch {
    return false;
  }
}

// Helper to attach one-time gesture listeners from pages
let primingAttached = false;
export function attachPrimingListeners() {
  if (primingAttached) return;
  primingAttached = true;
  const once = () => { initSoundOnUserGesture(); cleanup(); };
  const cleanup = () => {
    try { window.removeEventListener('click', once, true); } catch {}
    try { window.removeEventListener('keydown', once, true); } catch {}
  };
  try {
    window.addEventListener('click', once, true);
    window.addEventListener('keydown', once, true);
  } catch {}
}
