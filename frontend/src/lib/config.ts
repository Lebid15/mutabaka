// Centralized configuration for API & WebSocket endpoints
// Uses environment variables (NEXT_PUBLIC_*) so it works on client side.
// In production, if envs are missing, infer from window.location so deploys behind proxies just work.

function inferFromWindow() {
  if (typeof window === 'undefined') return null;
  try {
    const proto = window.location.protocol.replace(':',''); // http or https
    const host = window.location.hostname; // domain or IP
    let port = window.location.port; // may be '' for default
    // Normalize default ports
    if (!port) port = proto === 'https' ? '443' : '80';
    const wsProto = proto === 'https' ? 'wss' : 'ws';
    return { proto, host, port, wsProto };
  } catch { return null; }
}

const inferred = inferFromWindow();
const isDev = process.env.NODE_ENV !== 'production';
const devFallback = isDev ? { proto: 'http', host: '127.0.0.1', port: '8000', wsProto: 'ws' } : null;

const API_PROTO = process.env.NEXT_PUBLIC_API_PROTO || devFallback?.proto || inferred?.proto || 'http';
const API_HOST = process.env.NEXT_PUBLIC_API_HOST || devFallback?.host || inferred?.host || '127.0.0.1';
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || devFallback?.port || inferred?.port || (API_PROTO === 'https' ? '443' : '80');
const WS_PROTO = process.env.NEXT_PUBLIC_WS_PROTO || devFallback?.wsProto || inferred?.wsProto || (API_PROTO === 'https' ? 'wss' : 'ws');

export const API_BASE = `${API_PROTO}://${API_HOST}:${API_PORT}`.replace(/:\d+$/,(m)=> (m===':80' && API_PROTO==='http') || (m===':443' && API_PROTO==='https') ? '' : m);
export const WS_BASE = `${WS_PROTO}://${API_HOST}:${API_PORT}`;

export const WS_PATH_CONVERSATION = (id:number) => `/ws/conversations/${id}/`;
export const WS_PATH_INBOX = `/ws/inbox/`;

// Feature flag: allow disabling WebSocket entirely (falls back to HTTP only)
export const ENABLE_WS = (process.env.NEXT_PUBLIC_ENABLE_WS || 'true').toLowerCase() !== 'false';

// Debug flag: when true, receiver will append chat.message directly without dedupe to verify UI update path
export const DEBUG_FORCE_APPEND = (process.env.NEXT_PUBLIC_DEBUG_FORCE_APPEND || 'false').toLowerCase() === 'true';

export interface ReconnectOptions {
  maxAttempts?: number;        // total attempts including first
  initialDelayMs?: number;     // starting backoff
  maxDelayMs?: number;         // cap
  factor?: number;             // exponential growth
}

export const defaultReconnect: Required<ReconnectOptions> = {
  maxAttempts: 6,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  factor: 1.8,
};

// Web Push public key (VAPID)
export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();

// Service worker version for cache-busting. Bump this to force clients to fetch a fresh sw.js
export const SW_VERSION = (process.env.NEXT_PUBLIC_SW_VERSION || '').trim();
