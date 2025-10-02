import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@mutabaka/device/id';
let cachedDeviceId: string | null | undefined;

export async function getStoredDeviceId(): Promise<string | null> {
  if (typeof cachedDeviceId !== 'undefined') {
    return cachedDeviceId;
  }
  try {
    const value = await AsyncStorage.getItem(DEVICE_ID_KEY);
    cachedDeviceId = value && value.length ? value : null;
    return cachedDeviceId;
  } catch (error) {
    console.warn('[Mutabaka] Failed to read cached device id', error);
    cachedDeviceId = null;
    return null;
  }
}

export function getCachedDeviceId(): string | null {
  return typeof cachedDeviceId === 'undefined' ? null : cachedDeviceId;
}

export async function setStoredDeviceId(deviceId: string | null): Promise<void> {
  cachedDeviceId = deviceId && deviceId.length ? deviceId : null;
  try {
    if (cachedDeviceId) {
      await AsyncStorage.setItem(DEVICE_ID_KEY, cachedDeviceId);
    } else {
      await AsyncStorage.removeItem(DEVICE_ID_KEY);
    }
  } catch (error) {
    console.warn('[Mutabaka] Failed to persist device id', error);
  }
}
