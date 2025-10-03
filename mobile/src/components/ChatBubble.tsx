import FeatherIcon from '@expo/vector-icons/Feather';
import * as FileSystem from 'expo-file-system/legacy';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions, type ImageProps, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { cn } from '../utils/cn';
import { useThemeMode } from '../theme';
import { getAccessToken } from '../lib/authStorage';
import { environment } from '../config/environment';
import Pdf from 'react-native-pdf';
import ImageView from 'react-native-image-viewing';

type FeatherIconName = keyof typeof FeatherIcon.glyphMap;

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
const imageAspectRatioCache = new Map<string, number>();
const MAX_IMAGE_HEIGHT = 220;
const MIN_IMAGE_HEIGHT = 110;
const DEFAULT_IMAGE_HEIGHT = 180;
const DEFAULT_PLACEHOLDER_HEIGHT = 160;

interface ChatBubbleProps {
  text: string;
  caption?: string | null;
  time: string;
  date?: string;
  isMine?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  deliveredPassively?: boolean;
  variant?: 'text' | 'transaction' | 'system' | 'attachment' | 'wallet';
  transaction?: TransactionPayload;
  attachment?: AttachmentData | null;
  highlightQuery?: string;
  highlightActive?: boolean;
}

function ChatBubbleBase({ text, caption, time, date, isMine, status, deliveredPassively, variant = 'text', transaction, attachment, highlightQuery, highlightActive }: ChatBubbleProps) {
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isTransaction = variant === 'transaction' && transaction;
  const isSystem = variant === 'system';
  const isAttachment = variant === 'attachment' && Boolean(attachment);
  const attachmentData = isAttachment ? attachment ?? null : null;
  const { width: windowWidth } = useWindowDimensions();
  const resolvedAttachmentUrl = useMemo(() => (
    attachmentData?.url ? normalizeAttachmentUrl(attachmentData.url) : null
  ), [attachmentData?.url]);
  const aspectRatioKeys = useMemo(() => buildAspectRatioCacheKeys(attachmentData, resolvedAttachmentUrl), [attachmentData, resolvedAttachmentUrl]);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(() => getCachedAspectRatioForKeys(aspectRatioKeys));
  const [imageFailed, setImageFailed] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const authorizedDownloadRef = useRef<{ fallbackAttempted: boolean; fallbackInFlight: boolean; prefetchInFlight: boolean }>({ fallbackAttempted: false, fallbackInFlight: false, prefetchInFlight: false });
  const [pdfPreviewUri, setPdfPreviewUri] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState(false);
  const [headMime, setHeadMime] = useState<string | null>(null);
  const classificationLoggedRef = useRef<string | null>(null);
  const bubbleLayoutRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const [viewerVisible, setViewerVisible] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    const cachedRatio = getCachedAspectRatioForKeys(aspectRatioKeys);
    setImageAspectRatio((previous) => {
      if (cachedRatio && previous && Math.abs(previous - cachedRatio) < 0.0001) {
        return previous;
      }
      return cachedRatio ?? null;
    });
    setPreviewUri(null);
    authorizedDownloadRef.current = { fallbackAttempted: false, fallbackInFlight: false, prefetchInFlight: false };
    setPdfPreviewUri(null);
    setPdfPreviewLoading(false);
    setPdfPreviewError(false);
    setHeadMime(null);
    classificationLoggedRef.current = null;
  }, [aspectRatioKeys, resolvedAttachmentUrl]);

  const attachmentName = sanitizeAttachmentName(attachmentData?.name, resolvedAttachmentUrl);
  const normalizedMime = normalizeMimeForChat(attachmentData?.mime);
  const extensionHints = useMemo(() => (
    collectExtensionHints(attachmentName, resolvedAttachmentUrl)
  ), [attachmentName, resolvedAttachmentUrl]);

  useEffect(() => {
    if (normalizedMime || !resolvedAttachmentUrl) {
      return;
    }
    if (headMime || !isHttpLikeUrl(resolvedAttachmentUrl)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mime = await probeRemoteMime(resolvedAttachmentUrl);
        if (!cancelled && mime) {
          setHeadMime(mime);
        }
      } catch (error) {
        if (!cancelled) {
          console.debug('[Mutabaka][ChatBubble] HEAD probe failed', {
            url: resolvedAttachmentUrl,
            error,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [normalizedMime, headMime, resolvedAttachmentUrl]);

  const inferredMime = useMemo(() => (
    normalizedMime
    || normalizeMimeForChat(headMime)
    || mimeFromExtensionHints(extensionHints)
  ), [normalizedMime, headMime, extensionHints]);

  const isImageCandidate = useMemo(() => (
    isAttachment
    && Boolean(attachmentData)
    && evaluateImageCandidate({
      mime: inferredMime,
      fallbackMime: normalizedMime,
      extensionHints,
      url: resolvedAttachmentUrl,
    })
  ), [isAttachment, attachmentData, inferredMime, normalizedMime, extensionHints, resolvedAttachmentUrl]);

  const isPdfCandidate = useMemo(() => (
    isAttachment
    && Boolean(attachmentData)
    && evaluatePdfCandidate({
      mime: inferredMime,
      extensionHints,
    })
  ), [isAttachment, attachmentData, inferredMime, extensionHints]);

  useEffect(() => {
    const key = resolvedAttachmentUrl || attachmentName || JSON.stringify(attachmentData ?? {});
    const payload = {
      url: resolvedAttachmentUrl,
      name: attachmentName,
      mime: normalizedMime || null,
      headMime,
      inferredMime,
      extensionHints: Array.from(extensionHints),
      isImageAttachment: Boolean(isImageAttachment(attachmentData)),
      isPdfAttachment: Boolean(isPdfAttachment(attachmentData)),
      isImageCandidate,
      isPdfCandidate,
    };
    if (classificationLoggedRef.current !== key) {
      classificationLoggedRef.current = key;
      console.debug('[Mutabaka][ChatBubble] classify attachment', payload);
    }
  }, [attachmentData, attachmentName, extensionHints, headMime, inferredMime, isImageCandidate, isPdfCandidate, normalizedMime, resolvedAttachmentUrl]);

  const workingImageUri = previewUri || resolvedAttachmentUrl;

  useEffect(() => {
    if (!isImageCandidate) {
      return;
    }
    const keys = previewUri ? [...aspectRatioKeys, previewUri] : aspectRatioKeys;
    const cached = getCachedAspectRatioForKeys(keys);
    if (cached && (!imageAspectRatio || Math.abs(imageAspectRatio - cached) > 0.0001)) {
      setImageAspectRatio(cached);
    }
  }, [aspectRatioKeys, imageAspectRatio, isImageCandidate, previewUri]);

  useEffect(() => {
    if (!isImageCandidate || !resolvedAttachmentUrl) {
      return;
    }
    if (!shouldAttemptAuthorizedDownload(resolvedAttachmentUrl)) {
      return;
    }
    let cancelled = false;
    authorizedDownloadRef.current.prefetchInFlight = true;
    authorizedDownloadRef.current.fallbackInFlight = false;
    downloadAttachmentToCache(resolvedAttachmentUrl, attachmentName)
      .then((localUri) => {
        if (cancelled) {
          return;
        }
        authorizedDownloadRef.current.prefetchInFlight = false;
        if (localUri) {
          setPreviewUri(localUri);
          setImageFailed(false);
        }
      })
      .catch((error) => {
        authorizedDownloadRef.current.prefetchInFlight = false;
        if (!cancelled) {
          console.warn('[Mutabaka] Prefetch image attachment failed', {
            url: resolvedAttachmentUrl,
            error,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isImageCandidate, resolvedAttachmentUrl, attachmentName]);

  useEffect(() => {
    if (!isImageCandidate || !workingImageUri) {
      if (!isImageCandidate) {
        setImageAspectRatio(null);
      }
      return;
    }
    let cancelled = false;
    console.debug('[Mutabaka][ChatBubble] measuring image size', {
      uri: workingImageUri,
    });
    Image.getSize(
      workingImageUri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        if (width > 0 && height > 0) {
          const ratio = width / height;
          console.debug('[Mutabaka][ChatBubble] image size', {
            uri: workingImageUri,
            width,
            height,
          });
          setImageAspectRatio(ratio);
          rememberAspectRatio(workingImageUri, ratio);
          rememberAspectRatio(resolvedAttachmentUrl, ratio);
          aspectRatioKeys.forEach((key: string) => rememberAspectRatio(key, ratio));
        } else {
          console.debug('[Mutabaka][ChatBubble] image size zero', {
            uri: workingImageUri,
            width,
            height,
          });
          setImageAspectRatio(null);
        }
      },
      () => {
        if (!cancelled) {
          console.debug('[Mutabaka][ChatBubble] image size failed', {
            uri: workingImageUri,
          });
          setImageAspectRatio(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [aspectRatioKeys, isImageCandidate, workingImageUri, resolvedAttachmentUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!isPdfCandidate || !resolvedAttachmentUrl) {
      setPdfPreviewUri(null);
      setPdfPreviewLoading(false);
      setPdfPreviewError(false);
      return;
    }
    setPdfPreviewLoading(true);
    setPdfPreviewError(false);
    console.debug('[Mutabaka][ChatBubble] Preparing PDF preview', {
      uri: resolvedAttachmentUrl,
      attachmentName,
    });
    downloadAttachmentToCache(resolvedAttachmentUrl, attachmentName)
      .then((localUri) => {
        if (cancelled) {
          return;
        }
        if (localUri) {
          console.debug('[Mutabaka][ChatBubble] Cached PDF preview ready', {
            uri: resolvedAttachmentUrl,
            localUri,
          });
          setPdfPreviewUri(localUri);
          setPdfPreviewError(false);
        } else {
          console.warn('[Mutabaka][ChatBubble] PDF cache returned empty URI', {
            uri: resolvedAttachmentUrl,
          });
          setPdfPreviewUri(null);
          setPdfPreviewError(true);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn('[Mutabaka][ChatBubble] Failed to prepare PDF preview', {
          uri: resolvedAttachmentUrl,
          error,
        });
        setPdfPreviewUri(null);
        setPdfPreviewError(true);
      })
      .finally(() => {
        if (!cancelled) {
          setPdfPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isPdfCandidate, resolvedAttachmentUrl, attachmentName]);

  const normalizedHighlightQuery = highlightQuery?.trim() ?? '';
  const shouldHighlight = Boolean(normalizedHighlightQuery);
  const isActiveHighlight = Boolean(highlightActive);

  const trimmedText = (text || '').trim();
  const normalizedCaption = caption?.trim() ?? '';
  const attachmentHasUrl = Boolean(resolvedAttachmentUrl || workingImageUri || pdfPreviewUri);
  const hasImageDimensions = Boolean(imageAspectRatio && imageAspectRatio > 0.01);
  const imagePreviewAvailable = isImageCandidate && attachmentHasUrl && !imageFailed && hasImageDimensions;
  const pdfPreviewAvailable = isPdfCandidate && Boolean(pdfPreviewUri) && !pdfPreviewError;
  const showAttachmentCaption = isAttachment
    ? Boolean(normalizedCaption && normalizedCaption !== attachmentName && normalizedCaption !== DEFAULT_ATTACHMENT_LABEL)
    : false;
  const textContent = isAttachment ? normalizedCaption : text;
  const showTextBlock = isAttachment ? showAttachmentCaption : Boolean(trimmedText);

  const bubbleContentMaxWidth = Math.min(windowWidth * 0.7, 360);
  const bubbleContentMinWidth = Math.min(160, bubbleContentMaxWidth);
  const attachmentDisplayWidth = useMemo(() => clamp(windowWidth * 0.6, bubbleContentMinWidth, bubbleContentMaxWidth), [windowWidth, bubbleContentMinWidth, bubbleContentMaxWidth]);
  const imageRenderKey = previewUri
    ? `cached:${previewUri}`
    : resolvedAttachmentUrl
      ? `remote:${resolvedAttachmentUrl}`
      : 'attachment-image';
  const viewerSources = useMemo(() => {
    if (!isImageCandidate) {
      return [] as { uri: string }[];
    }
    const uri = previewUri || resolvedAttachmentUrl;
    if (!uri) {
      return [];
    }
    return [{ uri }];
  }, [isImageCandidate, previewUri, resolvedAttachmentUrl]);
  const viewerFileName = attachmentName || 'صورة';
  const primaryViewerUri = viewerSources.length ? viewerSources[0].uri : null;
  const viewerImageProps = useMemo<ImageProps>(() => ({
    style: {
      alignSelf: 'center',
      borderWidth: 2,
      borderColor: 'rgba(255, 99, 71, 0.7)',
      marginTop: 60,
      marginBottom: 60,
    },
  }), []);

  const handleCloseViewer = useCallback(() => {
    setViewerVisible(false);
  }, []);

  const handleShareViewer = useCallback(() => {
    const sourceUri = primaryViewerUri;
    if (!sourceUri) {
      return;
    }
    Share.share({
      message: sourceUri,
      url: sourceUri,
      title: viewerFileName,
    }).catch((error) => {
      console.warn('[Mutabaka][ChatBubble] share image failed', error);
    });
  }, [primaryViewerUri, viewerFileName]);

  const renderViewerHeader = useCallback(() => (
    <View style={styles.viewerHeader} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إغلاق الصورة"
        onPress={handleCloseViewer}
        hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
        style={({ pressed }) => [
          styles.viewerHeaderButton,
          pressed ? styles.viewerHeaderButtonPressed : null,
        ]}
      >
        <FeatherIcon name="x" size={22} color="#fff7ed" />
      </Pressable>
    </View>
  ), [handleCloseViewer]);

  const renderViewerFooter = useCallback(() => (
    <View style={styles.viewerFooter}>
      <Text style={styles.viewerFooterTitle} numberOfLines={1} ellipsizeMode="tail">{viewerFileName}</Text>
      <Pressable style={styles.viewerFooterButton} onPress={handleShareViewer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.viewerFooterButtonText}>مشاركة / حفظ</Text>
      </Pressable>
    </View>
  ), [handleShareViewer, viewerFileName]);

  const container = isSystem
    ? cn(
        'max-w-[85%] self-center rounded-2xl px-4 py-2 mb-3',
        isLight ? 'bg-[#fde4c3]' : 'bg-[#1f2937]',
      )
    : cn(
        'max-w-[80%] rounded-3xl px-4 py-3 mb-3 shadow-sm',
        isMine
          ? isLight
            ? 'self-start bg-bubbleSentLight'
            : 'self-start bg-bubbleSentDark'
          : isLight
            ? 'self-end bg-bubbleReceivedLight'
            : 'self-end bg-bubbleReceivedDark',
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
    ? isLight ? '#7c4a21' : '#aca7f3ff'
    : isLight ? '#8c6d52' : '#94a3b8';

  const showTicks = Boolean(isMine && status);
  const baseSentColor = isLight ? '#696552ff' : '#807a6bff';
  const deliveredActiveColor = isLight ? '#38bdf8' : '#60a5fa';
  const readColor = isLight ? '#10b981' : '#34d399';
  const ticksColor = (() => {
    if (!status || status === 'sent') {
      return baseSentColor;
    }
    if (status === 'delivered') {
      return deliveredPassively ? baseSentColor : deliveredActiveColor;
    }
    return readColor;
  })();

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

  const imageDisplayHeight = useMemo(() => {
    if (!isImageCandidate) {
      return undefined;
    }
    const baseWidth = attachmentDisplayWidth;
    if (baseWidth && imageAspectRatio && imageAspectRatio > 0.01) {
      const measuredHeight = baseWidth / imageAspectRatio;
      return clamp(measuredHeight, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT);
    }
    if (baseWidth) {
      const estimatedHeight = baseWidth * 0.7;
      return clamp(estimatedHeight, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT);
    }
    return DEFAULT_IMAGE_HEIGHT;
  }, [attachmentDisplayWidth, imageAspectRatio, isImageCandidate]);

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
  const primaryExtension = Array.from(extensionHints)[0] ?? extractExtension(attachmentName) ?? null;
  const iconName: FeatherIconName = iconNameForExtension(primaryExtension, { isPdfCandidate, isImageCandidate });
    const showAttachmentName = !isImageCandidate;

    const handleOpen = () => {
      const url = resolvedAttachmentUrl || pdfPreviewUri || workingImageUri;
      if (!url) {
        Alert.alert('الرابط غير متاح بعد', 'انتظر اكتمال الرفع ثم حاول مجدداً.');
        return;
      }
      Linking.openURL(url).catch((error) => {
        console.warn('[Mutabaka] Failed to open attachment', error);
        Alert.alert('تعذر فتح الملف', 'تأكد من توفر تطبيق مناسب أو حاول لاحقاً.');
      });
    };

    const handlePreviewPress = () => {
      if (viewerSources.length) {
        setViewerVisible(true);
      } else {
        handleOpen();
      }
    };

  const previewWidth = attachmentDisplayWidth;
  const pdfPreviewHeight = clamp(previewWidth * 0.85, 150, 240);
  const showPdfShell = isPdfCandidate && (pdfPreviewLoading || pdfPreviewAvailable);
  const showImageShell = isImageCandidate && attachmentHasUrl;
  const showPreviewShell = imagePreviewAvailable || showPdfShell || showImageShell;

    return (
      <View
        style={[styles.attachmentCard, isLight ? styles.attachmentCardLight : styles.attachmentCardDark, { width: previewWidth, maxWidth: bubbleContentMaxWidth }]}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          const previous = bubbleLayoutRef.current;
          if (previous.width !== width || previous.height !== height) {
            bubbleLayoutRef.current = { width, height };
            console.debug('[Mutabaka][ChatBubble] attachment card layout', {
              uri: resolvedAttachmentUrl,
              width,
              height,
            });
          }
        }}
      >
        {showImageShell ? (
          <Pressable
            style={[styles.attachmentImageWrapper, { width: previewWidth, maxWidth: bubbleContentMaxWidth }]}
            onPress={imagePreviewAvailable ? handlePreviewPress : handleOpen}
            disabled={!attachmentHasUrl}
            onLayout={({ nativeEvent }: LayoutChangeEvent) => {
              const width = nativeEvent.layout.width;
              const height = nativeEvent.layout.height;
              console.debug('[Mutabaka][ChatBubble] image wrapper layout', {
                uri: resolvedAttachmentUrl,
                width,
                height,
              });
            }}
          >
            {imagePreviewAvailable ? (
              <Image
                key={imageRenderKey}
                source={{ uri: workingImageUri as string }}
                style={[
                  styles.attachmentImage,
                  { height: imageDisplayHeight ?? DEFAULT_IMAGE_HEIGHT },
                  { width: '100%' },
                ]}
                resizeMode="contain"
                onLoad={({ nativeEvent }) => {
                  console.debug('[Mutabaka][ChatBubble] image onLoad', {
                    uri: workingImageUri,
                    source: nativeEvent?.source,
                  });
                }}
                onError={() => {
                console.debug('[Mutabaka][ChatBubble] image onError', {
                  uri: workingImageUri,
                  resolvedAttachmentUrl,
                  attempted: authorizedDownloadRef.current.fallbackAttempted,
                  prefetchInFlight: authorizedDownloadRef.current.prefetchInFlight,
                });
                if (!resolvedAttachmentUrl) {
                  setImageFailed(true);
                  return;
                }
                if (!authorizedDownloadRef.current.fallbackAttempted) {
                  authorizedDownloadRef.current.fallbackAttempted = true;
                  authorizedDownloadRef.current.fallbackInFlight = true;
                  downloadAttachmentToCache(resolvedAttachmentUrl, attachmentName)
                    .then((localUri: string | null) => {
                      authorizedDownloadRef.current.fallbackInFlight = false;
                      console.debug('[Mutabaka][ChatBubble] image fallback download result', {
                        status: localUri ? 'cached' : 'empty',
                        cachedUri: localUri,
                      });
                      if (localUri) {
                        setPreviewUri(localUri);
                        setImageFailed(false);
                      } else {
                        setImageFailed(true);
                      }
                    })
                    .catch((error) => {
                      authorizedDownloadRef.current.fallbackInFlight = false;
                      console.debug('[Mutabaka][ChatBubble] image fallback download failed', {
                        error,
                      });
                      setImageFailed(true);
                    });
                } else if (authorizedDownloadRef.current.fallbackInFlight || authorizedDownloadRef.current.prefetchInFlight) {
                  // wait for download to finish
                } else {
                  setImageFailed(true);
                }
              }}
                />
              ) : (
                <View style={[
                  styles.imagePlaceholder,
                  imageDisplayHeight
                    ? { height: imageDisplayHeight }
                    : { height: DEFAULT_PLACEHOLDER_HEIGHT },
                ]}>
                  <ActivityIndicator size="small" color={isLight ? '#92400e' : '#fde68a'} />
                </View>
              )}
          </Pressable>
        ) : null}
        {!imagePreviewAvailable && isPdfCandidate ? (
          <Pressable
            style={[styles.pdfPreviewContainer, { height: pdfPreviewHeight, width: previewWidth, maxWidth: bubbleContentMaxWidth }]}
            onPress={handleOpen}
            onLayout={({ nativeEvent }: LayoutChangeEvent) => {
              const width = nativeEvent.layout.width;
              const height = nativeEvent.layout.height;
              console.debug('[Mutabaka][ChatBubble] pdf wrapper layout', {
                uri: resolvedAttachmentUrl,
                width,
                height,
              });
            }}
          >
            {pdfPreviewAvailable ? (
              <Pdf
                source={{ uri: pdfPreviewUri as string, cache: true }}
                page={1}
                trustAllCerts={false}
                enablePaging={false}
                enableAnnotationRendering={false}
                style={styles.pdfPreview}
              />
            ) : (
              <View style={styles.pdfPreviewPlaceholder}>
                {pdfPreviewLoading ? (
                  <ActivityIndicator size="small" color={isLight ? '#92400e' : '#fde68a'} />
                ) : (
                  <View style={styles.pdfPlaceholderContent}>
                    <FeatherIcon name="file-text" size={28} color={iconColorBase} />
                    <Text style={[styles.pdfPlaceholderText, { color: metaColor }]}>
                      {pdfPreviewError ? 'تعذر تحميل المعاينة، اضغط على فتح.' : 'جاري تجهيز المعاينة…'}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </Pressable>
        ) : null}
        <View style={showPreviewShell ? styles.attachmentBodyImage : styles.attachmentBodyFile}>
          {!showPreviewShell ? (
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
            {showAttachmentName ? (
              <Text style={[styles.attachmentName, { color: infoTextColor }]} numberOfLines={2} ellipsizeMode="tail">
                {renderHighlightedSegments(fileName, highlightNeedle, isLight, isActiveHighlight)}
              </Text>
            ) : null}
            {metaLabel ? (
              <Text
                style={[
                  styles.attachmentMeta,
                  { color: metaColor },
                  !showAttachmentName ? { marginTop: 0 } : null,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
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
            ) : (!imagePreviewAvailable && isPdfCandidate && pdfPreviewError) ? (
              <Text style={[styles.attachmentHint, { color: failureHintColor }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                تعذر عرض المعاينة داخل المحادثة، اضغط على فتح للاطلاع على الملف.
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
    <>
      <View
        className={container}
        style={[transactionStyle, highlightContainerStyle]}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          const previous = bubbleLayoutRef.current;
          if (previous.width !== width || previous.height !== height) {
            bubbleLayoutRef.current = { width, height };
            console.debug('[Mutabaka][ChatBubble] bubble layout', {
              width,
              height,
            });
          }
        }}
      >
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
          {showTicks ? <MessageTicks color={ticksColor} /> : null}
        </View>
      )}
    </View>
      {viewerSources.length ? (
        <ImageView
          images={viewerSources}
          imageIndex={0}
          visible={viewerVisible}
          onRequestClose={handleCloseViewer}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
          backgroundColor="rgba(0,0,0,0.95)"
          HeaderComponent={renderViewerHeader}
          imageProps={viewerImageProps}
        />
      ) : null}
    </>
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

function formatAttachmentMeta(attachment?: AttachmentData | null): string | null {
  if (!attachment) {
    return null;
  }
  const parts: string[] = [];
  const mime = normalizeMimeForChat(attachment.mime);
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

function getCachedAspectRatio(uri?: string | null): number | null {
  const key = normalizeAspectRatioCacheKey(uri);
  if (!key) {
    return null;
  }
  return imageAspectRatioCache.get(key) ?? null;
}

function getCachedAspectRatioForKeys(keys: readonly (string | null | undefined)[]): number | null {
  for (const candidate of keys) {
    const ratio = getCachedAspectRatio(candidate);
    if (ratio && ratio > 0.01) {
      return ratio;
    }
  }
  return null;
}

function rememberAspectRatio(uri: string | null | undefined, ratio: number): void {
  const key = normalizeAspectRatioCacheKey(uri);
  if (!key) {
    return;
  }
  if (!Number.isFinite(ratio) || ratio <= 0.01) {
    return;
  }
  imageAspectRatioCache.set(key, ratio);
}

function buildAspectRatioCacheKeys(attachment: AttachmentData | null, resolvedUrl?: string | null): string[] {
  if (!attachment && !resolvedUrl) {
    return [];
  }
  const keys = new Set<string>();
  const normalizedResolved = normalizeAspectRatioCacheKey(resolvedUrl);
  if (normalizedResolved) {
    keys.add(normalizedResolved);
  }
  if (attachment) {
    const normalizedRaw = normalizeAspectRatioCacheKey(attachment.url ?? null);
    if (normalizedRaw) {
      keys.add(normalizedRaw);
    }
    const sanitizedName = sanitizeAttachmentName(attachment.name, resolvedUrl ?? attachment.url ?? null);
    const normalizedName = sanitizedName ? sanitizedName.trim().toLowerCase() : '';
    const size = typeof attachment.size === 'number' && attachment.size > 0 ? Math.round(attachment.size) : null;
    if (normalizedName) {
      keys.add(`name:${normalizedName}`);
      if (size) {
        keys.add(`name:${normalizedName}|size:${size}`);
      }
    }
    if (size) {
      keys.add(`size:${size}`);
    }
    const fingerprint = `${normalizedName}|${size ?? ''}|${normalizedRaw ?? normalizedResolved ?? ''}`;
    const hashed = stableHash(fingerprint);
    if (hashed) {
      keys.add(`fp:${hashed}`);
    }
  }
  return Array.from(keys);
}

function normalizeAspectRatioCacheKey(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^(?:name|size|fp):/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^data:/i.test(trimmed)) {
    return trimmed.slice(0, 96);
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      parsed.hash = '';
      parsed.search = '';
      return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch {
      // ignore and fall back to manual sanitization
    }
  }
  const sanitized = trimmed.split(/[?#]/)[0];
  if (!sanitized) {
    return null;
  }
  return sanitized.toLowerCase();
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

function normalizeAttachmentUrl(rawUrl: string): string {
  if (!rawUrl) {
    return rawUrl;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith('file://') || trimmed.startsWith('content://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const absolutePattern = /^(?:[a-z]+:)?\/\//i;
  let resolved = trimmed;

  if (!absolutePattern.test(trimmed)) {
    try {
      const base = new URL(environment.apiBaseUrl);
      resolved = new URL(trimmed.replace(/^\/+/, ''), base).toString();
    } catch (error) {
      console.warn('[Mutabaka] Failed to resolve attachment base URL', error);
      const prefix = environment.apiBaseUrl.replace(/\/+$/, '');
      resolved = `${prefix}/${trimmed.replace(/^\/+/, '')}`;
    }
  }

  if (resolved.startsWith('http://')) {
    try {
      const parsed = new URL(resolved);
      parsed.protocol = 'https:';
      resolved = parsed.toString();
    } catch {
      // ignore and keep original scheme
    }
  }

  try {
    return encodeURI(resolved);
  } catch {
    return resolved;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeAttachmentName(name?: string | null, fallbackUrl?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) {
    return decodeUriComponentSafe(trimmed);
  }
  if (!fallbackUrl) {
    return '';
  }
  try {
    const parsed = new URL(fallbackUrl);
    const segments = parsed.pathname.split('/');
    const candidate = segments[segments.length - 1];
    return decodeUriComponentSafe(candidate || '').trim();
  } catch {
    const cleaned = fallbackUrl.split('?')[0]?.split('#')[0] ?? fallbackUrl;
    const pieces = cleaned.split('/');
    const candidate = pieces[pieces.length - 1] ?? '';
    return decodeUriComponentSafe(candidate.trim());
  }
}

function normalizeMimeForChat(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heif', 'heic']);
const PDF_EXTENSIONS = new Set(['pdf']);
const EXTENSION_MIME_GUESS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heif: 'image/heif',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

const EXTENSION_ICON_MAP: Record<string, FeatherIconName> = {
  pdf: 'file-text',
  doc: 'file-text',
  docx: 'file-text',
  xls: 'file',
  xlsx: 'file',
  csv: 'file',
  txt: 'file-text',
  json: 'code',
  html: 'code',
  js: 'code',
  ts: 'code',
  zip: 'package',
  rar: 'package',
  '7z': 'package',
  tar: 'package',
  gz: 'package',
  mp3: 'music',
  wav: 'music',
  flac: 'music',
  mp4: 'film',
  mov: 'film',
  avi: 'film',
  mkv: 'film',
};

function collectExtensionHints(name: string, url?: string | null): Set<string> {
  const hints = new Set<string>();
  const sources = [name, url ? decodeUriComponentSafe(url.split('?')[0]?.split('#')[0] ?? url) : null];
  sources.forEach((source) => {
    if (!source) {
      return;
    }
    const ext = extractExtension(source);
    if (ext) {
      hints.add(ext);
    }
  });
  return hints;
}

function extractExtension(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const sanitized = decodeUriComponentSafe(value.trim().toLowerCase());
  const match = sanitized.match(/\.([a-z0-9]{1,10})$/);
  return match ? match[1] : null;
}

function mimeFromExtensionHints(hints: Set<string>): string | null {
  for (const ext of hints) {
    const guess = EXTENSION_MIME_GUESS[ext];
    if (guess) {
      return guess;
    }
  }
  return null;
}

function evaluateImageCandidate(params: {
  mime: string | null;
  fallbackMime?: string | null;
  extensionHints: Set<string>;
  url?: string | null;
}): boolean {
  const mime = params.mime || params.fallbackMime || '';
  if (mime.startsWith('image/')) {
    return true;
  }
  for (const ext of params.extensionHints) {
    if (IMAGE_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  if (params.url && params.url.toLowerCase().startsWith('data:image/')) {
    return true;
  }
  return false;
}

function evaluatePdfCandidate(params: { mime: string | null; extensionHints: Set<string> }): boolean {
  const mime = params.mime || '';
  if (mime.includes('pdf')) {
    return true;
  }
  for (const ext of params.extensionHints) {
    if (PDF_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

function isImageAttachment(attachment?: AttachmentData | null): boolean {
  if (!attachment) {
    return false;
  }
  const name = sanitizeAttachmentName(attachment.name, attachment.url);
  const mime = normalizeMimeForChat(attachment.mime);
  const hints = collectExtensionHints(name, attachment.url ?? undefined);
  return evaluateImageCandidate({ mime, fallbackMime: mime, extensionHints: hints, url: attachment.url });
}

function isPdfAttachment(attachment?: AttachmentData | null): boolean {
  if (!attachment) {
    return false;
  }
  const name = sanitizeAttachmentName(attachment.name, attachment.url);
  const mime = normalizeMimeForChat(attachment.mime);
  const hints = collectExtensionHints(name, attachment.url ?? undefined);
  return evaluatePdfCandidate({ mime, extensionHints: hints });
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHttpLikeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

async function probeRemoteMime(url: string): Promise<string | null> {
  try {
    if (!isHttpLikeUrl(url)) {
      return null;
    }
    const token = await getAccessToken().catch(() => null);
    const response = await fetch(url, {
      method: 'HEAD',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      return null;
    }
    const header = response.headers.get('content-type');
    return normalizeMimeForChat(header);
  } catch {
    return null;
  }
}

function iconNameForExtension(ext: string | null, options: { isPdfCandidate: boolean; isImageCandidate: boolean }): FeatherIconName {
  if (options.isImageCandidate) {
    return 'image';
  }
  if (options.isPdfCandidate) {
    return 'file-text';
  }
  if (ext) {
    const mapped = EXTENSION_ICON_MAP[ext];
    if (mapped) {
      return mapped;
    }
  }
  return 'paperclip';
}

const styles = StyleSheet.create({
  attachmentCard: {
    width: '100%',
    alignSelf: 'stretch',
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
    alignSelf: 'stretch',
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  attachmentImage: {
    width: '100%',
      minHeight: MIN_IMAGE_HEIGHT,
  },
  imagePlaceholder: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
  pdfPreviewContainer: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    overflow: 'hidden',
  },
  pdfPreview: {
    flex: 1,
    width: '100%',
  },
  pdfPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pdfPlaceholderContent: {
    alignItems: 'center',
  },
  pdfPlaceholderText: {
    marginTop: 8,
    fontSize: 12,
    textAlign: 'center',
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
  viewerHeader: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 24,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    direction: 'ltr',
    alignItems: 'center',
  },
  viewerHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(249, 115, 22, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeaderButtonPressed: {
    backgroundColor: 'rgba(249, 115, 22, 0.55)',
  },
  viewerFooter: {
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
    direction: 'ltr',
  },
  viewerFooterTitle: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '600',
    marginRight: 12,
    textAlign: 'right',
  },
  viewerFooterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(249, 115, 22, 0.65)',
  },
  viewerFooterButtonText: {
    color: '#fff7ed',
    fontSize: 13,
    fontWeight: '700',
  },
});
