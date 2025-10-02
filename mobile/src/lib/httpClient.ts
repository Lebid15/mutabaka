import { environment } from '../config/environment';
import { getAccessToken, getRefreshToken, storeAuthTokens, clearAuthTokens } from './authStorage';
import { getStoredDeviceId } from './deviceIdentity';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<TBody = unknown> {
  path: string;
  method?: HttpMethod;
  body?: TBody;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  skipJson?: boolean;
  deviceId?: string | null | false;
}

interface RefreshResponse {
  access: string;
  refresh?: string;
}

class HttpError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'X-Tenant-Host': environment.tenantHost,
  'X-Client': 'mobile',
};

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    console.warn('[Mutabaka] Network request failed', error);
    throw new HttpError(0, 'تعذر الاتصال بالخادم', error);
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = environment.apiBaseUrl.replace(/\/?$/, '/');
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(`${base}${cleanPath}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      url.searchParams.append(key, String(value));
    });
  }
  return url.toString();
}

async function refreshTokens(): Promise<string | null> {
  try {
    const refresh = await getRefreshToken();
    if (!refresh) {
      return null;
    }
    const response = await safeFetch(buildUrl('auth/token/refresh/'), {
      method: 'POST',
      headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    if (!response.ok) {
      await clearAuthTokens();
      return null;
    }
    const data = (await response.json()) as RefreshResponse;
    if (!data.access) {
      await clearAuthTokens();
      return null;
    }
    await storeAuthTokens({ accessToken: data.access, refreshToken: data.refresh ?? refresh });
    return data.access;
  } catch (error) {
    console.warn('[Mutabaka] Failed to refresh token', error);
    await clearAuthTokens();
    return null;
  }
}

export async function request<TResponse = unknown, TBody = unknown>(options: RequestOptions<TBody>): Promise<TResponse> {
  const { path, method = 'GET', body, headers = {}, query, auth = true, skipJson = false, deviceId } = options;
  let accessToken: string | null = null;
  if (auth) {
    accessToken = await getAccessToken();
    if (!accessToken) {
      const refreshed = await refreshTokens();
      accessToken = refreshed;
    }
    if (!accessToken) {
      throw new HttpError(401, 'Unauthorized', null);
    }
  }

  const lowerHeaderKeys = Object.keys(headers).map((key) => key.toLowerCase());
  const hasExplicitDeviceHeader = lowerHeaderKeys.includes('x-device-id');

  const finalHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...headers,
  };

  if (hasExplicitDeviceHeader) {
    // Honor explicit caller-provided header regardless of deviceId parameter unless forced off
    if (deviceId === false) {
      delete finalHeaders['X-Device-Id'];
      if (Object.prototype.hasOwnProperty.call(finalHeaders, 'x-device-id')) {
        delete (finalHeaders as Record<string, string>)['x-device-id'];
      }
    }
  } else if (deviceId !== false) {
    let resolvedDeviceId: string | null = null;
    if (typeof deviceId === 'string' && deviceId.length) {
      resolvedDeviceId = deviceId;
    } else if (deviceId === null) {
      resolvedDeviceId = null;
    } else {
      resolvedDeviceId = await getStoredDeviceId();
    }
    if (resolvedDeviceId) {
      finalHeaders['X-Device-Id'] = resolvedDeviceId;
    } else {
      delete finalHeaders['X-Device-Id'];
    }
  } else {
    delete finalHeaders['X-Device-Id'];
  }

  if (auth && accessToken) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }

  const url = buildUrl(path, query);
  const init: RequestInit = {
    method,
    headers: finalHeaders,
  };

  if (body !== undefined && body !== null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      init.body = body;
      delete finalHeaders['Content-Type'];
    } else if (typeof body === 'string') {
      init.body = body;
      if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
      }
    } else {
      init.body = JSON.stringify(body);
      if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
      }
    }
  }

  let response = await safeFetch(url, init);

  if (response.status === 401 && auth) {
    const refreshed = await refreshTokens();
    if (!refreshed) {
      throw new HttpError(401, 'Unauthorized', null);
    }
    finalHeaders.Authorization = `Bearer ${refreshed}`;
    response = await safeFetch(url, { ...init, headers: finalHeaders });
  }

  if (!response.ok) {
    let payload: unknown = null;
    let textPayload: string | null = null;
    try {
      textPayload = await response.text();
    } catch (error) {
      console.warn('[Mutabaka] Failed to read error response body', error);
    }

    if (textPayload && textPayload.trim().length) {
      try {
        payload = JSON.parse(textPayload);
      } catch {
        payload = textPayload;
      }
    }

    const message = typeof payload === 'object' && payload && 'detail' in payload
      ? String((payload as Record<string, unknown>).detail)
      : textPayload?.trim() || `Request failed with status ${response.status}`;
    throw new HttpError(response.status, message, payload);
  }

  if (skipJson || response.status === 204) {
    return undefined as TResponse;
  }
  return (await response.json()) as TResponse;
}

export { HttpError };
