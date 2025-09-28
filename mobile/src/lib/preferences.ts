import AsyncStorage from '@react-native-async-storage/async-storage';

const SOUND_ENABLED_KEY = 'mutabaka-notification-sound-enabled';

export async function getNotificationSoundEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(SOUND_ENABLED_KEY);
    if (stored === null) {
      return true;
    }
    return stored === '1';
  } catch (error) {
    console.warn('[Mutabaka] Failed to read notification sound preference', error);
    return true;
  }
}

export async function setNotificationSoundEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SOUND_ENABLED_KEY, enabled ? '1' : '0');
  } catch (error) {
    console.warn('[Mutabaka] Failed to persist notification sound preference', error);
  }
}
