/**
 * 🧪 اختبار Push Notifications - دليل سريع
 * 
 * استخدم هذا الملف للاختبار اليدوي السريع
 */

import { getExpoPushToken, checkPermissionStatus } from '../lib/pushNotifications';

/**
 * اختبار 1: التحقق من حالة الأذونات
 */
export async function testPermissionStatus() {
  console.log('🧪 Testing Permission Status...');
  
  const status = await checkPermissionStatus();
  console.log('✅ Permission Status:', status);
  
  if (status === 'denied') {
    console.warn('⚠️ Permissions denied - user needs to enable in settings');
  } else if (status === 'granted') {
    console.log('✅ Permissions granted');
  } else {
    console.log('ℹ️ Permissions not yet requested');
  }
  
  return status;
}

/**
 * اختبار 2: الحصول على Push Token
 */
export async function testGetPushToken() {
  console.log('🧪 Testing Push Token Retrieval...');
  
  try {
    const token = await getExpoPushToken();
    
    if (token) {
      console.log('✅ Push Token Retrieved:', token.substring(0, 30) + '...');
      console.log('📋 Full Token:', token);
      return token;
    } else {
      console.warn('⚠️ No token received - check permissions or device support');
      return null;
    }
  } catch (error) {
    console.error('❌ Error getting push token:', error);
    return null;
  }
}

/**
 * اختبار 3: اختبار شامل
 */
export async function runAllTests() {
  console.log('🚀 Running All Push Notification Tests...\n');
  
  // Test 1: Permission Status
  const permissionStatus = await testPermissionStatus();
  console.log('\n---\n');
  
  // Test 2: Get Token
  const token = await testGetPushToken();
  console.log('\n---\n');
  
  // Summary
  console.log('📊 Test Summary:');
  console.log('  Permission Status:', permissionStatus);
  console.log('  Token Retrieved:', token ? 'YES' : 'NO');
  
  if (token && permissionStatus === 'granted') {
    console.log('\n✅ All tests passed! Push Notifications are working.');
  } else {
    console.log('\n⚠️ Some tests failed. Check logs above for details.');
  }
  
  return { permissionStatus, token };
}

/**
 * استخدام في Console:
 * 
 * import { runAllTests } from './src/utils/testPushNotifications';
 * runAllTests();
 */
