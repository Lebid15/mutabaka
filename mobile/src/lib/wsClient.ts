import { Platform } from 'react-native';
import { environment } from '../config/environment';

type QueryValue = string | number | boolean | null | undefined;

export interface CreateWebSocketOptions {
  token?: string | null;
  query?: Record<string, QueryValue>;
  protocols?: string | string[];
}

function appendQueryParameters(url: string, params?: Record<string, QueryValue>): string {
  if (!params || !Object.keys(params).length) {
    return url;
  }
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) {
    return url;
  }

  let suffix = '';
  if (typeof URLSearchParams !== 'undefined') {
    const searchParams = new URLSearchParams();
    entries.forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    suffix = searchParams.toString();
  } else {
    suffix = entries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }
  if (!suffix) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${suffix}`;
}

export function createWebSocket(baseUrl: string, options?: CreateWebSocketOptions): WebSocket {
  const { token, query, protocols } = options || {};
  const finalUrl = appendQueryParameters(baseUrl, {
    ...query,
    token: token ?? undefined,
  });

  console.log('[WebSocket] 🔌 Creating WebSocket connection...', {
    baseUrl,
    finalUrl: finalUrl.substring(0, 100) + '...',
    platform: Platform.OS,
    hasToken: !!token,
  });

  if (Platform.OS === 'web') {
    return protocols ? new WebSocket(finalUrl, protocols) : new WebSocket(finalUrl);
  }

  const headers: Record<string, string> = {
    'X-Tenant-Host': environment.tenantHost,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const origin = environment.apiBaseUrl.replace(/\/api\/?$/u, '');
  if (origin) {
    headers.Origin = origin;
  }

  console.log('[WebSocket] 📤 Headers:', headers);
  console.log('[WebSocket] 🎯 Final URL:', finalUrl);

  const WebSocketImpl: any = WebSocket;
  const ws = protocols
    ? new WebSocketImpl(finalUrl, protocols, { headers })
    : new WebSocketImpl(finalUrl, undefined, { headers });

  // Add event listeners to debug connection issues
  ws.addEventListener('open', () => {
    console.log('[WebSocket] ✅ Connection OPENED successfully!', finalUrl.substring(0, 80));
  });

  ws.addEventListener('error', (event: any) => {
    console.error('[WebSocket] ❌ Connection ERROR:', {
      type: event.type,
      message: event.message,
      url: finalUrl.substring(0, 80),
    });
  });

  ws.addEventListener('close', (event: any) => {
    console.warn('[WebSocket] 🔴 Connection CLOSED:', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      url: finalUrl.substring(0, 80),
    });
  });

  return ws;
}
