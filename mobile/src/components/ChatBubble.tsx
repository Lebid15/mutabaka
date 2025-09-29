import FeatherIcon from '@expo/vector-icons/Feather';
import * as FileSystem from 'expo-file-system/legacy';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { cn } from '../utils/cn';
import { useThemeMode } from '../theme';
import { getAccessToken } from '../lib/authStorage';

interface TransactionPayload {
  direction: 'lna' | 'lkm';
  amount: number;
  symbol?: string;
  currency?: string;
  note?: string;
}

interface AttachmentData {
  url: string | null;
  name?: string | null;
  mime?: string | null;
  size?: number | null;
}

const DEFAULT_ATTACHMENT_LABEL = '📎 مرفق';

interface ChatBubbleProps {
  text: string;
  caption?: string | null;
  time: string;
  date?: string;
  isMine?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  variant?: 'text' | 'transaction' | 'system' | 'attachment';
  transaction?: TransactionPayload;
  attachment?: AttachmentData | null;
  highlightQuery?: string;
  highlightActive?: boolean;
}

function ChatBubbleBase({ text, caption, time, date, isMine, status, variant = 'text', transaction, attachment, highlightQuery, highlightActive }: ChatBubbleProps) {
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isTransaction = variant === 'transaction' && transaction;
  const isSystem = variant === 'system';
  const isAttachment = variant === 'attachment' && Boolean(attachment);
  const attachmentData = isAttachment ? attachment ?? null : null;
  const [attachmentCardWidth, setAttachmentCardWidth] = useState<number | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const authorizedDownloadRef = useRef<{ attempted: boolean; inFlight: boolean }>({ attempted: false, inFlight: false });

  const resolvedAttachmentUrl = useMemo(() => (
    attachmentData?.url ? normalizeAttachmentUrl(attachmentData.url) : null
  ), [attachmentData?.url]);

  useEffect(() => {
    setImageFailed(false);
    setImageAspectRatio(null);
    setPreviewUri(null);
    authorizedDownloadRef.current = { attempted: false, inFlight: false };
  }, [resolvedAttachmentUrl]);

  const isImageCandidate = isAttachment && Boolean(attachmentData) && isImageAttachment(attachmentData);

  const workingImageUri = previewUri || resolvedAttachmentUrl;

  useEffect(() => {
    if (!isImageCandidate || !workingImageUri) {
      setImageAspectRatio(null);
      return;
    }
    let cancelled = false;
    Image.getSize(
      workingImageUri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        if (width > 0 && height > 0) {
          setImageAspectRatio(width / height);
        } else {
          setImageAspectRatio(null);
        }
      },
      () => {
        if (!cancelled) {
          setImageAspectRatio(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    return () => {
      cancelled = true;
    };
  }, [isImageCandidate, workingImageUri]);

  const normalizedHighlightQuery = highlightQuery?.trim() ?? '';
  const shouldHighlight = Boolean(normalizedHighlightQuery);
  const isActiveHighlight = Boolean(highlightActive);

  const trimmedText = (text || '').trim();
  const normalizedCaption = caption?.trim() ?? '';
  const attachmentName = attachmentData?.name?.trim() ?? '';
  const attachmentHasUrl = Boolean(workingImageUri);
  const imagePreviewAvailable = isImageCandidate && attachmentHasUrl && !imageFailed;
  const showAttachmentCaption = isAttachment
    ? Boolean(normalizedCaption && normalizedCaption !== attachmentName && normalizedCaption !== DEFAULT_ATTACHMENT_LABEL)
    : false;
  const textContent = isAttachment ? normalizedCaption : text;
  const showTextBlock = isAttachment ? showAttachmentCaption : Boolean(trimmedText);

  const container = isSystem
    ? cn(
        'max-w-[85%] self-center rounded-2xl px-4 py-2 mb-3',
        isLight ? 'bg-[#fde4c3]' : 'bg-[#1f2937]',
      )
    : cn(
        'max-w-[80%] rounded-3xl px-4 py-3 mb-3 shadow-sm',
        isMine
          ? isLight
            ? 'self-end bg-bubbleSentLight'
            : 'self-end bg-bubbleSentDark'
          : isLight
            ? 'self-start bg-bubbleReceivedLight'
            : 'self-start bg-bubbleReceivedDark',
      );

  const transactionBackground = (() => {
    if (!isTransaction) {
      return undefined;
    }
    if (isMine) {
      return isLight ? '#ffe4c4' : '#0f3f37';
    }
    return isLight ? '#fff6e9' : '#1a2530';
  })();

  const transactionStyle = transactionBackground
    ? {
        backgroundColor: transactionBackground,
        borderWidth: isLight ? 1 : 0.8,
        borderColor: isLight ? 'rgba(234,179,8,0.35)' : 'rgba(148,163,184,0.45)',
      }
    : undefined;

  const highlightContainerStyle = !isSystem && shouldHighlight && isActiveHighlight
    ? {
        borderWidth: Math.max(((transactionStyle?.borderWidth as number | undefined) ?? 0), isLight ? 1.4 : 1.2),
        borderColor: isLight ? '#f97316' : '#facc15',
        shadowColor: isLight ? '#f97316' : '#fde68a',
        shadowOpacity: isLight ? 0.25 : 0.35,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }
    : undefined;

  const timeColor = isMine
    ? isLight ? '#7c4a21' : '#a7f3d0'
    : isLight ? '#8c6d52' : '#94a3b8';

  const showTicks = Boolean(status);
  const readColor = isLight ? '#38bdf8' : '#60a5fa';
  const unreadColor = isLight ? '#7f6538ff' : '#a8a59aff';

  const badgeBackground = transaction?.direction === 'lna'
    ? (isLight ? '#dcfce7' : 'rgba(34,197,94,0.25)')
    : (isLight ? '#fee2e2' : 'rgba(248,113,113,0.25)');

  const badgeTextColor = transaction?.direction === 'lna'
    ? (isLight ? '#166534' : '#bbf7d0')
    : (isLight ? '#b91c1c' : '#fecdd3');

  const noteColor = isLight ? '#7c4a21' : '#e2e8f0';
  const dateColor = isLight ? '#9a6a28' : '#fcd34d';
  const headingColor = isLight ? '#3c3127' : '#f8fafc';
  const amountColor = isLight ? '#1f2937' : '#f8fafc';
  const iconColor = isLight ? '#92400e' : '#fcd34d';

  const hasAttachmentSection = Boolean(attachmentData);
  const timeRowClass = cn('flex-row justify-end gap-1 items-center', (isTransaction || hasAttachmentSection) ? 'mt-2' : 'mt-1');

  const formattedAmount = transaction ? formatTransactionAmount(transaction.amount) : null;
  const directionLabel = transaction?.direction === 'lna' ? 'لنا' : 'لكم';
  const currencyLabel = transaction?.symbol || transaction?.currency || '';
  const amountDisplay = formattedAmount !== null ? `${formattedAmount} ${currencyLabel}`.trim() : '';
  const noteText = transaction?.note;
  const systemTextColor = isLight ? '#78350f' : '#f8fafc';
  const systemTimeColor = isLight ? '#9a6a28' : '#cbd5f5';

  const highlightNeedle = shouldHighlight ? normalizedHighlightQuery : '';
  const baseTextClass = cn('text-base leading-6', isLight ? 'text-textBrown' : 'text-textLight');
  const failureHintColor = isLight ? '#b91c1c' : '#fca5a5';

  const calculatedImageHeight = useMemo(() => {
    if (!imagePreviewAvailable) {
      return undefined;
    }
    if (attachmentCardWidth && imageAspectRatio && imageAspectRatio > 0.01) {
      const rawHeight = attachmentCardWidth / imageAspectRatio;
      return clamp(rawHeight, 140, 360);
    }
    return 220;
  }, [attachmentCardWidth, imageAspectRatio, imagePreviewAvailable]);

  const attachmentSection = attachmentData ? (() => {
    const fileName = attachmentName || 'ملف مرفق';
    const metaLabel = formatAttachmentMeta(attachmentData);
    const iconColorBase = isLight ? '#b45309' : '#fde68a';
    const iconBackground = isLight ? 'rgba(249, 115, 22, 0.12)' : 'rgba(253, 224, 71, 0.22)';
    const infoTextColor = isLight ? '#1f2937' : '#f8fafc';
    const metaColor = isLight ? '#9a3412' : '#e5e7eb';
    const hintColor = isLight ? '#b45309' : '#fde68a';
    const actionBorderColor = isLight ? 'rgba(248,113,113,0.2)' : 'rgba(148,163,184,0.3)';
    const actionTextColor = isLight ? '#b45309' : '#facc15';
    const iconName = isPdfAttachment(attachmentData) ? 'file-text' : 'paperclip';

    const handleOpen = () => {
      const url = resolvedAttachmentUrl || workingImageUri;
      if (!url) {
        Alert.alert('الرابط غير متاح بعد', 'انتظر اكتمال الرفع ثم حاول مجدداً.');
        return;
      }
      Linking.openURL(url).catch((error) => {
        console.warn('[Mutabaka] Failed to open attachment', error);
        Alert.alert('تعذر فتح الملف', 'تأكد من توفر تطبيق مناسب أو حاول لاحقاً.');
      });
    };

    return (
      <View style={[styles.attachmentCard, isLight ? styles.attachmentCardLight : styles.attachmentCardDark]}>
        {imagePreviewAvailable ? (
          <Pressable
            style={styles.attachmentImageWrapper}
            onPress={handleOpen}
            onLayout={({ nativeEvent }: LayoutChangeEvent) => {
              const width = nativeEvent.layout.width;
              if (width > 0 && width !== attachmentCardWidth) {
                setAttachmentCardWidth(width);
              }
            }}
          >
            <Image
              source={{ uri: workingImageUri as string }}
              style={[
                styles.attachmentImage,
                calculatedImageHeight ? { height: calculatedImageHeight } : { height: 220 },
              ]}
              resizeMode="contain"
              onError={() => {
                if (!resolvedAttachmentUrl) {
                  setImageFailed(true);
                  return;
                }
                if (!authorizedDownloadRef.current.attempted && shouldAttemptAuthorizedDownload(resolvedAttachmentUrl)) {
                  authorizedDownloadRef.current = { attempted: true, inFlight: true };
                  downloadAttachmentToCache(resolvedAttachmentUrl, attachmentName)
                    .then((localUri: string | null) => {
                      authorizedDownloadRef.current.inFlight = false;
                      if (localUri) {
                        setPreviewUri(localUri);
                        setImageFailed(false);
                      } else {
                        setImageFailed(true);
                      }
                    })
                    .catch(() => {
                      authorizedDownloadRef.current.inFlight = false;
                      setImageFailed(true);
                    });
                } else if (authorizedDownloadRef.current.inFlight) {
                  // wait for download to finish
                } else {
                  setImageFailed(true);
                }
              }}
            />
          </Pressable>
        ) : null}
        <View style={imagePreviewAvailable ? styles.attachmentBodyImage : styles.attachmentBodyFile}>
          {!imagePreviewAvailable ? (
            <View
              style={[
                styles.attachmentIconContainer,
                { backgroundColor: iconBackground, marginLeft: 12 },
              ]}
            >
              <FeatherIcon name={iconName} size={18} color={iconColorBase} />
            </View>
          ) : null}
          <View style={[styles.attachmentInfo, { flexShrink: 1 }]}>
            <Text style={[styles.attachmentName, { color: infoTextColor }]} numberOfLines={2} ellipsizeMode="tail">
              {renderHighlightedSegments(fileName, highlightNeedle, isLight, isActiveHighlight)}
            </Text>
            {metaLabel ? (
              <Text style={[styles.attachmentMeta, { color: metaColor }]} numberOfLines={1} ellipsizeMode="tail">
                {metaLabel}
              </Text>
            ) : null}
            {!attachmentHasUrl ? (
              <Text style={[styles.attachmentHint, { color: hintColor }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {isMine ? 'جاري رفع المرفق…' : 'سيتم تفعيل الرابط بعد قليل.'}
              </Text>
            ) : imageFailed ? (
              <Text style={[styles.attachmentHint, { color: failureHintColor }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                تعذر عرض الصورة داخل المحادثة، اضغط على فتح لمشاهدتها.
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.attachmentActions, { borderTopColor: actionBorderColor }]}>
          <Pressable
            style={[styles.attachmentActionButton, !attachmentHasUrl && styles.attachmentActionDisabled]}
            onPress={handleOpen}
            disabled={!attachmentHasUrl}
          >
            <Text style={[styles.attachmentActionText, { color: actionTextColor }]}>
              {attachmentHasUrl ? 'فتح' : 'بانتظار الرابط'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  })() : null;

  return (
    <View className={container} style={[transactionStyle, highlightContainerStyle]}>
      {isSystem ? (
        <>
          <Text
            style={{
              color: systemTextColor,
              fontSize: 13,
              fontWeight: '700',
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {renderHighlightedSegments(text, highlightNeedle, isLight, isActiveHighlight)}
          </Text>
          {time ? (
            <Text
              style={{
                color: systemTimeColor,
                fontSize: 11,
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {time}
            </Text>
          ) : null}
        </>
      ) : isTransaction ? (
        <>
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center gap-2">
              <View
                style={{
                  backgroundColor: isLight ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)',
                  borderRadius: 999,
                  padding: 6,
                }}
              >
                <FeatherIcon name="trending-up" size={16} color={iconColor} />
              </View>
              <Text style={{ color: headingColor, fontWeight: '700', fontSize: 15 }}>معاملة</Text>
            </View>
            <View
              style={{
                backgroundColor: badgeBackground,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: badgeTextColor, fontSize: 12, fontWeight: '700' }}>{directionLabel}</Text>
            </View>
          </View>
          <Text style={{ color: amountColor, fontSize: 18, fontWeight: '700' }}>
            {renderHighlightedSegments(amountDisplay, highlightNeedle, isLight, isActiveHighlight)}
          </Text>
          {noteText ? (
            <Text
              style={{
                color: noteColor,
                fontSize: 13,
                marginTop: 6,
                lineHeight: 18,
                textAlign: 'right',
              }}
            >
              {renderHighlightedSegments(noteText, highlightNeedle, isLight, isActiveHighlight)}
            </Text>
          ) : null}
          {date ? (
            <Text style={{ color: dateColor, fontSize: 11, marginTop: 8, textAlign: 'right' }}>{date}</Text>
          ) : null}
        </>
      ) : isAttachment ? (
        <>
          {attachmentSection}
          {showTextBlock ? (
            <Text className={baseTextClass} style={{ marginTop: 4 }}>
              {renderHighlightedSegments(textContent, highlightNeedle, isLight, isActiveHighlight)}
            </Text>
          ) : null}
        </>
      ) : (
        <Text className={baseTextClass}>
          {renderHighlightedSegments(text, highlightNeedle, isLight, isActiveHighlight)}
        </Text>
      )}
      {isSystem ? null : (
        <View className={timeRowClass}>
          <Text className="text-[11px]" style={{ color: timeColor }}>
            {time}
          </Text>
          {showTicks ? <MessageTicks color={status === 'read' ? readColor : unreadColor} /> : null}
        </View>
      )}
    </View>
  );
}

const ChatBubble = memo(ChatBubbleBase);

export default ChatBubble;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedSegments(
  content: string,
  query: string,
  isLight: boolean,
  isActive: boolean,
): ReactNode[] {
  if (!content) {
    return [''];
  }
  if (!query) {
    return [content];
  }
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = content.split(regex);
  const activeColor = isLight ? 'rgba(249, 115, 22, 0.55)' : 'rgba(253, 224, 71, 0.65)';
  const defaultColor = isLight ? 'rgba(253, 224, 71, 0.35)' : 'rgba(253, 224, 71, 0.25)';
  const highlightColor = isActive ? activeColor : defaultColor;
  return parts.map((part, index) => {
    if (!part) {
      return '';
    }
    const isMatch = index % 2 === 1;
    if (!isMatch) {
      return part;
    }
    return (
      <Text
        key={`highlight-${index}-${part}-${part.length}`}
        style={{
          backgroundColor: highlightColor,
          borderRadius: 6,
          paddingHorizontal: 3,
        }}
      >
        {part}
      </Text>
    );
  });
}

function formatTransactionAmount(amount: number): string {
  const numeric = Number.isFinite(amount) ? Math.abs(amount) : 0;
  return numeric.toFixed(2);
}

function MessageTicks({ color }: { color: string }) {
  return (
    <Svg width={22} height={18} viewBox="0 0 32 24" fill="none">
      <Path
        d="M30 6L18 18l-5-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M23 6L11 18l-5-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function isImageAttachment(attachment?: AttachmentData | null): boolean {
  if (!attachment) {
    return false;
  }
  const mime = (attachment.mime || '').toLowerCase();
  const name = (attachment.name || '').toLowerCase();
  const url = (attachment.url || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return true;
  }
  if (url.startsWith('data:image/')) {
    return true;
  }
  if (name && /\.(png|jpe?g|gif|webp|bmp|heif|heic)$/i.test(name)) {
    return true;
  }
  return false;
}

function isPdfAttachment(attachment?: AttachmentData | null): boolean {
  if (!attachment) {
    return false;
  }
  const mime = (attachment.mime || '').toLowerCase();
  const name = (attachment.name || '').toLowerCase();
  if (mime.includes('pdf')) {
    return true;
  }
  if (name.endsWith('.pdf')) {
    return true;
  }
  return false;
}

function formatAttachmentMeta(attachment?: AttachmentData | null): string | null {
  if (!attachment) {
    return null;
  }
  const parts: string[] = [];
  const mime = (attachment.mime || '').toLowerCase();
  if (mime) {
    const [, subtype] = mime.split('/');
    if (subtype) {
      parts.push(subtype.toUpperCase());
    } else {
      parts.push(mime.toUpperCase());
    }
  } else {
    const ext = extractExtension(attachment.name);
    if (ext) {
      parts.push(ext.toUpperCase());
    }
  }
  if (typeof attachment.size === 'number' && attachment.size > 0) {
    const label = formatFileSize(attachment.size);
    if (label) {
      parts.push(label);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

function extractExtension(name?: string | null): string | null {
  if (!name) {
    return null;
  }
  const trimmed = name.trim().toLowerCase();
  const match = trimmed.match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : null;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  const units = ['ب', 'ك.ب', 'م.ب', 'ج.ب'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 10
    ? Math.round(value).toString()
    : value.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ${units[unitIndex]}`;
}

function shouldAttemptAuthorizedDownload(url: string): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith('file://') || lower.startsWith('content://') || lower.startsWith('data:')) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://');
}

async function downloadAttachmentToCache(url: string, fileNameHint?: string | null): Promise<string | null> {
  try {
    const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!directory) {
      return null;
    }
    const token = await getAccessToken().catch(() => null);
    const extension = inferExtensionForCache(fileNameHint ?? url) ?? 'tmp';
    const targetPath = `${directory}mutabaka-attach-${stableHash(url)}.${extension}`;
    try {
      const info = await FileSystem.getInfoAsync(targetPath);
      if (info.exists && !info.isDirectory) {
        return info.uri;
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to inspect cached attachment', error);
    }
    const downloadOptions = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
    const result = await FileSystem.downloadAsync(url, targetPath, downloadOptions);
    if (result && typeof result.status === 'number' && result.status >= 200 && result.status < 400) {
      return result.uri;
    }
  } catch (error) {
    console.warn('[Mutabaka] Failed to cache attachment preview', error);
  }
  return null;
}

function inferExtensionForCache(source: string): string | null {
  if (!source) {
    return null;
  }
  const sanitized = source.split('?')[0]?.split('#')[0] ?? '';
  const match = sanitized.match(/\.([a-z0-9]{1,8})$/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return null;
}

function stableHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeAttachmentUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith('http://')) {
    try {
      const parsed = new URL(url);
      parsed.protocol = 'https:';
      return parsed.toString();
    } catch {
      // ignore conversion errors and fall back to original URL
    }
  }
  try {
    return encodeURI(url);
  } catch {
    return url;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  attachmentCard: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 6,
  },
  attachmentCardLight: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(253, 186, 116, 0.45)',
  },
  attachmentCardDark: {
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
  },
  attachmentImageWrapper: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  attachmentImage: {
    width: '100%',
    minHeight: 160,
  },
  attachmentBodyFile: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  attachmentBodyImage: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  attachmentIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  attachmentMeta: {
    fontSize: 11,
    opacity: 0.75,
    marginTop: 4,
    textAlign: 'right',
  },
  attachmentHint: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'right',
  },
  attachmentActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  attachmentActionButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActionDisabled: {
    opacity: 0.6,
  },
  attachmentActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
