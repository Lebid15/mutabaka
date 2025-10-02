import { request } from '../lib/httpClient';
import type { PinStatusPayload } from '../lib/pinSession';

export async function fetchPinStatus(): Promise<PinStatusPayload> {
  return request<PinStatusPayload>({
    path: 'auth/pin-status',
    method: 'GET',
  });
}
