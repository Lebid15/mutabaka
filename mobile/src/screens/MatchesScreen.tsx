import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  I18nManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import BackgroundGradient from '../components/BackgroundGradient';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { getAccessToken } from '../lib/authStorage';
import { HttpError } from '../lib/httpClient';
import { fetchConversations, fetchNetBalance, type ConversationDto } from '../services/conversations';
import { fetchCurrentUser } from '../services/user';

type MatchRow = {
  id: number;
  name: string;
  avatar?: string;
  usd: number;
  tryy: number;
  syp: number;
  eur: number;
};

interface Totals {
  usd: number;
  tryy: number;
  syp: number;
  eur: number;
}

type MatchesNavigation = NativeStackNavigationProp<RootStackParamList>;

type LoadMode = 'initial' | 'refresh';

function isAdminLike(value?: string | null): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'admin' || normalized === 'madmin' || normalized === 'a_admin' || normalized === 'l_admin';
}

function buildAvatarFallback(name: string): string {
  const fallbackName = name?.trim() || 'U';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=0D8ABC&color=fff`;
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const compact = abs.toFixed(5).replace(/0+$/u, '').replace(/\.$/u, '');
  if (!compact.includes('.')) {
    return `${sign}${compact}.00`;
  }
  const [int, frac] = compact.split('.');
  if (!frac) {
    return `${sign}${int}.00`;
  }
  if (frac.length === 1) {
    return `${sign}${int}.${frac}0`;
  }
  return `${sign}${int}.${frac}`;
}

function decodeJwtPayload(token?: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    if (typeof globalThis.atob !== 'function') {
      return null;
    }
    const decoded = globalThis.atob(padded);
    if (!decoded) {
      return null;
    }
    return JSON.parse(decoded);
  } catch (error) {
    console.warn('[Mutabaka] Failed to decode JWT payload', error);
    return null;
  }
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (typeof error.payload === 'string') {
      return error.payload;
    }
    if (error.payload && typeof error.payload === 'object') {
      const payload = error.payload as Record<string, unknown>;
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      const firstEntry = Object.values(payload)[0];
      if (Array.isArray(firstEntry) && typeof firstEntry[0] === 'string') {
        return firstEntry[0];
      }
    }
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function normalizeNetValue(value: unknown, amUserA: boolean): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const adjusted = amUserA ? parsed : -parsed;
  const rounded = Number(adjusted.toFixed(5));
  if (!Number.isFinite(rounded)) {
    return 0;
  }
  return Math.abs(rounded) < 0.00001 ? 0 : rounded;
}

function addAndRound(a: number, b: number): number {
  const sum = a + b;
  const rounded = Number(sum.toFixed(5));
  return Math.abs(rounded) < 0.00001 ? 0 : rounded;
}

export default function MatchesScreen() {
  const navigation = useNavigation<MatchesNavigation>();
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;

  const isMountedRef = useRef(true);
  const loadingRef = useRef(false);

  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const payload = decodeJwtPayload(token);
        if (!active) {
          return;
        }
        if (payload && typeof payload.actor === 'string' && payload.actor === 'team_member') {
          setBlocked(true);
          setLoading(false);
        }
      } catch (tokenError) {
        console.warn('[Mutabaka] Failed to inspect token payload', tokenError);
      } finally {
        if (active) {
          setTokenChecked(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const palette = useMemo(() => ({
  panelBg: isLight ? 'rgba(255,255,255,0.94)' : '#0f1b22',
  panelBorder: isLight ? '#f2cdaa' : '#233138',
  headerIcon: isLight ? '#f97316' : '#facc15',
  headerText: isLight ? '#1f2937' : '#e2e8f0',
  exportBg: isLight ? '#fff7ed' : '#13222b',
  exportBorder: isLight ? '#f97316' : '#1f2d35',
  exportText: isLight ? '#ea580c' : '#facc15',
  exportDisabledText: isLight ? '#ea580c' : '#facc15',
    divider: isLight ? '#f2d5b6' : '#1f2d35',
    rowBorder: isLight ? '#f5e5d7' : '#1c2a32',
    avatarBorder: isLight ? '#f3d6b8' : '#24343d',
    cardBg: isLight ? '#fff3e4' : '#10242f',
    cardBorder: isLight ? '#f2cdaa' : '#1f2d35',
    cardLabel: isLight ? '#7f6857' : '#94a3b8',
    success: isLight ? '#16a34a' : '#34d399',
    danger: isLight ? '#ef4444' : '#fca5a5',
    textPrimary: isLight ? '#1f2937' : '#e2e8f0',
    mutedText: isLight ? '#6b7280' : '#94a3b8',
    tableHeaderBg: isLight ? '#fff7ed' : '#13222b',
    tableHeaderText: isLight ? '#6b7280' : '#cbd5f5',
  }), [isLight]);

  const totals = useMemo<Totals>(() => rows.reduce<Totals>((acc, row) => ({
    usd: addAndRound(acc.usd, row.usd),
    tryy: addAndRound(acc.tryy, row.tryy),
    syp: addAndRound(acc.syp, row.syp),
    eur: addAndRound(acc.eur, row.eur),
  }), { usd: 0, tryy: 0, syp: 0, eur: 0 }), [rows]);

  const loadMatches = useCallback(async (mode: LoadMode = 'initial') => {
    if (blocked || loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    if (mode === 'refresh') {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [me, firstPage] = await Promise.all([
        fetchCurrentUser(),
        fetchConversations({ page: 1 }),
      ]);

      if (!isMountedRef.current) {
        return;
      }

      const allConversations: ConversationDto[] = [...(firstPage?.results ?? [])];
      let currentPage = 1;
      let hasNext = Boolean(firstPage?.next);

      while (hasNext) {
        currentPage += 1;
        const pageData = await fetchConversations({ page: currentPage });
        if (!isMountedRef.current) {
          return;
        }
        if (pageData.results?.length) {
          allConversations.push(...pageData.results);
        }
        if (!pageData.next || !pageData.results?.length) {
          hasNext = false;
        }
      }

      const computedRows: MatchRow[] = [];

      for (const conversation of allConversations) {
        if (!isMountedRef.current) {
          return;
        }

        const amUserA = me.id === conversation.user_a?.id;
        const other = amUserA ? conversation.user_b : conversation.user_a;

        if (!other) {
          continue;
        }
        if (isAdminLike(other.username) || isAdminLike(other.display_name)) {
          continue;
        }

        const name = other.display_name || other.username || other.email || 'مستخدم';
        const avatar = other.logo_url || buildAvatarFallback(name);

        try {
          const net = await fetchNetBalance(conversation.id);
          if (!net || !Array.isArray(net.net) || net.net.length === 0) {
            continue;
          }

          let hasValue = false;
          let usd = 0;
          let tryy = 0;
          let syp = 0;
          let eur = 0;

          for (const entry of net.net) {
            const code = entry?.currency?.code;
            const delta = normalizeNetValue(entry?.net_from_user_a_perspective, amUserA);
            if (!delta) {
              continue;
            }
            switch (code) {
              case 'USD':
                usd = addAndRound(usd, delta);
                hasValue = true;
                break;
              case 'TRY':
                tryy = addAndRound(tryy, delta);
                hasValue = true;
                break;
              case 'SYP':
                syp = addAndRound(syp, delta);
                hasValue = true;
                break;
              case 'EUR':
                eur = addAndRound(eur, delta);
                hasValue = true;
                break;
              default:
                break;
            }
          }

          if (!hasValue) {
            continue;
          }

          computedRows.push({
            id: conversation.id,
            name,
            avatar,
            usd,
            tryy,
            syp,
            eur,
          });
        } catch (netError) {
          console.warn('[Mutabaka] Failed to load net balance', conversation.id, netError);
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      setRows(computedRows);
    } catch (loadError) {
      if (!isMountedRef.current) {
        return;
      }
      setError(extractErrorMessage(loadError, 'فشل تحميل البيانات'));
      setRows([]);
    } finally {
      if (isMountedRef.current) {
        if (mode === 'refresh') {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
      loadingRef.current = false;
    }
  }, [blocked]);

  useFocusEffect(
    useCallback(() => {
      if (!tokenChecked || blocked) {
        return;
      }
      loadMatches('initial');
      return undefined;
    }, [blocked, loadMatches, tokenChecked]),
  );

  const handleRefresh = useCallback(() => {
    if (blocked || loadingRef.current) {
      return;
    }
    loadMatches('refresh');
  }, [blocked, loadMatches]);

  const handleExport = useCallback(async () => {
    if (!rows.length) {
      Alert.alert('لا توجد بيانات', 'لا توجد مطابقات لتصديرها');
      return;
    }
    try {
      console.log('[Mutabaka] Starting export with', rows.length, 'rows');
      
      // استخدام ExcelJS للتنسيق المتقدم
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('مطابقاتي', {
        views: [{ rightToLeft: true }]
      });

      // العنوان الرئيسي
      worksheet.mergeCells('A1:E1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'مطابقاتي - ملخص الحسابات';
      titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
      };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      // سطر فارغ
      worksheet.addRow([]);

      // عنوان ملخص الإجمالي
      worksheet.mergeCells('A3:E3');
      const summaryTitleCell = worksheet.getCell('A3');
      summaryTitleCell.value = 'ملخص الإجمالي';
      summaryTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      summaryTitleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF059669' }
      };
      summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(3).height = 25;

      // رؤوس ملخص الإجمالي
      const summaryHeaderRow = worksheet.addRow(['العملة', 'الإجمالي']);
      summaryHeaderRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      summaryHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF10B981' }
      };
      summaryHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      summaryHeaderRow.height = 25;
      summaryHeaderRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
      });

      // بيانات ملخص الإجمالي
      const summaryData = [
        ['دولار', totals.usd.toFixed(2)],
        ['تركي', totals.tryy.toFixed(2)],
        ['سوري', totals.syp.toFixed(2)],
        ['يورو', totals.eur.toFixed(2)]
      ];

      summaryData.forEach((rowData, index) => {
        const row = worksheet.addRow(rowData);
        const isEven = index % 2 === 0;
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFD1FAE5' : 'FFECFDF5' }
        };
        row.alignment = { vertical: 'middle', horizontal: 'center' };
        row.height = 22;
        
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
          
          if (colNumber === 2) {
            const numValue = parseFloat(String(cell.value));
            cell.font = {
              bold: true,
              color: { argb: numValue >= 0 ? 'FF047857' : 'FFDC2626' }
            };
            cell.numFmt = '0.00';
          }
        });
      });

      // سطر فارغ
      worksheet.addRow([]);

      // عنوان تفاصيل المطابقات
      const currentRow = (worksheet.lastRow?.number ?? 0) + 1;
      worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
      const detailsTitleCell = worksheet.getCell(`A${currentRow}`);
      detailsTitleCell.value = 'تفاصيل المطابقات';
      detailsTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      detailsTitleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF7C3AED' }
      };
      detailsTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(currentRow).height = 25;

      // رؤوس الجدول الرئيسي
      const detailsHeaderRow = worksheet.addRow(['الجهة', 'دولار', 'تركي', 'سوري', 'يورو']);
      detailsHeaderRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      detailsHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
      };
      detailsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      detailsHeaderRow.height = 25;
      detailsHeaderRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
      });

      // بيانات الجدول الرئيسي
      rows.forEach((row, index) => {
        const rowData = [
          row.name,
          row.usd.toFixed(2),
          row.tryy.toFixed(2),
          row.syp.toFixed(2),
          row.eur.toFixed(2)
        ];
        
        const excelRow = worksheet.addRow(rowData);
        const isEven = index % 2 === 0;
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFEFF6FF' : 'FFFFFFFF' }
        };
        excelRow.alignment = { vertical: 'middle', horizontal: 'center' };
        excelRow.height = 22;
        
        excelRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
          
          if (colNumber >= 2 && colNumber <= 5) {
            const numValue = parseFloat(String(cell.value));
            cell.font = {
              bold: true,
              color: { argb: numValue >= 0 ? 'FF047857' : 'FFDC2626' }
            };
            cell.numFmt = '0.00';
          }
          
          if (colNumber === 1) {
            cell.font = { bold: true, color: { argb: 'FF1F2937' } };
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          }
        });
      });

      // تحديد عروض الأعمدة
      worksheet.columns = [
        { width: 25 }, // الجهة
        { width: 15 }, // دولار
        { width: 15 }, // تركي
        { width: 15 }, // سوري
        { width: 15 }  // يورو
      ];

      console.log('[Mutabaka] Writing workbook to buffer');
      const buffer = await workbook.xlsx.writeBuffer();
      
      const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!directory) {
        throw new Error('تعذر تحديد موقع الحفظ');
      }
      
      const filename = `matches-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const targetUri = `${directory}${filename}`;
      
      console.log('[Mutabaka] Converting buffer to base64');
      const { Buffer } = await import('buffer');
      const base64 = Buffer.from(buffer).toString('base64');
      
      console.log('[Mutabaka] Writing file to', targetUri);
      await FileSystem.writeAsStringAsync(targetUri, base64, { 
        encoding: FileSystem.EncodingType.Base64 
      });

      console.log('[Mutabaka] File written successfully, attempting to share');
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(targetUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'مشاركة ملف المطابقات',
          UTI: 'com.microsoft.excel.xlsx',
        });
        console.log('[Mutabaka] File shared successfully');
      } else {
        console.warn('[Mutabaka] Sharing not available, showing alert');
        Alert.alert('تم الحفظ', `تم حفظ الملف في:\n${targetUri}`);
      }
    } catch (exportError) {
      console.error('[Mutabaka] Failed to export matches', exportError);
      Alert.alert('تعذر التصدير', `حدث خطأ أثناء إنشاء الملف:\n${exportError instanceof Error ? exportError.message : String(exportError)}`);
    }
  }, [rows, totals]);

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View
            style={[
              styles.header,
              {
                backgroundColor: palette.panelBg,
                borderColor: palette.panelBorder,
                flexDirection: isRTL ? 'row-reverse' : 'row',
              },
            ]}
            accessibilityRole="header"
          >
            <View style={[styles.headerTitleGroup, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Pressable
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="رجوع"
                onPress={() => navigation.goBack()}
              >
                <FeatherIcon name="chevron-right" size={22} color={palette.headerIcon} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: palette.headerText }]}>مطابقاتي</Text>
            </View>
            <Pressable
              style={[styles.exportButton, {
                backgroundColor: palette.exportBg,
                borderColor: palette.exportBorder,
              }]}
              accessibilityRole="button"
              accessibilityLabel="تصدير إلى ملف"
              onPress={handleExport}
              disabled={!rows.length}
            >
              <FeatherIcon name="download" size={16} color={rows.length ? palette.exportText : palette.exportDisabledText} />
              <Text style={[styles.exportText, { color: rows.length ? palette.exportText : palette.exportDisabledText }]}>تصدير</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={palette.headerIcon}
              />
            )}
          >
            {blocked ? (
              <View style={[styles.blockedPanel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <Text style={[styles.blockedTitle, { color: palette.headerText }]}>هذه الصفحة متاحة فقط للمالك</Text>
                <Text style={[styles.blockedSubtitle, { color: palette.mutedText }]}
                  numberOfLines={2}
                >
                  الرجاء العودة للصفحة الرئيسية.
                </Text>
              </View>
            ) : null}

            {!blocked && loading ? (
              <View style={[styles.loadingPanel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <ActivityIndicator size="small" color={palette.headerIcon} />
                <Text style={[styles.loadingText, { color: palette.mutedText }]}>جاري التحميل…</Text>
              </View>
            ) : null}

            {!blocked && !loading && error ? (
              <View style={[styles.errorPanel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <FeatherIcon name="alert-triangle" size={18} color={palette.danger} />
                <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
              </View>
            ) : null}

            {!blocked && !loading && !error ? (
              <View style={[styles.contentPanel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <View style={styles.cardsGrid}>
                  {([
                    { label: 'دولار', value: totals.usd, suffix: '$' },
                    { label: 'تركي', value: totals.tryy, suffix: '₺' },
                    { label: 'سوري', value: totals.syp, suffix: 'SYP' },
                    { label: 'يورو', value: totals.eur, suffix: '€' },
                  ] as const).map((card) => (
                    <View
                      key={card.label}
                      style={[styles.totalCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                    >
                      <Text style={[styles.cardLabel, { color: palette.cardLabel }]}>{card.label}</Text>
                      <Text
                        style={[styles.cardValue, {
                          color: card.value >= 0 ? palette.success : palette.danger,
                        }]}
                        accessibilityLabel={`${card.label}: ${formatAmount(card.value)} ${card.suffix}`}
                      >
                        <Text style={styles.ltr}>{formatAmount(card.value)}</Text>
                        {' '}
                        {card.suffix}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.tableWrapper, { borderColor: palette.rowBorder }]}
                >
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
                    <View style={styles.tableContainer}>
                      <View style={[styles.tableHeader, { backgroundColor: palette.tableHeaderBg, borderColor: palette.rowBorder }]}
                      >
                        <View style={[styles.tableHeaderCell, styles.firstColumn]}>
                          <Text style={[styles.tableHeaderText, { color: palette.tableHeaderText }]}>الجهة</Text>
                        </View>
                        <View style={styles.tableHeaderCell}>
                          <Text style={[styles.tableHeaderText, { color: palette.tableHeaderText }]}>دولار</Text>
                        </View>
                        <View style={styles.tableHeaderCell}>
                          <Text style={[styles.tableHeaderText, { color: palette.tableHeaderText }]}>تركي</Text>
                        </View>
                        <View style={styles.tableHeaderCell}>
                          <Text style={[styles.tableHeaderText, { color: palette.tableHeaderText }]}>سوري</Text>
                        </View>
                        <View style={styles.tableHeaderCell}>
                          <Text style={[styles.tableHeaderText, { color: palette.tableHeaderText }]}>يورو</Text>
                        </View>
                      </View>

                      <ScrollView 
                        style={styles.tableBodyScroll}
                        showsVerticalScrollIndicator={true}
                        nestedScrollEnabled={true}
                      >
                        {rows.map((row) => (
                          <View
                            key={row.id}
                            style={[styles.tableRow, { borderColor: palette.rowBorder }]}
                          >
                            <View style={[styles.tableCell, styles.firstColumn]}
                            >
                              {row.avatar ? (
                                <Image source={{ uri: row.avatar }} style={[styles.avatar, { borderColor: palette.avatarBorder }]} />
                              ) : (
                                <View style={[styles.avatarFallback, { borderColor: palette.avatarBorder }]}
                                >
                                  <Text style={[styles.avatarFallbackText, { color: palette.textPrimary }]}>{row.name.slice(0, 2).toUpperCase()}</Text>
                                </View>
                              )}
                              <Text style={[styles.rowName, { color: palette.textPrimary }]} numberOfLines={1}>{row.name}</Text>
                            </View>
                            <View style={styles.tableCell}
                            >
                              <Text style={[styles.amountText, styles.ltr, { color: row.usd >= 0 ? palette.success : palette.danger }]}>
                                {formatAmount(row.usd)} $
                              </Text>
                            </View>
                            <View style={styles.tableCell}
                            >
                              <Text style={[styles.amountText, styles.ltr, { color: row.tryy >= 0 ? palette.success : palette.danger }]}>
                                {formatAmount(row.tryy)} ₺
                              </Text>
                            </View>
                            <View style={styles.tableCell}
                            >
                              <Text style={[styles.amountText, styles.ltr, { color: row.syp >= 0 ? palette.success : palette.danger }]}>
                                {formatAmount(row.syp)} SYP
                              </Text>
                            </View>
                            <View style={styles.tableCell}
                            >
                              <Text style={[styles.amountText, styles.ltr, { color: row.eur >= 0 ? palette.success : palette.danger }]}>
                                {formatAmount(row.eur)} €
                              </Text>
                            </View>
                          </View>
                        ))}

                        {rows.length === 0 ? (
                          <View style={[styles.emptyState, { borderColor: palette.rowBorder }]}
                          >
                            <Text style={[styles.emptyText, { color: palette.mutedText }]}>لا توجد بيانات مطابقة بعد</Text>
                          </View>
                        ) : null}
                      </ScrollView>
                    </View>
                  </ScrollView>
                </View>
              </View>
            ) : null}
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
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exportText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 16,
  },
  blockedPanel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  blockedTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  blockedSubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  loadingPanel: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  errorPanel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
  },
  contentPanel: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 18,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  totalCard: {
    flexBasis: '48%',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 6,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  cardValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  tableWrapper: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableContainer: {
    minWidth: '100%',
  },
  tableBodyScroll: {
    maxHeight: 300,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHeaderCell: {
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  firstColumn: {
    minWidth: 140,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tableCell: {
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rowName: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  amountText: {
    fontSize: 13,
    fontWeight: '600',
  },
  ltr: {
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  emptyState: {
    paddingVertical: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
});
