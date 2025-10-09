import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getStoredDeviceId } from '../lib/deviceIdentity';
import { clearAll } from '../lib/pinSession';
import { useThemeMode } from '../theme';
import type { RootStackParamList } from '../navigation';
import {
  approvePendingDevice,
  createPendingDeviceForTesting,
  fetchLinkedDevices,
  type DeviceListResponse,
  rejectPendingDevice,
  renameDevice,
  replaceDevice,
  revokeDevice,
  type LinkedDevice,
  HttpError,
} from '../services/devices';
import { getQaSummary } from '../utils/qa';

const POLL_INTERVAL_MS = 12000;

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  const diffMs = Date.now() - timestamp.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'قبل لحظات';
  }
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `قبل ${minutes} دقيقة`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `قبل ${hours} ساعة`;
  }
  if (diffMs < 7 * day) {
    const days = Math.max(1, Math.floor(diffMs / day));
    return `قبل ${days} يوم`;
  }
  try {
    return timestamp.toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return timestamp.toLocaleDateString();
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return '403 • ليس لديك صلاحية لهذا الإجراء. تأكد أن الجهاز الحالي أساسي.';
    }
    if (error.status === 404) {
      return '404 • واجهة الأجهزة غير متاحة. تأكد من تحديث نسخة الخادم.';
    }
    if (typeof error.payload === 'string') {
      const trimmed = error.payload.trim();
      if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
        return 'تعذر تحليل استجابة الخادم (HTML). تحقق من عنوان الـ API أو سجلات الخادم.';
      }
      return trimmed;
    }
    if (error.payload && typeof error.payload === 'object') {
      const payload = error.payload as Record<string, unknown>;
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      const firstString = Object.values(payload).find((entry) => typeof entry === 'string');
      if (typeof firstString === 'string') {
        return firstString;
      }
    }
    return error.message || `خطأ (${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'حدث خطأ غير متوقع.';
}

function appendLog(setter: React.Dispatch<React.SetStateAction<string[]>>, message: string) {
  const timestamp = new Date().toISOString().split('T')[1]?.replace('Z', '') ?? '';
  setter((prev) => {
    const next = [...prev, `${timestamp} | ${message}`];
    return next.slice(-200);
  });
}

export default function QADevicesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const isDark = mode === 'dark';
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState<number>(3);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [renameState, setRenameState] = useState<{ device: LinkedDevice; value: string } | null>(null);
  const [renameSaving, setRenameSaving] = useState<boolean>(false);
  const [replaceState, setReplaceState] = useState<{ pending: LinkedDevice } | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [replaceSaving, setReplaceSaving] = useState<boolean>(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef<boolean>(true);

  const palette = useMemo(() => ({
    background: isDark ? '#07131a' : '#fef5eb',
    panel: isDark ? '#101d25' : '#ffffff',
    border: isDark ? '#1f2d35' : '#f2cdaa',
    heading: isDark ? '#e2e8f0' : '#3b2f25',
    sub: isDark ? '#94a3b8' : '#6a5442',
    primary: isDark ? '#0ea5e9' : '#0284c7',
    danger: isDark ? '#f87171' : '#dc2626',
    warning: isDark ? '#facc15' : '#b45309',
    success: isDark ? '#34d399' : '#15803d',
    text: isDark ? '#e2e8f0' : '#2d2018',
    pill: isDark ? '#1f2d35' : '#f2d5b6',
    code: isDark ? '#111827' : '#fef3c7',
  }), [isDark]);

  const activeDevices = useMemo(() => devices.filter((device) => device.status === 'primary' || device.status === 'active'), [devices]);
  const pendingDevices = useMemo(() => devices.filter((device) => device.status === 'pending'), [devices]);

  const replaceCandidates = useMemo(() => activeDevices.filter((device) => device.status !== 'primary'), [activeDevices]);

  const deviceUsageText = `${activeDevices.length}/${deviceLimit}`;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadDevices = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!mountedRef.current) {
      return;
    }
    if (mode === 'initial') {
      setLoading(true);
    }
    if (mode === 'refresh') {
      if (refreshing) {
        return;
      }
      setRefreshing(true);
    }
    try {
      appendLog(setLogs, `Polling devices (${mode})`);
  const payload: DeviceListResponse = await fetchLinkedDevices();
      if (!mountedRef.current) {
        return;
      }
      setDevices(payload.devices ?? []);
      setDeviceLimit(payload.limit ?? 3);
      appendLog(setLogs, `Loaded ${payload.devices?.length ?? 0} devices (limit ${payload.limit ?? 0})`);
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Failed to load devices: ${message}`);
      if (mode === 'initial') {
        Alert.alert('تعذر تحميل الأجهزة', message);
      }
    } finally {
      if (!mountedRef.current) {
        return;
      }
      if (mode === 'initial') {
        setLoading(false);
      }
      if (mode === 'refresh') {
        setRefreshing(false);
      }
    }
  }, [refreshing]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      let cancelled = false;
      (async () => {
        try {
          const storedId = await getStoredDeviceId();
          if (!cancelled && mountedRef.current) {
            setCurrentDeviceId(storedId);
          }
        } catch (error) {
          appendLog(setLogs, `Failed to resolve current device id: ${String(error)}`);
        }
      })();
      loadDevices('initial').catch((error) => {
        appendLog(setLogs, `Initial load error: ${String(error)}`);
      });
      stopPolling();
      pollRef.current = setInterval(() => {
        loadDevices('silent').catch((error) => {
          appendLog(setLogs, `Poll error: ${String(error)}`);
        });
      }, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        mountedRef.current = false;
        stopPolling();
      };
    }, [loadDevices, stopPolling]),
  );

  const handleRefresh = useCallback(() => {
    loadDevices('refresh').catch((error) => {
      appendLog(setLogs, `Manual refresh error: ${String(error)}`);
    });
  }, [loadDevices]);

  const handleCreatePending = useCallback(async () => {
    setActionPendingId('create');
    try {
      const device = await createPendingDeviceForTesting();
      appendLog(setLogs, `Created pending device ${device.device_id}`);
      Alert.alert('تم إنشاء جهاز تجريبي', `تمت إضافة جهاز جديد (${device.label}) بانتظار الموافقة.`);
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Create pending failed: ${message}`);
      Alert.alert('تعذر الإنشاء', message);
    } finally {
      if (mountedRef.current) {
        setActionPendingId(null);
      }
    }
  }, [loadDevices]);

  const handleApprove = useCallback(async (device: LinkedDevice) => {
    setActionPendingId(`approve:${device.device_id}`);
    try {
      await approvePendingDevice({ pendingDeviceId: device.device_id });
      appendLog(setLogs, `Approved pending device ${device.device_id}`);
      Alert.alert('تمت الموافقة', `${device.label || device.device_id} أصبح نشطًا.`);
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Approve failed: ${message}`);
      Alert.alert('تعذر الموافقة', message, [
        { text: 'استبدال', onPress: () => setReplaceState({ pending: device }) },
        { text: 'حسناً' },
      ]);
    } finally {
      if (mountedRef.current) {
        setActionPendingId(null);
      }
    }
  }, [loadDevices]);

  const handleReject = useCallback(async (device: LinkedDevice) => {
    setActionPendingId(`reject:${device.device_id}`);
    try {
      await rejectPendingDevice({ deviceId: device.device_id });
      appendLog(setLogs, `Rejected pending device ${device.device_id}`);
      Alert.alert('تم الرفض', `${device.label || device.device_id} تمت إزالة الطلب.`);
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Reject failed: ${message}`);
      Alert.alert('تعذر الرفض', message);
    } finally {
      if (mountedRef.current) {
        setActionPendingId(null);
      }
    }
  }, [loadDevices]);

  const handleRevoke = useCallback(async (device: LinkedDevice) => {
    setActionPendingId(`revoke:${device.device_id}`);
    try {
      await revokeDevice({ deviceId: device.device_id });
      appendLog(setLogs, `Revoked device ${device.device_id}`);
      Alert.alert('تم الإلغاء', `${device.label || device.device_id} لم يعد نشطًا.`);
      if (device.device_id === currentDeviceId) {
        appendLog(setLogs, 'Current device revoked – clearing session');
        await clearAll();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Revoke failed: ${message}`);
      Alert.alert('تعذر الإلغاء', message);
    } finally {
      if (mountedRef.current) {
        setActionPendingId(null);
      }
    }
  }, [currentDeviceId, loadDevices, navigation]);

  const handleOpenRename = useCallback((device: LinkedDevice) => {
    setRenameState({ device, value: device.label });
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameState) {
      return;
    }
    const trimmed = renameState.value.trim();
    if (!trimmed.length) {
      Alert.alert('اسم غير صالح', 'أدخل اسمًا واضحًا للجهاز.');
      return;
    }
    setRenameSaving(true);
    try {
      await renameDevice({ deviceId: renameState.device.device_id, label: trimmed });
      appendLog(setLogs, `Renamed device ${renameState.device.device_id} -> ${trimmed}`);
      Alert.alert('تم الحفظ', 'تم تحديث اسم الجهاز.');
      setRenameState(null);
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Rename failed: ${message}`);
      Alert.alert('تعذر التحديث', message);
    } finally {
      if (mountedRef.current) {
        setRenameSaving(false);
      }
    }
  }, [loadDevices, renameState]);

  const handleCancelRename = useCallback(() => {
    setRenameState(null);
    setRenameSaving(false);
  }, []);

  const handleOpenReplace = useCallback((device: LinkedDevice) => {
    setReplaceTargetId(replaceCandidates[0]?.device_id ?? null);
    setReplaceState({ pending: device });
  }, [replaceCandidates]);

  const handleConfirmReplace = useCallback(async () => {
    if (!replaceState || !replaceTargetId) {
      Alert.alert('اختر جهازًا', 'يرجى اختيار الجهاز الذي سيتم استبداله.');
      return;
    }
    setReplaceSaving(true);
    try {
      await replaceDevice({
        pendingDeviceId: replaceState.pending.device_id,
        replaceDeviceId: replaceTargetId,
      });
      appendLog(setLogs, `Replace approved ${replaceState.pending.device_id} -> ${replaceTargetId}`);
      Alert.alert('تمت الموافقة مع الاستبدال', 'تم تفعيل الجهاز بعد إزالة جهاز آخر.');
      setReplaceState(null);
      setReplaceTargetId(null);
      await loadDevices('silent');
    } catch (error) {
      const message = extractErrorMessage(error);
      appendLog(setLogs, `Replace failed: ${message}`);
      Alert.alert('تعذر الاستبدال', message);
    } finally {
      if (mountedRef.current) {
        setReplaceSaving(false);
        setActionPendingId(null);
      }
    }
  }, [loadDevices, replaceState, replaceTargetId]);

  const handleCancelReplace = useCallback(() => {
    setReplaceState(null);
    setReplaceTargetId(null);
    setReplaceSaving(false);
    setActionPendingId(null);
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View style={[styles.header, { borderColor: palette.border, backgroundColor: palette.panel }]}
      >
        <Text style={[styles.title, { color: palette.heading }]}>QA • الأجهزة</Text>
        <Text style={[styles.subtitle, { color: palette.sub }]}>{getQaSummary()}</Text>
        <View style={[styles.headerRow]}
        >
          <Text style={[styles.counter, { color: palette.text }]}>الاستخدام: {deviceUsageText}</Text>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: actionPendingId === 'create' ? 0.6 : 1 }]}
            onPress={handleCreatePending}
            disabled={actionPendingId === 'create'}
          >
            {actionPendingId === 'create' ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Create Pending</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, { borderColor: palette.border, opacity: refreshing ? 0.6 : 1 }]}
            onPress={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={palette.sub} />
            ) : (
              <Text style={[styles.buttonText, { color: palette.text }]}>Refresh</Text>
            )}
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={{ color: palette.sub }}>جاري التحميل…</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.heading }]}>الأجهزة النشطة</Text>
            {activeDevices.length === 0 ? (
              <Text style={[styles.emptyText, { color: palette.sub }]}>لا يوجد أجهزة نشطة حالياً.</Text>
            ) : (
              activeDevices.map((device) => {
                const isPrimary = device.status === 'primary';
                const isCurrent = device.device_id === currentDeviceId;
                const revokeBusy = actionPendingId === `revoke:${device.device_id}`;
                return (
                  <View key={device.device_id} style={[styles.deviceCard, { borderColor: palette.border, backgroundColor: palette.panel }]}
                  >
                    <View style={styles.deviceHeader}>
                      <Text style={[styles.deviceLabel, { color: palette.text }]}>{device.label || device.device_id}</Text>
                      <View style={styles.badgeRow}>
                        <Text style={[styles.badge, { color: palette.success }]}>{device.status}</Text>
                        {isPrimary ? <Text style={[styles.chip, { borderColor: palette.pill, color: palette.sub }]}>Primary</Text> : null}
                        {isCurrent ? <Text style={[styles.chip, { borderColor: palette.pill, color: palette.sub }]}>This device</Text> : null}
                      </View>
                    </View>
                    <Text style={[styles.meta, { color: palette.sub }]}>ID: {device.device_id}</Text>
                    <Text style={[styles.meta, { color: palette.sub }]}>Platform: {device.platform} • Version: {device.app_version}</Text>
                    <Text style={[styles.meta, { color: palette.sub }]}>Last seen: {formatRelativeTime(device.last_seen_at)}</Text>
                    <View style={styles.actionsRow}>
                      <Pressable
                        style={[styles.secondaryButton, { borderColor: palette.border }]}
                        onPress={() => handleOpenRename(device)}
                      >
                        <Text style={[styles.buttonText, { color: palette.text }]}>Rename</Text>
                      </Pressable>
                      {!isPrimary ? (
                        <Pressable
                          style={[styles.dangerButton, { backgroundColor: palette.danger, opacity: revokeBusy ? 0.6 : 1 }]}
                          onPress={() => handleRevoke(device)}
                          disabled={revokeBusy}
                        >
                          {revokeBusy ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <Text style={styles.buttonText}>Revoke</Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.heading }]}>طلبات بانتظار الموافقة</Text>
            {pendingDevices.length === 0 ? (
              <Text style={[styles.emptyText, { color: palette.sub }]}>لا توجد طلبات حالياً.</Text>
            ) : (
              pendingDevices.map((device) => {
                const approveBusy = actionPendingId === `approve:${device.device_id}`;
                const rejectBusy = actionPendingId === `reject:${device.device_id}`;
                return (
                  <View key={device.device_id} style={[styles.deviceCard, { borderColor: palette.border, backgroundColor: palette.panel }]}
                  >
                    <View style={styles.deviceHeader}>
                      <Text style={[styles.deviceLabel, { color: palette.text }]}>{device.label || device.device_id}</Text>
                      <View style={styles.badgeRow}>
                        <Text style={[styles.badge, { color: palette.warning }]}>pending</Text>
                        {device.requires_replace ? (
                          <Text style={[styles.chip, { borderColor: palette.danger, color: palette.danger }]}>Requires replace</Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={[styles.meta, { color: palette.sub }]}>ID: {device.device_id}</Text>
                    <Text style={[styles.meta, { color: palette.sub }]}>Created: {formatRelativeTime(device.created_at)} • Expires: {formatRelativeTime(device.pending_expires_at)}</Text>
                    <View style={styles.actionsRow}>
                      <Pressable
                        style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: approveBusy ? 0.6 : 1 }]}
                        onPress={() => handleApprove(device)}
                        disabled={approveBusy}
                      >
                        {approveBusy ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.buttonText}>Approve</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.secondaryButton, { borderColor: palette.border }]}
                        onPress={() => handleOpenReplace(device)}
                      >
                        <Text style={[styles.buttonText, { color: palette.text }]}>Replace</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.dangerButton, { backgroundColor: palette.danger, opacity: rejectBusy ? 0.6 : 1 }]}
                        onPress={() => handleReject(device)}
                        disabled={rejectBusy}
                      >
                        {rejectBusy ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.buttonText}>Reject</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.heading }]}>Logs</Text>
            <View style={[styles.logBox, { borderColor: palette.border, backgroundColor: palette.panel }]}>
              {logs.length === 0 ? (
                <Text style={{ color: palette.sub }}>No events yet.</Text>
              ) : (
                logs
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <Text key={index} style={[styles.logLine, { color: palette.text }]}>
                      {entry}
                    </Text>
                  ))
              )}
            </View>
          </View>
        </ScrollView>
      )}

      <Modal visible={Boolean(renameState)} transparent animationType="fade" onRequestClose={handleCancelRename}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.panel, borderColor: palette.border }]}
          >
            <Text style={[styles.modalTitle, { color: palette.heading }]}>Rename device</Text>
            <Text style={[styles.modalSubtitle, { color: palette.sub }]}>اكتب اسمًا واضحًا للتعرّف على الجهاز بسهولة.</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: palette.border, color: palette.text }]}
              placeholder="Device label"
              placeholderTextColor={palette.sub}
              value={renameState?.value ?? ''}
              onChangeText={(value) => setRenameState((prev) => (prev ? { ...prev, value } : prev))}
              editable={!renameSaving}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.secondaryButton, { borderColor: palette.border }]} onPress={handleCancelRename}>
                <Text style={[styles.buttonText, { color: palette.text }]}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: renameSaving ? 0.6 : 1 }]}
                onPress={handleRenameSubmit}
                disabled={renameSaving}
              >
                {renameSaving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.buttonText}>حفظ</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(replaceState)} transparent animationType="fade" onRequestClose={handleCancelReplace}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.panel, borderColor: palette.border }]}
          >
            <Text style={[styles.modalTitle, { color: palette.heading }]}>Replace device</Text>
            <Text style={[styles.modalSubtitle, { color: palette.sub }]}
            >
              اختر جهازًا نشطًا سيتم استبداله بالجهاز الجديد ({replaceState?.pending.label || replaceState?.pending.device_id}).
            </Text>
            <View style={styles.replaceList}>
              {replaceCandidates.length === 0 ? (
                <Text style={[styles.emptyText, { color: palette.sub }]}>لا يوجد أجهزة قابلة للاستبدال (الجهاز الأساسي فقط).</Text>
              ) : (
                replaceCandidates.map((device) => {
                  const selected = replaceTargetId === device.device_id;
                  return (
                    <Pressable
                      key={device.device_id}
                      style={[
                        styles.replaceOption,
                        {
                          borderColor: selected ? palette.primary : palette.border,
                          backgroundColor: selected ? palette.primary + '11' : palette.panel,
                        },
                      ]}
                      onPress={() => setReplaceTargetId(device.device_id)}
                    >
                      <Text style={[styles.deviceLabel, { color: palette.text }]}>{device.label || device.device_id}</Text>
                      <Text style={[styles.meta, { color: palette.sub }]}>Last seen: {formatRelativeTime(device.last_seen_at)}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={[styles.secondaryButton, { borderColor: palette.border }]} onPress={handleCancelReplace}>
                <Text style={[styles.buttonText, { color: palette.text }]}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: replaceSaving || !replaceTargetId ? 0.6 : 1 }]}
                onPress={handleConfirmReplace}
                disabled={replaceSaving || !replaceTargetId}
              >
                {replaceSaving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.buttonText}>استبدال</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: 40,
  },
  header: {
    margin: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  counter: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  primaryButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 12,
  },
  deviceCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  deviceLabel: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  chip: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 999,
  },
  meta: {
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  logBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 6,
    maxHeight: 220,
  },
  logLine: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 20,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  replaceList: {
    gap: 12,
  },
  replaceOption: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
});
