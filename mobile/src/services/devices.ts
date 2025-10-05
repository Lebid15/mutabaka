import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { request, HttpError } from '../lib/httpClient';
import { getStoredDeviceId, setStoredDeviceId } from '../lib/deviceIdentity';

export type DeviceStatus = 'primary' | 'active' | 'pending' | 'revoked' | string;

export interface LinkedDevice {
  device_id: string;
  status: DeviceStatus;
  label: string;
  platform: string;
  app_version: string;
  push_token: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  pending_expires_at: string | null;
  requires_replace?: boolean;
  pending_token?: string | null;
}

export interface LinkDeviceResponse {
  device: LinkedDevice;
}

export interface LinkDeviceOptions {
  accessToken: string;
  labelOverride?: string;
  platformOverride?: string;
  appVersionOverride?: string;
  pushToken?: string | null;
  skipPersistId?: boolean;
}

function resolveDefaultLabel(): string {
  // Try to get actual device model name
  const deviceName = Device.deviceName?.trim();
  const modelName = Device.modelName?.trim();
  
  // Prefer deviceName (e.g., "Samsung Galaxy S21"), fallback to modelName (e.g., "SM-G991B")
  if (deviceName && deviceName.length > 0) {
    return deviceName.slice(0, 120);
  }
  if (modelName && modelName.length > 0) {
    return modelName.slice(0, 120);
  }
  
  // Fallback to platform-specific defaults
  switch (Platform.OS) {
    case 'ios':
      return 'جهاز iOS';
    case 'android':
      return 'جهاز Android';
    case 'web':
      return 'متصفح الويب';
    default:
      return 'جهازي';
  }
}

function resolvePlatform(override?: string): string {
  if (override && override.length) {
    return override;
  }
  return Platform.OS;
}

function resolveAppVersion(override?: string): string {
  if (override && override.length) {
    return override;
  }
  // Use expo-application to get version info
  const nativeVersion = Application.nativeApplicationVersion;
  const nativeBuild = Application.nativeBuildVersion;
  return nativeVersion || nativeBuild || 'dev';
}

function generateQaDeviceId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `qa-${Date.now().toString(36)}-${rand}`;
}

export async function linkCurrentDevice(options: LinkDeviceOptions): Promise<LinkDeviceResponse> {
  const payload = {
    label: options.labelOverride?.trim() || resolveDefaultLabel(),
    platform: resolvePlatform(options.platformOverride),
    app_version: resolveAppVersion(options.appVersionOverride),
    push_token: options.pushToken ?? null,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
  };

  const deviceId = await getStoredDeviceId();

  const response = await request<LinkDeviceResponse, typeof payload>({
    path: 'auth/devices/link',
    method: 'POST',
    auth: false,
    headers,
    deviceId: deviceId ?? false,
    body: payload,
  });

  if (!options.skipPersistId && response.device?.device_id) {
    await setStoredDeviceId(response.device.device_id);
  }

  return response;
}

export function isDeviceActive(status: DeviceStatus | undefined): boolean {
  if (!status) {
    return false;
  }
  return status === 'primary' || status === 'active';
}

export function isDevicePending(status: DeviceStatus | undefined): boolean {
  return status === 'pending';
}

export interface DeviceListResponse {
  devices: LinkedDevice[];
  limit: number;
}

export async function fetchLinkedDevices(): Promise<DeviceListResponse> {
  return request<DeviceListResponse>({
    path: 'auth/devices',
    method: 'GET',
  });
}

export async function approvePendingDevice(options: {
  pendingDeviceId?: string;
  pendingToken?: string | null;
  replaceDeviceId?: string | null;
}): Promise<LinkedDevice> {
  const response = await request<{ device: LinkedDevice }, Record<string, unknown>>({
    path: 'auth/devices/approve',
    method: 'POST',
    body: {
      device_id: options.pendingDeviceId,
      pending_token: options.pendingToken,
      replace_device_id: options.replaceDeviceId,
    },
  });
  return response.device;
}

export async function rejectPendingDevice(options: {
  deviceId?: string;
  pendingToken?: string | null;
}): Promise<void> {
  await request<{ detail: string }, Record<string, unknown>>({
    path: 'auth/devices/reject',
    method: 'POST',
    body: {
      device_id: options.deviceId,
      pending_token: options.pendingToken,
    },
  });
}

export async function revokeDevice(options: { deviceId: string }): Promise<void> {
  await request<{ detail: string }, Record<string, unknown>>({
    path: 'auth/devices/revoke',
    method: 'POST',
    body: {
      device_id: options.deviceId,
    },
  });
}

export async function replaceDevice(options: {
  pendingDeviceId: string;
  replaceDeviceId: string;
  pendingToken?: string | null;
}): Promise<LinkedDevice> {
  const response = await request<{ device: LinkedDevice }, Record<string, unknown>>({
    path: 'auth/devices/replace',
    method: 'POST',
    body: {
      device_id: options.pendingDeviceId,
      replace_device_id: options.replaceDeviceId,
      pending_token: options.pendingToken,
    },
  });
  return response.device;
}

export async function renameDevice(options: { deviceId: string; label: string }): Promise<LinkedDevice> {
  const response = await request<{ device: LinkedDevice }, Record<string, unknown>>({
    path: 'auth/devices/rename',
    method: 'POST',
    body: {
      device_id: options.deviceId,
      label: options.label,
    },
  });
  return response.device;
}

/**
 * تحديث Push Token للجهاز الحالي
 * يُستخدم عند تفعيل الإشعارات بعد رفضها سابقاً
 */
export async function updateCurrentDevicePushToken(pushToken: string): Promise<LinkedDevice> {
  const deviceId = await getStoredDeviceId();
  
  if (!deviceId) {
    throw new Error('No device ID found');
  }

  const response = await request<{ device: LinkedDevice }, Record<string, unknown>>({
    path: 'auth/devices/update-token',
    method: 'POST',
    body: {
      device_id: deviceId,
      push_token: pushToken,
    },
  });
  
  return response.device;
}

export async function createPendingDeviceForTesting(options?: {
  label?: string;
  platform?: string;
  appVersion?: string;
}): Promise<LinkedDevice> {
  const debugDeviceId = generateQaDeviceId();
  const payload = {
    label: options?.label?.trim() || `QA Device ${new Date().toISOString()}`,
    platform: options?.platform?.trim() || 'qa-debug',
    app_version: options?.appVersion?.trim() || 'qa-debug',
    push_token: null,
  };

  const response = await request<{ device: LinkedDevice }, typeof payload>({
    path: 'auth/devices/link',
    method: 'POST',
    body: payload,
    deviceId: debugDeviceId,
  });

  return response.device;
}

export { HttpError };
