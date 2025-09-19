// Centralized configuration for API & WebSocket endpoints
// Uses environment variables (NEXT_PUBLIC_*) so it works on client side.
// Fallbacks keep development simple.

const API_HOST = process.env.NEXT_PUBLIC_API_HOST || '127.0.0.1';
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || '8000';
const API_PROTO = process.env.NEXT_PUBLIC_API_PROTO || 'http';
const WS_PROTO = process.env.NEXT_PUBLIC_WS_PROTO || (API_PROTO === 'https' ? 'wss' : 'ws');

export const API_BASE = `${API_PROTO}://${API_HOST}:${API_PORT}`.replace(/:\d+$/,(m)=> m===':80'? '' : m); // naive normalization
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
