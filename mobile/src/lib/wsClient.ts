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
  const WebSocketImpl: any = WebSocket;
  return protocols
    ? new WebSocketImpl(finalUrl, protocols, { headers })
    : new WebSocketImpl(finalUrl, undefined, { headers });
}
