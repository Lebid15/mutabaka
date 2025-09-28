import { request } from '../lib/httpClient';

export interface TotpStatus {
  enabled: boolean;
  has_secret?: boolean;
}

export interface TotpSetupResponse {
  secret: string;
  otpauth_uri: string;
}

export async function fetchTotpStatus(): Promise<TotpStatus> {
  return request<TotpStatus>({
    path: 'auth/totp/status',
    method: 'GET',
  });
}

export async function setupTotp(): Promise<TotpSetupResponse> {
  return request<TotpSetupResponse>({
    path: 'auth/totp/setup',
    method: 'POST',
  });
}

export async function enableTotp(otp: string): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }, { otp: string }>({
    path: 'auth/totp/enable',
    method: 'POST',
    body: { otp },
  });
}

export async function disableTotp(otp: string): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }, { otp: string }>({
    path: 'auth/totp/disable',
    method: 'POST',
    body: { otp },
  });
}

export async function fetchNotificationSoundUrl(): Promise<string | null> {
  return request<{ sound_url?: string | null }>({
    path: 'notification/sound',
    method: 'GET',
    auth: false,
  }).then((payload) => {
    if (payload && typeof payload.sound_url === 'string' && payload.sound_url.trim()) {
      return payload.sound_url.trim();
    }
    return null;
  }).catch((error) => {
    console.warn('[Mutabaka] Failed to fetch notification sound URL', error);
    return null;
  });
}
