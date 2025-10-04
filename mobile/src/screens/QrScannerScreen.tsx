import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FeatherIcon from '@expo/vector-icons/Feather';
import BackgroundGradient from '../components/BackgroundGradient';
import { useThemeMode } from '../theme';
import type { RootStackParamList } from '../navigation';
import { approveWebLogin } from '../services/qrLogin';
import { getAccessToken } from '../lib/authStorage';
import { getStoredDeviceId } from '../lib/deviceIdentity';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'QrScanner'>;

export default function QrScannerScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { tokens } = useThemeMode();
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            {
              title: 'إذن الكاميرا',
              message: 'يحتاج التطبيق للوصول إلى الكاميرا لمسح رمز QR.',
              buttonNeutral: 'اسألني لاحقاً',
              buttonNegative: 'إلغاء',
              buttonPositive: 'موافق',
            },
          );
          setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
        } else {
          setHasPermission(true); // iOS permissions handled by Info.plist
        }
      } catch (error) {
        console.error('Permission check error:', error);
        setHasPermission(false);
      }
    })();
  }, []);

  const handleBarCodeRead = useCallback(
    async (event: any) => {
      if (isProcessing || scanned) return;
      
      const data = event?.nativeEvent?.codeStringValue || '';
      if (!data) return;

      console.log('[QrScanner] Scanned data:', data);

      // التحقق من أن الرابط بالصيغة الصحيحة
      if (!data || !data.startsWith('mutabaka://link')) {
        Alert.alert('رمز QR غير صالح', 'هذا الرمز ليس رمز تسجيل دخول صحيح.');
        setScanned(false);
        return;
      }

      setScanned(true);
      setIsProcessing(true);

      try {
        const accessToken = await getAccessToken();
        const deviceId = await getStoredDeviceId();

        if (!accessToken || !deviceId) {
          throw new Error('الرجاء تسجيل الدخول أولاً');
        }

        console.log('[QrScanner] Approving web login...');
        await approveWebLogin({
          payload: data,
          accessToken,
          deviceId,
        });

        Alert.alert(
          '✅ تم بنجاح',
          'تم ربط المتصفح بنجاح! يمكنك الآن استخدام موقع مطابقة من المتصفح.',
          [
            {
              text: 'حسناً',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      } catch (error: any) {
        console.error('[QrScanner] Error approving web login:', error);
        
        let errorMessage = 'حدث خطأ أثناء ربط المتصفح. يرجى المحاولة مرة أخرى.';
        
        if (error?.message) {
          if (error.message.includes('expired')) {
            errorMessage = 'انتهت صلاحية رمز QR. يرجى تحديث الصفحة في المتصفح والمحاولة مرة أخرى.';
          } else if (error.message.includes('already')) {
            errorMessage = 'تم استخدام هذا الرمز بالفعل. يرجى إنشاء رمز جديد من المتصفح.';
          } else if (error.message.includes('token')) {
            errorMessage = 'رمز QR غير صحيح. تأكد من مسح الرمز من صفحة تسجيل الدخول.';
          }
        }

        Alert.alert('فشل الربط', errorMessage, [
          {
            text: 'حسناً',
            onPress: () => {
              setScanned(false);
              setIsProcessing(false);
            },
          },
        ]);
      }
    },
    [isProcessing, scanned, navigation]
  );

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  if (hasPermission === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: tokens.background }]}>
        <BackgroundGradient>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={[styles.loadingText, { color: tokens.textPrimary }]}>جارٍ التحميل...</Text>
          </View>
        </BackgroundGradient>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    const requestPermission = async () => {
      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            {
              title: 'إذن الكاميرا',
              message: 'يحتاج التطبيق للوصول إلى الكاميرا لمسح رمز QR.',
              buttonNeutral: 'اسألني لاحقاً',
              buttonNegative: 'إلغاء',
              buttonPositive: 'موافق',
            },
          );
          setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
          
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert(
              'لا يمكن الوصول للكاميرا',
              'يرجى السماح بإذن الكاميرا من إعدادات التطبيق.',
              [
                { text: 'إلغاء', style: 'cancel' },
                { text: 'فتح الإعدادات', onPress: () => Linking.openSettings() },
              ]
            );
          }
        }
      } catch (error) {
        console.error('Permission request error:', error);
      }
    };
    
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: tokens.background }]}>
        <BackgroundGradient>
          <View style={styles.permissionContainer}>
          <FeatherIcon name="camera-off" size={64} color={tokens.textSecondary} />
          <Text style={[styles.permissionTitle, { color: tokens.textPrimary }]}>
            إذن الكاميرا مطلوب
          </Text>
          <Text style={[styles.permissionDescription, { color: tokens.textSecondary }]}>
            نحتاج إلى إذن الوصول إلى الكاميرا لمسح رمز QR من المتصفح وربطه بحسابك.
          </Text>
          <Pressable
            style={[styles.permissionButton, { backgroundColor: tokens.accent }]}
            onPress={requestPermission}
          >
            <Text style={styles.permissionButtonText}>منح الإذن</Text>
          </Pressable>
          <Pressable style={styles.backButton} onPress={handleGoBack}>
            <Text style={[styles.backButtonText, { color: tokens.textSecondary }]}>رجوع</Text>
          </Pressable>
        </View>
        </BackgroundGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tokens.background }]}>
      <BackgroundGradient>
      
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: tokens.divider }]}>
        <Pressable onPress={handleGoBack} style={styles.headerButton}>
          <FeatherIcon name="arrow-right" size={24} color={tokens.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: tokens.textPrimary }]}>
          ربط الجوال بالمتصفح
        </Text>
        <View style={styles.headerButton} />
      </View>

      {/* Camera View */}
      <View style={styles.cameraContainer}>
        <Camera
          style={styles.camera}
          scanBarcode={!scanned && !isProcessing}
          onReadCode={handleBarCodeRead}
          showFrame={false}
        />
        
        {/* Overlay */}
        <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.scanArea}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom}>
            <Text style={styles.instructionText}>
              وجّه الكاميرا نحو رمز QR في المتصفح
            </Text>
          </View>
        </View>

        {isProcessing && (
          <View style={styles.processingOverlay}>
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color="#2f9d73" />
              <Text style={styles.processingText}>جارٍ ربط المتصفح...</Text>
            </View>
          </View>
        )}
      </View>

      {/* Instructions */}
      <View style={[styles.instructionsContainer, { backgroundColor: tokens.panel }]}>
        <Text style={[styles.instructionsTitle, { color: tokens.textPrimary }]}>
          خطوات الربط:
        </Text>
        <View style={styles.instructionRow}>
          <View style={[styles.stepBadge, { backgroundColor: tokens.accent }]}>
            <Text style={styles.stepNumber}>1</Text>
          </View>
          <Text style={[styles.instructionText, { color: tokens.textSecondary }]}>
            افتح موقع مطابقة من المتصفح
          </Text>
        </View>
        <View style={styles.instructionRow}>
          <View style={[styles.stepBadge, { backgroundColor: tokens.accent }]}>
            <Text style={styles.stepNumber}>2</Text>
          </View>
          <Text style={[styles.instructionText, { color: tokens.textSecondary }]}>
            امسح رمز QR الظاهر على الشاشة
          </Text>
        </View>
        <View style={styles.instructionRow}>
          <View style={[styles.stepBadge, { backgroundColor: tokens.accent }]}>
            <Text style={styles.stepNumber}>3</Text>
          </View>
          <Text style={[styles.instructionText, { color: tokens.textSecondary }]}>
            سيتم تسجيل دخولك تلقائياً في المتصفح
          </Text>
        </View>
      </View>
      </BackgroundGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 16,
  },
  permissionDescription: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  permissionButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButton: {
    marginTop: 8,
    paddingVertical: 12,
  },
  backButtonText: {
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanArea: {
    width: 280,
    height: 280,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#2f9d73',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    minWidth: 200,
  },
  processingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  instructionsContainer: {
    padding: 20,
    gap: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumber: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
