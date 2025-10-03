/**
 * Shim for expo-constants to prevent crashes in development builds
 * This provides minimal mock implementation for when expo-constants fails to load
 */

import { Platform } from 'react-native';

// Mock the Constants module
const MockConstants = {
  expoVersion: '54.0.0',
  deviceName: Platform.select({
    ios: 'iPhone',
    android: 'Android Device',
    web: 'Web Browser',
    default: 'Unknown Device',
  }),
  appOwnership: 'expo',
  platform: {
    ios: Platform.OS === 'ios' ? { platform: 'ios' } : undefined,
    android: Platform.OS === 'android' ? { versionCode: 1 } : undefined,
  },
  isDevice: true,
  getConstants() {
    return this;
  },
};

// Try to load real expo-constants, fall back to mock
let Constants: any;
try {
  // @ts-ignore
  Constants = require('expo-constants').default;
  if (!Constants || typeof Constants.getConstants !== 'function') {
    throw new Error('expo-constants not properly loaded');
  }
} catch (error) {
  console.warn('[expo-constants-shim] Using mock Constants due to:', error);
  Constants = MockConstants;
}

export default Constants;
