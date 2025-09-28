import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  I18nManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { HttpError } from '../lib/httpClient';
import {
  createTeamMember,
  deleteTeamMember,
  listTeamMembers,
  updateTeamMember,
  type TeamMember,
} from '../services/team';

interface TeamFormState {
  username: string;
  displayName: string;
  phone: string;
  password: string;
}

interface EditDraftState {
  displayName: string;
  phone: string;
  password: string;
}

const USERNAME_REGEX = /^[A-Za-z]+$/;

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof HttpError) {
    const { payload, message } = error;
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      const detail = (payload as Record<string, unknown>).detail;
      if (typeof detail === 'string' && detail.trim()) {
        return detail;
      }
      const nonField = (payload as Record<string, unknown>).non_field_errors;
      if (Array.isArray(nonField) && typeof nonField[0] === 'string') {
        return nonField[0];
      }
      for (const value of Object.values(payload)) {
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
        if (Array.isArray(value) && typeof value[0] === 'string') {
          return value[0];
        }
      }
    }
    return message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
};

export default function TeamScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const [form, setForm] = useState<TeamFormState>({ username: '', displayName: '', phone: '', password: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraftState>({ displayName: '', phone: '', password: '' });
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const palette = useMemo(() => ({
    panelBg: isLight ? 'rgba(255,255,255,0.95)' : '#0f1b22',
    panelBorder: isLight ? '#f2cdaa' : '#233138',
    headerIcon: isLight ? '#f97316' : '#facc15',
    headerText: isLight ? '#1f2937' : '#e2e8f0',
    subText: isLight ? '#7f6958' : '#94a3b8',
    title: isLight ? '#3b2f24' : '#f8fafc',
    inputBg: isLight ? '#ffffff' : '#152430',
    inputBorder: isLight ? '#f1c59c' : '#233138',
    inputText: isLight ? '#3c2f25' : '#f8fafc',
    inputPlaceholder: isLight ? '#a8927d' : '#64748b',
    buttonPrimaryBg: isLight ? '#2f9d73' : '#059669',
    buttonPrimaryText: '#ffffff',
    buttonSecondaryBg: isLight ? '#2563EB' : '#1d4ed8',
    buttonSecondaryText: '#ffffff',
    buttonDangerBg: isLight ? '#dc2626' : '#ef4444',
    buttonDangerText: '#ffffff',
  buttonDisabledBg: isLight ? '#d1d5db' : '#374151',
  buttonDisabledText: isLight ? '#f8fafc' : '#cbd5f5',
    cardBg: isLight ? '#fff9f1' : '#13222b',
    cardBorder: isLight ? '#f1c8a4' : '#233138',
    divider: isLight ? '#f3d8bb' : '#1f2d35',
    infoText: isLight ? '#9a8878' : '#94a3b8',
    errorText: isLight ? '#d1433f' : '#f87171',
  }), [isLight]);

  const resetForm = useCallback(() => {
    setForm({ username: '', displayName: '', phone: '', password: '' });
    setFormError(null);
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const data = await listTeamMembers();
      setMembers(data);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        setAuthRequired(true);
      } else {
        setError(extractErrorMessage(err, 'تعذر تحميل بيانات الفريق'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMembers();
    }, [loadMembers]),
  );

  const handleCreate = useCallback(async () => {
    const username = form.username.trim();
    const password = form.password.trim();
    const displayName = form.displayName.trim();
    const phone = form.phone.trim();

    if (!username) {
      setFormError('يرجى إدخال اسم المستخدم');
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      setFormError('اسم المستخدم يجب أن يتكوّن من أحرف لاتينية فقط (A-Z)');
      return;
    }
    if (!password) {
      setFormError('يرجى إدخال كلمة المرور');
      return;
    }

    setFormError(null);
    setCreating(true);
    try {
      const created = await createTeamMember({
        username,
        password,
        display_name: displayName || undefined,
        phone: phone || undefined,
      });
      setMembers((prev) => [created, ...prev]);
      resetForm();
      Alert.alert('تمت الإضافة', 'تمت إضافة عضو الفريق بنجاح.');
    } catch (err) {
      setFormError(extractErrorMessage(err, 'تعذر إضافة العضو'));
    } finally {
      setCreating(false);
    }
  }, [form.displayName, form.password, form.phone, form.username, resetForm]);

  const startEdit = useCallback((member: TeamMember) => {
    setEditingId(member.id);
    setEditDraft({
      displayName: member.display_name || '',
      phone: member.phone || '',
      password: '',
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft({ displayName: '', phone: '', password: '' });
    setUpdatingId(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (editingId == null) {
      return;
    }
    const patch: { display_name?: string; phone?: string; password?: string } = {
      display_name: editDraft.displayName.trim(),
      phone: editDraft.phone.trim(),
    };
    const pwd = editDraft.password.trim();
    if (pwd) {
      patch.password = pwd;
    }

    setUpdatingId(editingId);
    try {
      const updated = await updateTeamMember(editingId, patch);
      setMembers((prev) => prev.map((member) => (member.id === editingId ? updated : member)));
      cancelEdit();
      Alert.alert('تم الحفظ', 'تم تحديث بيانات العضو بنجاح.');
    } catch (err) {
      Alert.alert('تعذر الحفظ', extractErrorMessage(err, 'تعذر تحديث بيانات العضو'));
    } finally {
      setUpdatingId(null);
    }
  }, [cancelEdit, editDraft.displayName, editDraft.password, editDraft.phone, editingId]);

  const handleDelete = useCallback(async (id: number) => {
    Alert.alert('تأكيد الحذف', 'هل أنت متأكد من حذف هذا العضو؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id);
          try {
            await deleteTeamMember(id);
            setMembers((prev) => prev.filter((member) => member.id !== id));
            Alert.alert('تم الحذف', 'تم حذف العضو من الفريق.');
          } catch (err) {
            Alert.alert('تعذر الحذف', extractErrorMessage(err, 'تعذر حذف العضو'));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }, []);

  const renderContent = () => {
    if (authRequired) {
      return (
        <View style={[styles.messageCard, { borderColor: palette.cardBorder, backgroundColor: palette.panelBg }]}
        >
          <Text style={[styles.messageTitle, { color: palette.title }]}>الرجاء تسجيل الدخول أولاً</Text>
          <Text style={[styles.messageText, { color: palette.subText }]}>هذه الصفحة متاحة للمستخدمين المصرّح لهم فقط.</Text>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={palette.headerIcon} />
          <Text style={[styles.loadingText, { color: palette.infoText }]}>جارٍ تحميل بيانات الفريق…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.loadingState}>
          <Text style={[styles.errorText, { color: palette.errorText }]}>{error}</Text>
        </View>
      );
    }

    return (
      <View style={styles.sectionStack}>
        <View style={[styles.formCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
        >
          <Text style={[styles.cardTitle, { color: palette.title }]}>إضافة عضو جديد</Text>
          <View style={styles.formGrid}>
            <View style={styles.formField}>
              <Text style={[styles.label, { color: palette.subText }]}>اسم المستخدم</Text>
              <TextInput
                value={form.username}
                onChangeText={(value) => setForm((prev) => ({ ...prev, username: value }))}
                style={[styles.input, {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.inputText,
                }]}
                placeholder="أدخل اسم المستخدم"
                placeholderTextColor={palette.inputPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.formField}>
              <Text style={[styles.label, { color: palette.subText }]}>الاسم الظاهر</Text>
              <TextInput
                value={form.displayName}
                onChangeText={(value) => setForm((prev) => ({ ...prev, displayName: value }))}
                style={[styles.input, {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.inputText,
                }]}
                placeholder="الاسم الظاهر"
                placeholderTextColor={palette.inputPlaceholder}
              />
            </View>
            <View style={styles.formField}>
              <Text style={[styles.label, { color: palette.subText }]}>رقم الهاتف</Text>
              <TextInput
                value={form.phone}
                onChangeText={(value) => setForm((prev) => ({ ...prev, phone: value }))}
                style={[styles.input, {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.inputText,
                }]}
                placeholder="رقم الهاتف"
                placeholderTextColor={palette.inputPlaceholder}
                keyboardType="phone-pad"
              />
            </View>
            <View style={styles.formField}>
              <Text style={[styles.label, { color: palette.subText }]}>كلمة المرور</Text>
              <TextInput
                value={form.password}
                onChangeText={(value) => setForm((prev) => ({ ...prev, password: value }))}
                style={[styles.input, {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.inputText,
                }]}
                placeholder="كلمة المرور"
                placeholderTextColor={palette.inputPlaceholder}
                secureTextEntry
              />
            </View>
          </View>
          {formError ? <Text style={[styles.formError, { color: palette.errorText }]}>{formError}</Text> : null}
          <View style={[styles.formActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            <View style={{ flex: 1 }} />
            <View style={styles.buttonWrapper}>
              <Text style={[styles.helperText, { color: palette.subText }]}>اسم المستخدم بأحرف لاتينية فقط</Text>
              <Text style={[styles.helperText, { color: palette.subText }]}>سنحفظ كلمة المرور كما هي</Text>
            </View>
            <View style={{ width: 140 }}>
              <View style={styles.actionButtonContainer}>
                <Pressable
                  style={[styles.actionButton, {
                    backgroundColor: creating ? palette.buttonDisabledBg : palette.buttonPrimaryBg,
                    opacity: creating ? 0.8 : 1,
                  }]}
                  onPress={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={palette.buttonDisabledText} />
                  ) : (
                    <Text style={[styles.actionButtonText, { color: palette.buttonPrimaryText }]}>أضف عضو</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.listCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
        >
          <Text style={[styles.cardTitle, { color: palette.title }]}>أعضاء الفريق</Text>
          {members.length === 0 ? (
            <Text style={[styles.emptyText, { color: palette.infoText }]}>لا يوجد أعضاء بعد</Text>
          ) : (
            members.map((member) => {
              const isEditing = editingId === member.id;
              const isUpdating = updatingId === member.id;
              const isDeleting = deletingId === member.id;
              return (
                <View key={member.id} style={[styles.memberCard, { borderColor: palette.divider, backgroundColor: palette.panelBg }]}
                >
                  <View style={[styles.memberRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <Text style={[styles.memberLabel, { color: palette.subText }]}>المستخدم</Text>
                    <Text style={[styles.memberValue, { color: palette.title }]}>{member.username}</Text>
                  </View>
                  <View style={[styles.memberRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <Text style={[styles.memberLabel, { color: palette.subText }]}>الاسم الظاهر</Text>
                    <TextInput
                      value={isEditing ? editDraft.displayName : member.display_name || ''}
                      onChangeText={(value) => setEditDraft((draft) => ({ ...draft, displayName: value }))}
                      editable={isEditing}
                      style={[styles.memberInput, {
                        backgroundColor: palette.inputBg,
                        borderColor: palette.inputBorder,
                        color: palette.inputText,
                        opacity: isEditing ? 1 : 0.6,
                        textAlign: isRTL ? 'left' : 'right',
                      }]}
                      placeholder="الاسم الظاهر"
                      placeholderTextColor={palette.inputPlaceholder}
                    />
                  </View>
                  <View style={[styles.memberRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <Text style={[styles.memberLabel, { color: palette.subText }]}>رقم الهاتف</Text>
                    <TextInput
                      value={isEditing ? editDraft.phone : member.phone || ''}
                      onChangeText={(value) => setEditDraft((draft) => ({ ...draft, phone: value }))}
                      editable={isEditing}
                      keyboardType="phone-pad"
                      style={[styles.memberInput, {
                        backgroundColor: palette.inputBg,
                        borderColor: palette.inputBorder,
                        color: palette.inputText,
                        opacity: isEditing ? 1 : 0.6,
                        textAlign: isRTL ? 'left' : 'right',
                      }]}
                      placeholder="رقم الهاتف"
                      placeholderTextColor={palette.inputPlaceholder}
                    />
                  </View>

                  {isEditing && (
                    <View style={[styles.memberRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                    >
                      <Text style={[styles.memberLabel, { color: palette.subText }]}>كلمة المرور الجديدة</Text>
                      <TextInput
                        value={editDraft.password}
                        onChangeText={(value) => setEditDraft((draft) => ({ ...draft, password: value }))}
                        style={[styles.memberInput, {
                          backgroundColor: palette.inputBg,
                          borderColor: palette.inputBorder,
                          color: palette.inputText,
                          textAlign: isRTL ? 'left' : 'right',
                        }]}
                        placeholder="اترك الحقل فارغاً للإبقاء على كلمة المرور الحالية"
                        placeholderTextColor={palette.inputPlaceholder}
                        secureTextEntry
                      />
                    </View>
                  )}

                  <View style={[styles.memberActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    {isEditing ? (
                      <>
                        <Pressable
                          style={[styles.actionChip, { backgroundColor: palette.buttonPrimaryBg }]}
                          onPress={handleSaveEdit}
                          disabled={isUpdating}
                        >
                          {isUpdating ? (
                            <ActivityIndicator size="small" color={palette.buttonPrimaryText} />
                          ) : (
                            <Text style={[styles.actionChipText, { color: palette.buttonPrimaryText }]}>حفظ</Text>
                          )}
                        </Pressable>
                        <Pressable
                          style={[styles.actionChip, { backgroundColor: '#64748b' }]}
                          onPress={cancelEdit}
                          disabled={isUpdating}
                        >
                          <Text style={[styles.actionChipText, { color: '#f8fafc' }]}>إلغاء</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.actionChip, { backgroundColor: palette.buttonDangerBg }]}
                          onPress={() => handleDelete(member.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <ActivityIndicator size="small" color={palette.buttonDangerText} />
                          ) : (
                            <Text style={[styles.actionChipText, { color: palette.buttonDangerText }]}>حذف</Text>
                          )}
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Pressable
                          style={[styles.actionChip, { backgroundColor: palette.buttonSecondaryBg }]}
                          onPress={() => startEdit(member)}
                        >
                          <Text style={[styles.actionChipText, { color: palette.buttonSecondaryText }]}>تعديل</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.actionChip, { backgroundColor: palette.buttonDangerBg }]}
                          onPress={() => handleDelete(member.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <ActivityIndicator size="small" color={palette.buttonDangerText} />
                          ) : (
                            <Text style={[styles.actionChipText, { color: palette.buttonDangerText }]}>حذف</Text>
                          )}
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>
    );
  };

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View
            style={[styles.header, {
              backgroundColor: palette.panelBg,
              borderColor: palette.panelBorder,
              flexDirection: isRTL ? 'row-reverse' : 'row',
            }]}
          >
            <View style={[styles.headerContent, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="رجوع"
                style={styles.headerButton}
                onPress={() => navigation.goBack()}
              >
                <FeatherIcon name={isRTL ? 'chevron-left' : 'chevron-right'} size={22} color={palette.headerIcon} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: palette.headerText }]}>إنشاء فريق عمل</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}>
              {renderContent()}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  header: {
    margin: 16,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerContent: {
    alignItems: 'center',
  },
  headerButton: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
  },
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  messageCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  messageTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  messageText: {
    fontSize: 13,
    textAlign: 'center',
  },
  sectionStack: {
    gap: 16,
  },
  formCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  listCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  formGrid: {
    gap: 12,
  },
  formField: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  formError: {
    fontSize: 12,
    fontWeight: '600',
  },
  formActions: {
    alignItems: 'center',
    gap: 12,
  },
  helperText: {
    fontSize: 11,
  },
  buttonWrapper: {
    gap: 4,
    alignItems: 'flex-end',
  },
  actionButtonContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  memberCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  memberRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  memberLabel: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
  },
  memberValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  memberInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: 'right',
  },
  memberActions: {
    gap: 10,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  actionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 80,
    alignItems: 'center',
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
