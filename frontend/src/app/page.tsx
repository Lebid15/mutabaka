"use client";
// أزلنا CSS module (page.module.css) لأن التصميم الآن يعتمد كلياً على Tailwind

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { IconType } from 'react-icons';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api';
import { listTeam, listConversationMembers, addTeamMemberToConversation, removeMemberFromConversation, TeamMember } from '../lib/api-team';
import { attachPrimingListeners, tryPlayMessageSound, setRuntimeSoundUrl } from '../lib/sound';
import { useThemeMode } from './theme-context';
import { FaMoneyBillTrendUp } from 'react-icons/fa6';
import { FaWhatsapp, FaFacebookF, FaYoutube, FaTelegramPlane, FaInstagram, FaTwitter, FaSnapchatGhost, FaLinkedinIn } from 'react-icons/fa';
import { SiTiktok } from 'react-icons/si';
import { HiOutlineEnvelope } from 'react-icons/hi2';
import { FiLink } from 'react-icons/fi';
import { AiOutlineFileDone } from 'react-icons/ai';

// قائمة احتياطية (fallback) في حال تأخر تحميل العملات من الخادم
const fallbackCurrencies = [
  { name: "دولار", code: "USD", symbol: "$" },
  { name: "يورو", code: "EUR", symbol: "€" },
  { name: "تركي", code: "TRY", symbol: "₺" },
  { name: "سوري", code: "SYP", symbol: "ل.س" },
];
// خريطة أسماء عربية بحسب كود العملة لضمان ثبات التسمية حتى لو رجعت أسماء إنجليزية من الخادم
const AR_NAME_BY_CODE: Record<string, string> = {
  USD: "دولار",
  EUR: "يورو",
  TRY: "تركي",
  SYP: "سوري",
};
// تنسيق وقت قصير مثل واتساب (ساعة:دقيقة)
const formatTimeShort = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
const formatDateShort = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
};
const toDateInputValue = (date: Date) => {
  const pad = (val: number) => String(val).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const formatDateTimeLabel = (iso?: string) => {
  if (!iso) return '';
  const datePart = formatDateShort(iso);
  const timePart = formatTimeShort(iso);
  return [datePart, timePart].filter(Boolean).join(' ');
};
const normalizeWalletText = (value: string): string =>
  value.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
const WALLET_SETTLED_MATCHES = [
  'الحساب صفر',
  'الحساب 000 صفر',
  'الحساب 800 صفر',
  'تمت تسوية جميع المحافظ',
  'تم تصفير جميع المحافظ',
  'تم تصفير المحافظ',
];
const matchesWalletSettlementPhrase = (text: string): boolean => {
  const normalized = normalizeWalletText(text);
  return WALLET_SETTLED_MATCHES.some(token => normalized.includes(token));
};
const isWalletSettlementMessage = (msg: any): boolean => {
  if (!msg) return false;
  const subtype = typeof msg.systemSubtype === 'string'
    ? msg.systemSubtype
    : (typeof msg.system_subtype === 'string' ? msg.system_subtype : undefined);
  if (subtype === 'wallet_settled') return true;
  const body = typeof msg.text === 'string'
    ? msg.text
    : (typeof msg.body === 'string' ? msg.body : '');
  if (!body) return false;
  return matchesWalletSettlementPhrase(body);
};

const WalletSettlementCard = ({ msg, isLight }: { msg: any; isLight: boolean }) => {
  const timestamp = formatDateTimeLabel(msg?.settled_at || msg?.created_at);
  const wrapClass = isLight
    ? 'bg-[#FDE8D8] text-[#8C4122] border border-[#F5C7A5]'
    : 'bg-white/10 text-amber-100 border border-white/10 backdrop-blur';
  return (
    <div
      className={`rounded-2xl px-6 py-5 shadow-sm max-w-xs sm:max-w-sm w-full flex flex-col items-center text-center gap-3 ${wrapClass}`}
      role="status"
      aria-live="polite"
    >
      <span className="text-green-500 font-semibold text-base sm:text-lg">الحساب صفر</span>
      <AiOutlineFileDone aria-hidden className="text-emerald-500" size={56} />
      <time className="text-xs sm:text-sm opacity-80" dir="ltr">
        {timestamp || '—'}
      </time>
    </div>
  );
};

const NormalTextBubble = ({
  content,
  showHighlight,
  searchQuery,
  highlightText,
}: {
  content: string;
  showHighlight: boolean;
  searchQuery: string;
  highlightText: (text: string, query: string) => React.ReactNode;
}) => {
  if (!content) return null;
  return (
    <div className="text-sm leading-6 break-words whitespace-pre-line" dir="rtl">
      <bdi className="min-w-0 break-words" style={{ unicodeBidi: 'isolate' }}>
        {showHighlight ? highlightText(content, searchQuery) : content}
      </bdi>
    </div>
  );
};
// مفاتيح وتقسيم الأيام: اليوم/أمس/تاريخ كامل
const dayKeyOf = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  } catch {
    return 'unknown';
  }
};
const sameCalendarDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const dayLabelOf = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    const now = new Date();
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
    if (sameCalendarDay(d, now)) return 'اليوم';
    if (sameCalendarDay(d, yest)) return 'أمس';
    return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return ''; }
};
// Helper: treat special admin-like usernames as admin
function isAdminLike(u?: string | null) {
  const n = (u || '').toLowerCase();
  return n === 'admin' || n === 'madmin' || n === 'a_admin' || n === 'l_admin';
}
// تحويل الأرقام العربية/الفارسية إلى إنجليزية للتعامل مع parseFloat
const arabicToEnglishDigits = (s: string) =>
  s
    .replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
// تطبيع النص الرقمي
const normalizeNumberString = (raw: string) => {
  const s = arabicToEnglishDigits(raw || '')
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '')
    .replace(/,/g, '.');
  return s.trim();
};

const DEFAULT_BRANDING_LOGO = '/frontend/public/icons/mlogo.jpg';
const EMOJI_PALETTE = ['😀','😂','😍','👍','🙏','🎉','💰','📌','❤️','😢','😎','🤔','✅','❌','🔥','🌟','🥰','😮','💡','📈','🤥','🌎'];
const EMOJI_CLUSTER_REGEX = /^[\p{Extended_Pictographic}\u200d\uFE0F]+$/u;

const isEmojiGrapheme = (segment: string) => {
  if (!segment) return false;
  const compact = segment.replace(/\s+/g, '');
  if (!compact) return false;
  return EMOJI_CLUSTER_REGEX.test(compact);
};

const truncateContactPreview = (raw: string) => {
  if (!raw) return '';
  try {
    if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
      const seg = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
      const segments: string[] = [];
      let allEmoji = true;
      for (const item of seg.segment(raw)) {
        const segment = (item && typeof item === 'object' && 'segment' in item) ? (item as any).segment as string : String(item ?? '');
        segments.push(segment);
        if (segment && segment.trim() && !isEmojiGrapheme(segment)) {
          allEmoji = false;
        }
      }
      const limit = allEmoji ? 7 : 20;
      return segments.slice(0, limit).join('');
    }
  } catch {}
  const compact = raw.replace(/\s+/g, '');
  const allEmoji = compact.length > 0 && EMOJI_CLUSTER_REGEX.test(compact);
  const limit = allEmoji ? 7 : 20;
  return Array.from(raw).slice(0, limit).join('');
};

const formatFileSize = (bytes?: number | null) => {
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '';
  const thresh = 1024;
  const units = ['ب', 'ك.ب', 'م.ب', 'ج.ب', 'ت.ب'];
  let value = bytes;
  let idx = 0;
  while (value >= thresh && idx < units.length - 1) {
    value /= thresh;
    idx += 1;
  }
  const fixed = value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${fixed.replace(/\.0$/, '')} ${units[idx]}`;
};

const inferFileKind = (mime?: string | null, name?: string | null) => {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  if (mime) {
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('word')) return 'Word';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return 'Excel';
    if (mime.includes('zip')) return 'ZIP';
    if (mime.includes('powerpoint')) return 'PowerPoint';
    if (mime.startsWith('text/')) return 'نص';
  }
  if (ext) {
    const upper = ext.toUpperCase();
    if (upper === 'PDF') return 'PDF';
    if (['DOC', 'DOCX'].includes(upper)) return 'Word';
    if (['XLS', 'XLSX', 'CSV'].includes(upper)) return 'Excel';
    if (['PPT', 'PPTX'].includes(upper)) return 'PowerPoint';
    if (upper === 'ZIP' || upper === 'RAR' || upper === '7Z') return upper;
    return upper;
  }
  return '';
};

const buildFileMeta = (mime?: string | null, name?: string | null, size?: number | null) => {
  const kind = inferFileKind(mime, name);
  const sizeLabel = formatFileSize(size ?? undefined);
  if (kind && sizeLabel) return `${kind} • ${sizeLabel}`;
  if (kind) return kind;
  if (sizeLabel) return sizeLabel;
  return '';
};

type ContactLinkDTO = {
  id: number;
  icon: string;
  icon_display: string;
  label: string;
  value: string;
};

type ContactIconMeta = {
  Icon: IconType;
  bubbleClass: string;
  iconClass: string;
};

type ContactLinkView = ContactLinkDTO & {
  href: string;
  display: string;
  subtitle?: string;
  meta: ContactIconMeta;
};

const CONTACT_ICON_META: Record<string, ContactIconMeta> = {
  whatsapp: { Icon: FaWhatsapp, bubbleClass: 'bg-[#25D366]/15 dark:bg-[#25D366]/25', iconClass: 'text-[#25D366]' },
  facebook: { Icon: FaFacebookF, bubbleClass: 'bg-[#1877F2]/15 dark:bg-[#1877F2]/25', iconClass: 'text-[#1877F2]' },
  youtube: { Icon: FaYoutube, bubbleClass: 'bg-[#FF0000]/15 dark:bg-[#FF0000]/25', iconClass: 'text-[#FF0000]' },
  telegram: { Icon: FaTelegramPlane, bubbleClass: 'bg-[#24A1DE]/15 dark:bg-[#24A1DE]/25', iconClass: 'text-[#24A1DE]' },
  instagram: { Icon: FaInstagram, bubbleClass: 'bg-gradient-to-br from-[#f09433]/20 via-[#bc1888]/25 to-[#bc1888]/20 dark:via-[#bc1888]/30', iconClass: 'text-[#bc1888]' },
  twitter: { Icon: FaTwitter, bubbleClass: 'bg-slate-300/20 dark:bg-slate-200/15', iconClass: 'text-slate-900 dark:text-slate-100' },
  tiktok: { Icon: SiTiktok, bubbleClass: 'bg-[#010101]/10 dark:bg-[#010101]/35', iconClass: 'text-[#010101] dark:text-white' },
  snapchat: { Icon: FaSnapchatGhost, bubbleClass: 'bg-[#FFFC00]/45 dark:bg-[#FFFC00]/35', iconClass: 'text-[#0f0f0f]' },
  linkedin: { Icon: FaLinkedinIn, bubbleClass: 'bg-[#0A66C2]/15 dark:bg-[#0A66C2]/25', iconClass: 'text-[#0A66C2]' },
  email: { Icon: HiOutlineEnvelope, bubbleClass: 'bg-[#0072C6]/15 dark:bg-[#0072C6]/25', iconClass: 'text-[#0072C6]' },
};

const DEFAULT_CONTACT_ICON_META: ContactIconMeta = {
  Icon: FiLink,
  bubbleClass: 'bg-gray-300/30 dark:bg-gray-700/40',
  iconClass: 'text-gray-600 dark:text-gray-100',
};

const normalizeContactHref = (icon: string, raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (icon === 'email' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return `mailto:${value}`;
  }
  if (icon === 'whatsapp') {
    const digits = value.replace(/[^+\d]/g, '');
    if (digits) {
      const normalized = digits.startsWith('+') ? digits.replace(/[^+\d]/g, '') : digits;
      return `https://wa.me/${normalized.replace(/^\+/, '')}`;
    }
  }
  if (icon === 'telegram') {
    const username = value.replace(/^@/, '');
    if (username && /^[A-Za-z0-9_]+$/.test(username)) {
      return `https://t.me/${username}`;
    }
  }
  if (icon === 'snapchat') {
    const username = value.replace(/^@/, '');
    if (username) {
      return `https://www.snapchat.com/add/${username}`;
    }
  }
  if (!/^https?:\/\//i.test(value)) {
    return `https://${value}`;
  }
  return value;
};

type AttachmentLike = { url?: string | null; mime?: string | null; name?: string | null; size?: number | null };

let pdfWorkerUrl: string | null = null;
if (typeof window !== 'undefined') {
  try {
    pdfWorkerUrl = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
  } catch (err) {
    console.warn('تعذر تحديد مسار عامل pdf.js', err);
    pdfWorkerUrl = null;
  }
}

const isPdfAttachment = (attachment?: AttachmentLike | null) => {
  if (!attachment) return false;
  const mime = (attachment.mime || '').toLowerCase();
  const name = (attachment.name || '').toLowerCase();
  if (mime.includes('pdf')) return true;
  if (name.endsWith('.pdf')) return true;
  return false;
};

const isPreviewableAttachment = (attachment?: AttachmentLike | null) => {
  if (!attachment || !attachment.url) return false;
  if (isPdfAttachment(attachment)) return true;
  return false;
};

type PdfjsLibType = typeof import('pdfjs-dist');
let pdfjsLibPromise: Promise<PdfjsLibType> | null = null;
let pdfWorkerPort: Worker | null = null;

const ensurePdfjsLib = async (): Promise<PdfjsLibType> => {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      if (typeof window !== 'undefined' && (pdfjs as any).GlobalWorkerOptions) {
        try {
          if (pdfWorkerUrl) {
            (pdfjs as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          } else if (typeof Worker !== 'undefined') {
            pdfWorkerPort = pdfWorkerPort ?? new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), { type: 'module' });
            (pdfjs as any).GlobalWorkerOptions.workerPort = pdfWorkerPort;
          }
        } catch (err) {
          console.warn('تعذر تهيئة عامل pdf.js، سيتم استخدام العامل المدمج البطيء', err);
        }
      }
      return pdfjs;
    })();
  }
  return pdfjsLibPromise as Promise<PdfjsLibType>;
};

const renderPdfToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const pdfjs = await ensurePdfjsLib();
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`فشل تحميل الملف: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const task = pdfjs.getDocument({ data: buffer });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = 360;
    const scale = baseViewport.width > maxWidth ? maxWidth / baseViewport.width : 1.4;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('تعذر إنشاء سياق الرسم للقماش');
    }
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png', 0.85);
    page.cleanup();
    pdf.cleanup?.();
    return dataUrl;
  } catch (err) {
    console.error('فشل توليد معاينة PDF', err);
    return null;
  }
};

// استخراج معاملة من نص الرسالة المولّد من الخادم
function parseTransaction(body: string): null | { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string } {
  try {
  const re = /^معاملة:\s*(لنا|لكم)\s*([0-9]+(?:\.[0-9]+)?)\s*([^\s]+)(?:\s*-\s*([\s\S]*))?$/u;
    const m = body.trim().match(re);
    if (!m) return null;
    const dir = m[1] === 'لنا' ? 'lna' : 'lkm';
    const amount = parseFloat(m[2]);
    const sym = m[3];
    const note = (m[4] || '').trim();
    return { direction: dir, amount: isNaN(amount) ? 0 : amount, currency: sym, symbol: sym, note: note || undefined };
  } catch { return null; }
}

function normalizeServerTransaction(raw: any): null | { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string } {
  if (!raw || typeof raw !== 'object') return null;
  const direction = raw.direction === 'lkm' ? 'lkm' : 'lna';
  const amountSource = raw.amount ?? raw.amount_value ?? raw.value;
  let amount = typeof amountSource === 'number' ? amountSource : parseFloat(String(amountSource ?? ''));
  if (!Number.isFinite(amount)) {
    amount = 0;
  }
  const currencyCode = typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim() : '';
  const symbolRaw = typeof raw.symbol === 'string' && raw.symbol.trim() ? raw.symbol.trim() : '';
  const symbol = symbolRaw || currencyCode || '';
  const note = typeof raw.note === 'string' ? raw.note : (Array.isArray(raw.note) ? raw.note.join('\n') : '');
  return {
    direction,
    amount,
    currency: currencyCode || symbol,
    symbol,
    note: note || undefined,
  };
}

const buildMessageKey = (msg: any, index: number, prefix = 'msg') => {
  if (msg && typeof msg.id === 'number') {
    const suffix = msg && typeof msg.client_id === 'string' && msg.client_id ? `_c_${msg.client_id}` : '_c_none';
    return `${prefix}_id_${msg.id}${suffix}`;
  }
  if (msg && typeof msg.client_id === 'string' && msg.client_id) {
    return `${prefix}_cid_${msg.client_id}`;
  }
  if (msg && typeof msg.created_at === 'string' && msg.created_at) {
    return `${prefix}_ts_${msg.created_at}_${index}`;
  }
  return `${prefix}_idx_${index}`;
};

// Two-state ticks (delivered=1 gray, read=2 blue)
function Ticks({ read, className }: { read: boolean; className?: string }) {
  const base = `inline-block align-middle ${className || ''}`;
  return (
    <svg className={base} width="22" height="20" viewBox="0 0 32 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30 6L18 18l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M23 6L11 18l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TransactionBubble({ sender, tx, createdAt, isLight, noteContent }: { sender: 'current'|'other'; tx: { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string }, createdAt?: string; isLight?: boolean; noteContent?: React.ReactNode }) {
  const isMine = sender === 'current';
  const wrapClass = isMine
    ? `self-start bg-bubbleSent ${isLight ? 'text-gray-900' : 'text-gray-100'} px-3 py-2 rounded-2xl rounded-bl-sm inline-flex flex-col w-fit max-w-[180px] md:max-w-[220px] text-xs shadow break-words`
    : `self-end bg-bubbleReceived ${isLight ? 'text-gray-900' : 'text-white'} px-3 py-2 rounded-2xl rounded-br-sm inline-flex flex-col w-fit max-w-[180px] md:max-w-[220px] text-xs shadow break-words`;
  const badgeClass = tx.direction === 'lna'
    ? (isLight ? 'bg-green-100 text-green-700' : 'bg-green-600/30 text-green-200')
    : (isLight ? 'bg-red-100 text-red-700' : 'bg-red-600/30 text-red-200');
  const rawAmount = typeof tx.amount === 'number' ? tx.amount : parseFloat(String(tx.amount ?? 0));
  const amountValue = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
  const amountLabel = amountValue.toFixed(2);
  const dateLabel = formatDateShort(createdAt);
  const timeLabel = formatTimeShort(createdAt);
  return (
    <div className={wrapClass}>
      <div className="flex items-center gap-2 mb-1">
        <FaMoneyBillTrendUp className="h-5 w-5 opacity-80" aria-hidden="true" />
        <span className="font-bold">معاملة</span>
        <span className={`px-2.5 py-0.5 rounded-full text-[11px] md:text-xs font-semibold ${badgeClass}`}>{tx.direction === 'lna' ? 'لنا' : 'لكم'}</span>
      </div>
      <div className="font-semibold tabular-nums text-sm md:text-base" dir="ltr">{amountLabel} {tx.symbol}</div>
  {tx.note && (
        <div
          className={`text-[10px] mt-1 whitespace-pre-wrap ${isLight ? 'text-gray-700' : 'text-gray-200/90'}`}
          dir="rtl"
        >
          {noteContent ?? tx.note}
        </div>
      )}
      {dateLabel && (
        <div className="mt-1 text-[10px] text-gray-400 flex items-center justify-end" dir="ltr">{dateLabel}</div>
      )}
      {timeLabel && (
        <div className="mt-0.5 text-[10px] text-gray-300 flex items-center justify-end" dir="ltr">{timeLabel}</div>
      )}
    </div>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" strokeLinecap="round" />
      <line x1="12" y1="21" x2="12" y2="23" strokeLinecap="round" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" strokeLinecap="round" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" strokeLinecap="round" />
      <line x1="1" y1="12" x2="3" y2="12" strokeLinecap="round" />
      <line x1="21" y1="12" x2="23" y2="12" strokeLinecap="round" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" strokeLinecap="round" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M21 12.79A9 9 0 0 1 11.21 3 7 7 0 0 0 21 12.79Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// مكون رأس القائمة الجانبية مع نافذة بحث ديناميكي عن المستخدمين + إنشاء محادثة
function SidebarHeaderAddContact({ onAdded, existingUsernames, currentUsername, onRefreshContacts, onSubscriptionGate, isTeamActor }: { onAdded: (conv:any)=>void, existingUsernames: string[], currentUsername?: string, onRefreshContacts?: () => void, onSubscriptionGate?: (reason?: string) => void, isTeamActor?: boolean }) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const fetchTimer = useRef<any>(null);
  const menuRef = useRef<HTMLDivElement|null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const triggerSearch = (q: string) => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (!q.trim()) { setResults([]); setError(null); return; }
    fetchTimer.current = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiClient.searchUsers(q.trim());
        const filtered = (Array.isArray(data) ? data : []).filter(u => u && u.username && u.username !== currentUsername);
        setResults(filtered);
      } catch (e:any) {
        setError('تعذر البحث');
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const createConv = async (username: string) => {
    try {
      setLoading(true);
      setError(null);
      const conv = await apiClient.createConversationByUsername(username);
      onAdded && onAdded(conv);
      setOpen(false);
      setQuery('');
      setResults([]);
    } catch (e:any) {
      const msg = (e && e.message) ? e.message : 'تعذر إنشاء المحادثة';
      setError(msg);
      if (e && (e.status === 403 || e.status === 401)) {
        try { onSubscriptionGate && onSubscriptionGate(msg); } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    try { localStorage.removeItem('auth_tokens_v1'); } catch {}
    window.location.href = '/';
  };

  return (
    <div className="p-3 border-b border-chatDivider bg-chatPanel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-gray-100">الدردشات</div>
          <button
            onClick={() => setOpen(o => !o)}
            className="relative group w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200 transition"
            title="محادثة جديدة"
          >
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M12 4v16m8-8H4' />
            </svg>
          </button>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={()=> setMenuOpen(m => !m)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200"
            title="القائمة"
          >
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
              <circle cx='12' cy='5' r='1'/>
              <circle cx='12' cy='12' r='1'/>
              <circle cx='12' cy='19' r='1'/>
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-2 min-w-[160px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
              {!isTeamActor && <a href="/profile" className="block px-3 py-2 text-sm text-gray-100 hover:bg-white/5">بروفايلي</a>}
              {!isTeamActor && <a href="/matches" className="block px-3 py-2 text-sm text-gray-100 hover:bg-white/5">مطابقاتي</a>}
              {!isTeamActor && <a href="/settings" className="block px-3 py-2 text-sm text-gray-100 hover:bg-white/5">الإعدادات</a>}
              {!isTeamActor && <a href="/subscriptions" className="block px-3 py-2 text-sm text-gray-100 hover:bg-white/5">الاشتراك</a>}
              {!isTeamActor && <a href="/team" className="block px-3 py-2 text-sm text-gray-100 hover:bg-white/5">فريق العمل</a>}
              <button onClick={() => { onRefreshContacts && onRefreshContacts(); setMenuOpen(false); }} className="w-full text-right px-3 py-2 text-sm text-gray-100 hover:bg-white/5">تحديث جهات الاتصال</button>
              <button onClick={logout} className="w-full text-right px-3 py-2 text-sm text-red-500  hover:bg-[#ef5350]/10">تسجيل الخروج</button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 bg-chatBg border border-chatDivider rounded-lg p-3">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e)=>{ setQuery(e.target.value); triggerSearch(e.target.value); }}
              onKeyDown={(e)=>{ if (e.key==='Enter' && query.trim()) { createConv(query.trim()); } }}
              placeholder="ابحث باسم المستخدم"
              className="flex-1 bg-chatPanel border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
            <button onClick={()=> triggerSearch(query)} className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-xs">بحث</button>
          </div>
          {loading && <div className="text-[11px] text-gray-400 mt-2">جاري البحث…</div>}
          {error && <div className="text-[11px] text-red-300 mt-2">{error}</div>}
          {(!loading && results.length > 0) && (
            <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-chatDivider/30">
              {results.map(u => (
                <li key={u.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <img src={u.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name||u.username||'U')}&background=0D8ABC&color=fff`} className="w-8 h-8 rounded-full border border-chatDivider" />
                    <div className="text-xs text-gray-100">{u.display_name || u.username}</div>
                  </div>
                  <button onClick={()=> createConv(u.username)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-gray-100 text-[11px]">بدء محادثة</button>
                </li>
              ))}
            </ul>
          )}
          {(!loading && results.length === 0 && query.trim()) && (
            <div className="text-[11px] text-gray-400 mt-2">لا نتائج</div>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordField({ value, onChange, tone = 'dark', inputClassName }: { value: string; onChange: (v:string)=>void; tone?: 'light'|'dark'; inputClassName?: string }) {
  const [show, setShow] = useState(false);
  const iconClasses = tone === 'light'
    ? 'text-orange-300 hover:text-orange-400'
    : 'text-gray-400 hover:text-gray-200';
  const finalInputClass = inputClassName || (tone === 'light'
    ? 'w-full pl-9 pr-3 bg-white/80 border border-orange-200 rounded py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition'
    : 'w-full pl-9 pr-3 bg-chatBg border border-chatDivider rounded py-2 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-green-600');
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className={`absolute inset-y-0 left-0 pl-3 flex items-center transition-colors ${iconClasses}`}
        title={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
      >
        {show ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="w-4 h-4"
            strokeWidth="1.6"
          >
            <path d="M1 1l22 22" strokeLinecap="round" />
            <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84" />
            <path d="M9.88 5.12A10.37 10.37 0 0 1 12 5c7 0 10 7 10 7a18.68 18.68 0 0 1-3.16 4.38" />
            <path d="M6.53 6.53C3.85 8.36 2 12 2 12a18.5 18.5 0 0 0 5.17 5.88" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="w-4 h-4"
            strokeWidth="1.6"
          >
            <path d="M1 12s3-7 11-7 11 7 11 7-3 7-11 7S1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="كلمة المرور"
        type={show ? 'text' : 'password'}
        className={finalInputClass}
      />
    </div>
  );
}

export default function Home() {
  const scrollRef = useRef<HTMLDivElement|null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastMsgIdRef = useRef<number>(0);
  const contactMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const contactLinksFetchedRef = useRef(false);
  const TEXTAREA_MIN_HEIGHT = 40;
  const TEXTAREA_MAX_HEIGHT = 160;

  const adjustTextareaHeight = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(TEXTAREA_MAX_HEIGHT, Math.max(TEXTAREA_MIN_HEIGHT, el.scrollHeight));
    el.style.height = `${next}px`;
  }, []);

  const resetTextareaHeight = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
  }, []);
  // قائمة العملات من الخادم
  const [serverCurrencies, setServerCurrencies] = useState<any[]>([]);
  // Auth/session
  const [isAuthed, setIsAuthed] = useState(false);
  const [authStatus, setAuthStatus] = useState<'checking'|'authed'|'anon'>('checking');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [useTeamLogin, setUseTeamLogin] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('useTeamLogin') === '1'; } catch { return false; }
  });
  const [ownerUsername, setOwnerUsername] = useState('');
  const [teamUsername, setTeamUsername] = useState('');
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [brandingLogo, setBrandingLogo] = useState<string>(DEFAULT_BRANDING_LOGO);
  const [profile, setProfile] = useState<any|null>(null);
  const [contactLinks, setContactLinks] = useState<ContactLinkView[]>([]);
  const { isLight: isLightTheme, toggleTheme } = useThemeMode();

  const mapContactLinks = useCallback((items: ContactLinkDTO[]): ContactLinkView[] => {
    return items
      .map<ContactLinkView | null>((item) => {
        const href = normalizeContactHref(item.icon, item.value);
        if (!href) return null;
        const meta = CONTACT_ICON_META[item.icon] ?? DEFAULT_CONTACT_ICON_META;
        const label = (item.label || '').trim();
        const iconDisplay = (item.icon_display || '').trim();
        const rawValue = (item.value || '').trim();
        const display = label || iconDisplay || rawValue;
        let subtitle = '';
        if (label) {
          subtitle = iconDisplay && iconDisplay !== label ? iconDisplay : rawValue;
        } else if (iconDisplay && iconDisplay !== display) {
          subtitle = iconDisplay;
        } else if (rawValue && rawValue !== display) {
          subtitle = rawValue;
        }
        return {
          ...item,
          label,
          icon_display: iconDisplay,
          value: rawValue,
          href,
          display,
          subtitle: subtitle || undefined,
          meta,
        };
      })
      .filter((entry): entry is ContactLinkView => Boolean(entry));
  }, []);

  // Contacts & conversations
  const [contacts, setContacts] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number|null>(null);
  const [openMenuForConvId, setOpenMenuForConvId] = useState<number|null>(null);
  const [muteBusyFor, setMuteBusyFor] = useState<number|null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: true; kind: 'delete'|'clear'; convId: number } | null>(null);
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  const [showSubBanner, setShowSubBanner] = useState(false);
  const [subBannerMsg, setSubBannerMsg] = useState<string|undefined>(undefined);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number|null>(null);
  const [convMetaById, setConvMetaById] = useState<Record<number, { user_a_id:number; user_b_id:number }>>({});

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState<any[]|null>(null);
  const [netBalance, setNetBalance] = useState<any[]|null>(null);
  const wsRef = useRef<WebSocket|null>(null);
  const [outgoingText, setOutgoingText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<File|null>(null);
  const previewUrlCache = useRef<Map<string, string>>(new Map());
  const [filePreviewCache, setFilePreviewCache] = useState<Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; dataUrl: string | null }>>({});
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [showOnlyTransactions, setShowOnlyTransactions] = useState(false);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const emojiPanelRef = useRef<HTMLDivElement|null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement|null>(null);
  const [topToolsMenuOpen, setTopToolsMenuOpen] = useState(false);
  const topToolsMenuRef = useRef<HTMLDivElement|null>(null);
  const topToolsMenuBtnRef = useRef<HTMLButtonElement|null>(null);
  // Members panel state
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);
  const membersPanelRef = useRef<HTMLDivElement|null>(null);
  const membersBtnRef = useRef<HTMLButtonElement|null>(null);
  const [teamList, setTeamList] = useState<TeamMember[]>([]);
  const [convMembers, setConvMembers] = useState<Array<{ id: number; username: string; display_name: string; role: 'participant' | 'team' | 'team_member'; member_type?: 'user'|'team_member' }>>([]);
  const [membersBusy, setMembersBusy] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);
  const lastMessageIdRef = useRef<number>(0);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'excel'|'pdf'>('excel');
  const [exportDateFrom, setExportDateFrom] = useState<string>('');
  const [exportDateTo, setExportDateTo] = useState<string>('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string|null>(null);
  const exportModalRef = useRef<HTMLDivElement|null>(null);

  useEffect(() => {
    let cancelled = false;
    const resolveLogoUrl = async (raw?: string | null) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return DEFAULT_BRANDING_LOGO;
      let candidate = trimmed;
      try {
        if (typeof window !== 'undefined') {
          if (candidate.startsWith('//')) {
            candidate = `${window.location.protocol}${candidate}`;
          } else if (!/^https?:\/\//i.test(candidate)) {
            const base = apiClient.baseUrl.replace(/\/$/, '');
            candidate = `${base}/${candidate.replace(/^\/+/, '')}`;
          }
          if (window.location.protocol === 'https:' && candidate.startsWith('http://')) {
            candidate = 'https://' + candidate.slice('http://'.length);
          }
        } else if (!/^https?:\/\//i.test(candidate)) {
          candidate = `${apiClient.baseUrl.replace(/\/$/, '')}/${candidate.replace(/^\/+/, '')}`;
        }
        const canLoad = await new Promise<boolean>((resolve) => {
          if (typeof window === 'undefined' || typeof Image === 'undefined') {
            resolve(true);
            return;
          }
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = candidate;
        });
        return canLoad ? candidate : DEFAULT_BRANDING_LOGO;
      } catch {
        return DEFAULT_BRANDING_LOGO;
      }
    };
    (async () => {
      try {
        const data = await apiClient.getBranding();
        if (cancelled) return;
        const resolved = await resolveLogoUrl(data?.logo_url ?? null);
        if (!cancelled) setBrandingLogo(resolved);
      } catch {
        if (!cancelled) setBrandingLogo(DEFAULT_BRANDING_LOGO);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isAuthed || contactLinksFetchedRef.current) return;
    contactLinksFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const raw = await apiClient.getContactLinks();
        if (cancelled) return;
        setContactLinks(mapContactLinks(raw));
      } catch {
        if (cancelled) return;
        setContactLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed, mapContactLinks]);
  // Decode JWT access payload
  const getJwtPayload = useCallback((): any | null => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const access: string | undefined = parsed?.access;
      if (!access) return null;
      const parts = access.split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '==='.slice((base64.length + 3) % 4);
      const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch { return null; }
  }, []);

  // Current sender display: prefer team member name if acting as team member
  const currentSenderDisplay = useMemo(() => {
    const fallback = (profile?.display_name || profile?.username) || undefined;
    const payload = getJwtPayload();
    if (payload && payload.actor === 'team_member' && typeof payload.team_member_id === 'number') {
      const tm = teamList.find(t => t && t.id === payload.team_member_id);
      if (tm) return (tm.display_name || tm.username) || fallback;
    }
    return fallback;
  }, [profile?.display_name, profile?.username, getJwtPayload, teamList]);

  // Close members panel when clicking outside it or its toggle button
  useEffect(() => {
    if (!membersPanelOpen) return;
    const onDocPointer = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      const pane = membersPanelRef.current;
      const btn = membersBtnRef.current;
      if (!target) return;
      if (pane && pane.contains(target)) return; // inside panel
      if (btn && btn.contains(target)) return; // the toggle button itself
      setMembersPanelOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('touchstart', onDocPointer, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('touchstart', onDocPointer, true);
    };
  }, [membersPanelOpen]);

  useEffect(() => {
    if (!emojiPanelOpen) return;
    const onDocPointer = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      const pane = emojiPanelRef.current;
      const btn = emojiButtonRef.current;
      if (!target) return;
      if (pane && pane.contains(target)) return;
      if (btn && btn.contains(target)) return;
      setEmojiPanelOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('touchstart', onDocPointer, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('touchstart', onDocPointer, true);
    };
  }, [emojiPanelOpen]);

  useEffect(() => {
    if (!topToolsMenuOpen) return;
    const onDocPointer = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      const menu = topToolsMenuRef.current;
      const btn = topToolsMenuBtnRef.current;
      if (!target) return;
      if (menu && menu.contains(target)) return;
      if (btn && btn.contains(target)) return;
      setTopToolsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('touchstart', onDocPointer, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('touchstart', onDocPointer, true);
    };
  }, [topToolsMenuOpen]);

  useEffect(() => {
    if (!exportModalOpen) return;
    const onDocPointer = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      const modal = exportModalRef.current;
      if (!target || !modal) return;
      if (modal.contains(target)) return;
      setExportModalOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('touchstart', onDocPointer, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('touchstart', onDocPointer, true);
    };
  }, [exportModalOpen]);

  useEffect(() => {
    if (exportModalOpen) return;
    setExportBusy(false);
    setExportError(null);
  }, [exportModalOpen]);

  useEffect(() => {
    setEmojiPanelOpen(false);
    setShowOnlyTransactions(false);
    setTopToolsMenuOpen(false);
  }, [selectedConversationId]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [outgoingText, adjustTextareaHeight]);

  useEffect(() => {
    if (openMenuForConvId == null) return;
    const handleOutside = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      const container = contactMenuRefs.current[openMenuForConvId];
      if (container && container.contains(target)) return;
      setOpenMenuForConvId(null);
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('touchstart', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('touchstart', handleOutside, true);
    };
  }, [openMenuForConvId]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setEmojiPanelOpen(false);
        setMembersPanelOpen(false);
        setTopToolsMenuOpen(false);
        setExportModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // هل الحساب الحالي هو عضو فريق؟ احسبها في كل رندر لضمان التزامن مع تغيّر التوكن
  const isTeamActor = (() => {
    try {
      const payload = getJwtPayload();
      return !!(payload && payload.actor === 'team_member');
    } catch { return false; }
  })();

  // Ensure team list is available when acting as team member (for display names)
  useEffect(() => {
    if (!isAuthed) return;
    const payload = getJwtPayload();
    if (payload && payload.actor === 'team_member' && (!teamList || teamList.length === 0)) {
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
        const access = raw ? (JSON.parse(raw)?.access as string) : '';
        if (access) {
          listTeam(access).then(list => setTeamList(Array.isArray(list) ? list : [])).catch(()=>{});
        }
      } catch {}
    }
  }, [isAuthed, getJwtPayload]);

  // Helper: Refresh summary, net balance, and pair wallet for a conversation
  const refreshConvAggregates = useCallback(async (convId: number) => {
    try {
      const [s, n] = await Promise.all([
        apiClient.getSummary(convId),
        apiClient.getNetBalance(convId),
      ]);
      setSummary(s.summary || []);
      setNetBalance(n.net || []);
      // ensure meta (user_a/user_b) exists
      let metaForConv = convMetaById[convId];
      if (!metaForConv) {
        try {
          const conv = await apiClient.getConversation(convId);
          if (conv && conv.user_a && conv.user_b) {
            metaForConv = { user_a_id: conv.user_a.id, user_b_id: conv.user_b.id };
            setConvMetaById(prev => ({ ...prev, [convId]: metaForConv! }));
          }
        } catch {}
      }
      // rebuild pair wallet from net rows from the perspective of current user
      const pair: Record<string, number> = { ...initialWallet };
      const rows = Array.isArray((n as any)?.net) ? (n as any).net : [];
      const flip = (metaForConv && profile?.id)
        ? (profile.id === metaForConv.user_a_id ? 1 : -1)
        : 1;
      for (const row of rows) {
        const code = row?.currency?.code;
        const valRaw = row?.net_from_user_a_perspective;
        const val = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
        if (code) pair[code] = isNaN(val) ? 0 : Number((flip * val).toFixed(5));
      }
      setPairWalletByConv(prev => ({ ...prev, [convId]: pair }));
    } catch {}
  }, [apiClient, convMetaById, profile?.id]);

  // Toasts
  type Toast = { id: string; type: 'success'|'error'|'info'; msg: string };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (t: { type: 'success'|'error'|'info'; msg: string }) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000);
  };

  // Center alerts (overlay) for member add/remove
  type CenterAlert = { id: string; type: 'added'|'removed'|'info'; msg: string };
  const [centerAlerts, setCenterAlerts] = useState<CenterAlert[]>([]);
  const pushCenterAlert = (t: { type: 'added'|'removed'|'info'; msg: string }, ttlMs: number = 3000) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setCenterAlerts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setCenterAlerts(prev => prev.filter(x => x.id !== id)), ttlMs);
  };

  // Detect member add/remove from system text (best-effort Arabic patterns)
  const detectMemberChange = (text: string): { action: 'added'|'removed'; name?: string } | null => {
    try {
      const t = (text || '').trim();
      const rem = t.match(/إزالة\s+([^\s]+)\s+من\s+المحادثة/);
      if (rem) return { action: 'removed', name: rem[1] };
      const add1 = t.match(/إضافة\s+([^\s]+)\s+عضو\s+الفريق/);
      if (add1) return { action: 'added', name: add1[1] };
      const addAlt = t.match(/إضافة\s+عضو\s+الفريق\s+([^\s]+)/);
      if (addAlt) return { action: 'added', name: addAlt[1] };
      const add2 = t.match(/إضافة\s+([^\s]+)\s+إلى\s+المحادثة/);
      if (add2) return { action: 'added', name: add2[1] };
    } catch {}
    return null;
  };

  // Lightbox for image attachments
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const buildImageItems = () => {
    const items: { url: string; name?: string }[] = [];
    messages.forEach(m => {
      if (m.attachment && m.attachment.url && m.attachment.mime && m.attachment.mime.startsWith('image/')) {
        items.push({ url: m.attachment.url, name: m.attachment.name });
      }
    });
    return items;
  };
  const openImageAt = (url: string) => {
    const items = buildImageItems();
    const idx = items.findIndex(it => it.url === url);
    setLightboxIndex(idx === -1 ? 0 : idx);
    setLightboxOpen(true);
  };

  const openExportDialog = () => {
    if (!selectedConversationId || !currentContact) return;
    const now = new Date();
    const toDefault = toDateInputValue(now);
    const fromDefault = toDateInputValue(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    setExportDateFrom(fromDefault);
    setExportDateTo(toDefault);
    setExportFormat('excel');
    setExportError(null);
    setExportBusy(false);
    setExportModalOpen(true);
  };

  type ExportRow = {
    index: number;
    senderName: string;
    directionLabel: 'لنا' | 'لكم';
    amountDisplay: string;
    amountNumber: number;
    positive: boolean;
    dateTimeDisplay: string;
    noteText: string;
    createdAtISO?: string;
  };

  const safeFilename = (raw: string, ext: string) => {
    const sanitized = raw
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^0-9A-Za-z\u0600-\u06FF_-]+/g, '');
    const base = sanitized || 'transactions';
    return `${base}.${ext}`;
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportRowsToExcel = async (
    rows: ExportRow[],
    parties: { a: string; b: string },
    rangeLabel: string,
    filename: string,
  ) => {
    const excelModule = await import('exceljs');
    const WorkbookCtor = (excelModule as any).Workbook || (excelModule as any).default?.Workbook;
    if (!WorkbookCtor) {
      throw new Error('ExcelJS Workbook not available');
    }
    const workbook = new WorkbookCtor();
    const sheet = workbook.addWorksheet('التقرير', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
    });

    sheet.columns = [
      { header: 'رقم المعاملة', key: 'index', width: 15 },
      { header: 'اسم المرسل', key: 'sender', width: 28 },
      { header: 'لمن', key: 'direction', width: 16 },
      { header: 'المبلغ و العملة', key: 'amount', width: 24 },
      { header: 'ملاحظة', key: 'note', width: 32 },
      { header: 'التاريخ و الوقت', key: 'datetime', width: 26 },
    ];

    sheet.mergeCells(1, 1, 1, 6);
    const titleCell = sheet.getCell('A1');
    titleCell.value = `معاملات مالية بين ${parties.a} و ${parties.b}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 24;

    const headerRow = sheet.getRow(2);
    headerRow.values = [
      'رقم المعاملة',
      'اسم المرسل',
      'لمن',
      'المبلغ و العملة',
      'ملاحظة',
      'التاريخ و الوقت',
    ];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  headerRow.eachCell((cell: any) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF1F2937' } },
        bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
        left: { style: 'thin', color: { argb: 'FF1F2937' } },
        right: { style: 'thin', color: { argb: 'FF1F2937' } },
      };
    });

    const zebraFillA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } as const;
    const zebraFillB = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as const;

    rows.forEach((row) => {
      const excelRow = sheet.addRow({
        index: row.index,
        sender: row.senderName,
        direction: row.directionLabel,
        amount: row.amountDisplay,
        note: row.noteText,
        datetime: row.dateTimeDisplay,
      });
      excelRow.alignment = { horizontal: 'center', vertical: 'middle' };
  excelRow.eachCell((cell: any) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
      excelRow.fill = row.index % 2 === 0 ? zebraFillA : zebraFillB;
      const directionCell = excelRow.getCell(3);
      directionCell.font = {
        bold: true,
        color: { argb: row.positive ? 'FF16A34A' : 'FFE11D48' },
      };
      const amountCell = excelRow.getCell(4);
      amountCell.font = {
        bold: true,
        color: { argb: row.positive ? 'FF16A34A' : 'FFE11D48' },
      };
    });

    if (rangeLabel) {
      const infoRow = sheet.addRow(['', '', '', '', '', rangeLabel]);
      infoRow.getCell(6).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
      infoRow.alignment = { horizontal: 'left' };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    triggerDownload(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    );
  };

  const exportRowsToPdf = async (
    rows: ExportRow[],
    parties: { a: string; b: string },
    rangeLabel: string,
    filename: string,
  ) => {
    const [html2canvasModule, jsPDFModule] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const html2canvas = (html2canvasModule as any).default || html2canvasModule;
    const jsPDFCtor = (jsPDFModule as any).default || (jsPDFModule as any).jsPDF;
    if (typeof html2canvas !== 'function' || typeof jsPDFCtor !== 'function') {
      throw new Error('PDF dependencies not available');
    }

    const container = document.createElement('div');
    container.dir = 'rtl';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.backgroundColor = '#ffffff';
    container.style.padding = '32px';
    container.style.width = '794px';
    container.style.fontFamily = `'Tajawal', 'Cairo', 'Segoe UI', sans-serif`;
    container.style.color = '#0f172a';
    container.style.border = '1px solid #e2e8f0';
    container.style.borderRadius = '18px';
    container.style.boxShadow = '0 24px 48px rgba(15, 31, 37, 0.12)';
    container.style.textAlign = 'right';

    const titleEl = document.createElement('div');
    titleEl.innerText = `معاملات مالية بين ${parties.a} و ${parties.b}`;
    titleEl.style.fontSize = '20px';
    titleEl.style.fontWeight = '700';
    titleEl.style.marginBottom = '12px';
    titleEl.style.textAlign = 'center';
    container.appendChild(titleEl);

    if (rangeLabel) {
      const rangeEl = document.createElement('div');
      rangeEl.innerText = rangeLabel;
      rangeEl.style.fontSize = '12px';
      rangeEl.style.color = '#64748b';
      rangeEl.style.marginBottom = '18px';
      rangeEl.style.textAlign = 'center';
      container.appendChild(rangeEl);
    }

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '12px';
    table.style.overflow = 'hidden';
    table.style.borderRadius = '12px';

  const headers = ['رقم المعاملة', 'اسم المرسل', 'لمن', 'المبلغ و العملة', 'ملاحظة', 'التاريخ و الوقت'];
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((text) => {
      const th = document.createElement('th');
      th.innerText = text;
      th.style.padding = '12px 10px';
      th.style.backgroundColor = '#102030';
      th.style.color = '#f8fafc';
      th.style.fontWeight = '600';
      th.style.border = '1px solid #0f172a';
      th.style.textAlign = 'center';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.style.backgroundColor = row.index % 2 === 0 ? '#f8fafc' : '#ffffff';
      const cells = [
        row.index.toString(),
        row.senderName,
        row.directionLabel,
        row.amountDisplay,
        row.noteText,
        row.dateTimeDisplay,
      ];
      cells.forEach((val, idx) => {
        const td = document.createElement('td');
        td.innerText = val;
        td.style.padding = '12px 10px';
        td.style.border = '1px solid #e2e8f0';
        td.style.textAlign = 'center';
        td.style.fontWeight = idx === 2 || idx === 3 ? '600' : '500';
        if (idx === 2 || idx === 3) {
          td.style.color = row.positive ? '#059669' : '#dc2626';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png', 1.0);
  const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const maxWidth = pageWidth - 60;
      const maxHeight = pageHeight - 60;
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const renderWidth = canvas.width * ratio;
      const renderHeight = canvas.height * ratio;
      const offsetX = (pageWidth - renderWidth) / 2;
      const offsetY = (pageHeight - renderHeight) / 2;
      pdf.addImage(imgData, 'PNG', offsetX, offsetY, renderWidth, renderHeight, undefined, 'FAST');
      pdf.save(filename);
    } finally {
      document.body.removeChild(container);
    }
  };

  const handleConfirmExport = async () => {
    if (!selectedConversationId || !currentContact) {
      setExportModalOpen(false);
      return;
    }
    if (!exportDateFrom || !exportDateTo) {
      setExportError('يرجى اختيار تاريخ البداية والنهاية');
      return;
    }
    const fromDate = new Date(`${exportDateFrom}T00:00:00`);
    const toDate = new Date(`${exportDateTo}T23:59:59`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      setExportError('تنسيق التاريخ غير صالح');
      return;
    }
    if (fromDate > toDate) {
      setExportError('تاريخ البداية يجب أن يسبق تاريخ النهاية');
      return;
    }

    setExportBusy(true);
    setExportError(null);
    try {
      const response = await (async () => {
        const maybeClient: any = apiClient as any;
        if (maybeClient && typeof maybeClient.getTransactions === 'function') {
          return maybeClient.getTransactions(selectedConversationId, {
            from: exportDateFrom,
            to: exportDateTo,
          });
        }
        const params = new URLSearchParams();
        params.set('conversation', String(selectedConversationId));
        if (exportDateFrom) params.set('from_date', exportDateFrom);
        if (exportDateTo) params.set('to_date', exportDateTo);
        params.set('ordering', 'created_at');
        const qs = params.toString();
        if (!maybeClient || typeof maybeClient.authFetch !== 'function') {
          throw new Error('واجهة التصدير غير متاحة حالياً');
        }
        const res: Response = await maybeClient.authFetch(`/api/transactions/${qs ? `?${qs}` : ''}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err: any = new Error((data && (data.detail || data.error)) || 'تعذر جلب المعاملات');
          err.status = res.status;
          err.response = data;
          throw err;
        }
        return data;
      })();
      const rawList: any[] = Array.isArray((response as any)?.results)
        ? (response as any).results
        : Array.isArray(response)
          ? response
          : [];

      const viewerName = (profile?.display_name || profile?.username || 'أنا').trim() || 'أنا';
      const otherName = (currentContact?.name || currentContact?.otherUsername || 'جهة').trim() || 'جهة';
      const viewerId = profile?.id ?? null;
      const metaForConv = convMetaById[selectedConversationId] || null;
      const fallbackUnknownName = 'غير محدد';
      const pickDisplayName = (info: any) => {
        if (!info) return '';
        const candidates = [
          typeof info.display_name === 'string' ? info.display_name : '',
          (() => {
            const first = typeof info.first_name === 'string' ? info.first_name : '';
            const last = typeof info.last_name === 'string' ? info.last_name : '';
            const combined = `${first} ${last}`.trim();
            return combined && combined !== info.username ? combined : '';
          })(),
          typeof info.first_name === 'string' ? info.first_name : '',
          typeof info.username === 'string' ? info.username : '',
        ];
        for (const candidate of candidates) {
          if (candidate && candidate.trim()) return candidate.trim();
        }
        return '';
      };
      const fallbackNameForId = (userId: number | null) => {
        if (userId == null) return '';
        if (viewerId != null && userId === viewerId) return viewerName;
        if (metaForConv) {
          const { user_a_id, user_b_id } = metaForConv;
          if (userId === user_a_id || userId === user_b_id) {
            return userId === viewerId ? viewerName : otherName;
          }
        }
        return otherName;
      };

      const rows: ExportRow[] = rawList.reduce<ExportRow[]>((acc, item: any, idx: number) => {
        if (!item) return acc;
        const directionRaw = (item.direction || '').toString().trim();
        const direction: 'lna' | 'lkm' = directionRaw === 'lkm' ? 'lkm' : 'lna';
        const fromId: number | null = typeof item.from_user === 'number'
          ? item.from_user
          : (item.from_user_info?.id ?? null);
        const toId: number | null = typeof item.to_user === 'number'
          ? item.to_user
          : (item.to_user_info?.id ?? null);

        const directionLabelRaw = (item.direction_label || '').toString().trim();
        const normalizedDirectionLabel: 'لنا' | 'لكم' = directionLabelRaw === 'لكم' ? 'لكم' : 'لنا';
        const positive = normalizedDirectionLabel === 'لنا';

        const amountSource = item.amount_value ?? item.amount ?? 0;
        const amountNumber = typeof amountSource === 'number'
          ? amountSource
          : parseFloat(String(amountSource || 0));
        const currencySymbol = (item.currency && (item.currency.symbol || item.currency.code)) || '';
        const amountLabel = `${formatMoneyValue(Math.abs(Number.isFinite(amountNumber) ? amountNumber : 0))}${currencySymbol ? ` ${currencySymbol}` : ''}`;
        const createdAtIso = typeof item.created_at === 'string' ? item.created_at : undefined;
        const senderName = pickDisplayName(item.from_user_info) || fallbackNameForId(fromId) || fallbackUnknownName;

        const noteTextRaw = typeof item.note === 'string' ? item.note : (typeof item.description === 'string' ? item.description : '');
        const noteText = (noteTextRaw || '').toString().trim();

        acc.push({
          index: idx + 1,
          senderName,
          directionLabel: positive ? ('لنا' as const) : ('لكم' as const),
          amountDisplay: amountLabel,
          amountNumber: Math.abs(Number.isFinite(amountNumber) ? amountNumber : 0),
          positive,
          noteText,
          dateTimeDisplay: createdAtIso ? formatDateTimeLabel(createdAtIso) : '',
          createdAtISO: createdAtIso,
        });
        return acc;
      }, []);

      const sorted = rows
        .slice()
        .sort((a, b) => {
          const aTime = a.createdAtISO ? new Date(a.createdAtISO).getTime() : 0;
          const bTime = b.createdAtISO ? new Date(b.createdAtISO).getTime() : 0;
          return aTime - bTime;
        })
        .map((row, idx) => ({ ...row, index: idx + 1 }));

      if (!sorted.length) {
        pushToast({ type: 'info', msg: 'لا توجد معاملات ضمن النطاق المحدد' });
        setExportModalOpen(false);
        return;
      }

      const rangeLabel = `الفترة: ${exportDateFrom} → ${exportDateTo}`;
      const filename = safeFilename(
        `transactions_${selectedConversationId}_${exportFormat === 'excel' ? 'excel' : 'pdf'}_${exportDateFrom}_${exportDateTo}`,
        exportFormat === 'excel' ? 'xlsx' : 'pdf',
      );

      if (exportFormat === 'excel') {
        await exportRowsToExcel(sorted, { a: viewerName, b: otherName }, rangeLabel, filename);
      } else {
        await exportRowsToPdf(sorted, { a: viewerName, b: otherName }, rangeLabel, filename);
      }

      pushToast({
        type: 'success',
        msg: exportFormat === 'excel' ? 'تم إنشاء ملف Excel وحفظه في التنزيلات' : 'تم إنشاء ملف PDF وحفظه في التنزيلات',
      });
      setExportModalOpen(false);
    } catch (err: any) {
      const msg = err?.message || 'تعذر إكمال التصدير';
      setExportError(msg);
    } finally {
      setExportBusy(false);
    }
  };

  // Transactions UI state
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [amountOurs, setAmountOurs] = useState('');
  const [amountYours, setAmountYours] = useState('');
  const [txLoading, setTxLoading] = useState(false);
  const [pendingCurrencies, setPendingCurrencies] = useState<Set<string>>(new Set());

  // Initial auth check and audio priming
  useEffect(() => {
  (async () => {
      try {
        const me = await apiClient.getProfile().catch(() => null);
        if (me) {
          setProfile(me);
          setIsAuthed(true);
          setAuthStatus('authed');
        } else {
          setIsAuthed(false);
          setAuthStatus('anon');
        }
      } catch {
        setIsAuthed(false);
        setAuthStatus('anon');
      }
    })();
    try { attachPrimingListeners(); } catch {}
    // Load admin-configured notification sound (if any) so the whole app uses it, not only Settings page
    (async () => { try { const url = await apiClient.getNotificationSoundUrl(); if (url) setRuntimeSoundUrl(url); } catch {} })();
  }, []);
  // إرسال عبر Pusher HTTP API
  const sendChat = async () => {
    if (!selectedConversationId) return;
    // إذا كان هناك مرفق قيد الانتظار، أرسله (مع التسمية التوضيحية إن وُجدت)
    if (pendingAttachment) {
      const f = pendingAttachment;
      const caption = outgoingText.trim();
      // أضف فقاعة تفاؤلية للمرفق
      const clientId = `attach_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const previewText = caption || f.name;
      const previewLabel = previewFromMessage(caption, { name: f.name });
  setMessages(prev => [...prev, { sender: 'current', text: previewText, client_id: clientId, status: 'sending', delivery_status: 0, kind: 'text', senderDisplay: currentSenderDisplay, attachment: { name: f.name, mime: f.type, size: f.size }, read_at: null }]);
      applyConversationPreview(selectedConversationId, previewLabel, new Date().toISOString());
      const doUpload = async (maybeOtp?: string) => {
        try {
          const res = await apiClient.uploadConversationAttachment(selectedConversationId, f, caption || undefined, maybeOtp, clientId);
          setMessages(prev => {
            const copy = [...prev];
            let patchedIndex = -1;
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i];
              if (m.client_id === clientId) {
                // Patch attachment info and, if no caption was provided, remove the provisional filename text
                const serverClientId = (res && typeof res.client_id === 'string' && res.client_id) ? res.client_id : m.client_id;
                const patched: any = {
                  ...m,
                  id: typeof res?.id === 'number' ? res.id : m.id,
                  client_id: serverClientId,
                  attachment: {
                    url: res.attachment_url || null,
                    name: res.attachment_name,
                    mime: res.attachment_mime,
                    size: res.attachment_size,
                  },
                };
                if (!caption) patched.text = '';
                copy[i] = patched;
                patchedIndex = i;
                break;
              }
            }
            if (typeof res?.id === 'number' && patchedIndex !== -1) {
              return copy.filter((msg, idx) => {
                if (idx === patchedIndex) return true;
                return !(msg && typeof msg.id === 'number' && msg.id === res.id && msg.client_id !== clientId);
              });
            }
            return copy;
          });
          // نظّف الحقول بعد النجاح
          setPendingAttachment(null);
          setOutgoingText('');
          resetTextareaHeight();
        } catch (err:any) {
          if (err && err.otp_required) {
            const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز المصادقة الثنائية (OTP)') : '';
            if (code) return doUpload(code);
          } else if (err && (err.status === 403 || err.status === 401)) {
            setSubBannerMsg(err.message || 'حسابك بحاجة لاشتراك نشط. يمكنك مراسلة الأدمن فقط.');
            setShowSubBanner(true);
          }
          // Failure path: keep message but already considered delivered=1 (no distinct 'sent' state)
          setMessages(prev => prev.map(m => m.client_id === clientId ? { ...m, delivery_status: 1 } as any : m));
          pushToast({ type: 'error', msg: err?.message || 'فشل رفع الملف' });
        }
      };
      await doUpload();
      return;
    }

    // بدون مرفق: أرسل كنص عادي إذا كان هناك نص
    if (!outgoingText.trim()) return;
    const text = outgoingText.trim();
    setOutgoingText('');
  resetTextareaHeight();
    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const previewLabel = previewFromMessage(text);
  setMessages(prev => [...prev, { sender: 'current', text, client_id: clientId, delivery_status: 1, status: 'delivered', kind: 'text', senderDisplay: currentSenderDisplay, read_at: null }]);
    applyConversationPreview(selectedConversationId, previewLabel, new Date().toISOString());
    let serverMessage: any = null;
    try {
      try {
  serverMessage = await apiClient.sendMessage(selectedConversationId, text, undefined, clientId);
      } catch (err:any) {
        if (err && err.otp_required) {
          const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) لإرسال الرسالة') : '';
          if (!code) throw err;
          serverMessage = await apiClient.sendMessage(selectedConversationId, text, code, clientId);
        } else if (err && (err.status === 403 || err.status === 401)) {
          setSubBannerMsg(err.message || 'حسابك بحاجة لاشتراك نشط. يمكنك مراسلة الأدمن فقط.');
          setShowSubBanner(true);
          throw err;
        } else {
          throw err;
        }
      }
      setMessages(prev => prev.map(m => {
        if (!(m.sender === 'current' && m.client_id === clientId)) return m;
        const srv = serverMessage || {};
        const srvId = typeof srv.id === 'number' ? srv.id : m.id;
        const srvText = typeof srv.body === 'string' && srv.body.trim() ? srv.body : m.text;
        const srvCreatedAt = typeof srv.created_at === 'string' ? srv.created_at : (m.created_at || new Date().toISOString());
        const srvDelivery = typeof srv.delivery_status === 'number'
          ? srv.delivery_status
          : ((srv.status === 'read') ? 2 : (srv.status === 'delivered' ? 1 : m.delivery_status || 1));
        const normalizedDelivery = Math.max(m.delivery_status || 0, srvDelivery || 0);
        const normalizedStatus = srv.status || (normalizedDelivery >= 2 ? 'read' : normalizedDelivery >= 1 ? 'delivered' : 'sent');
        const srvReadAt = typeof srv.read_at === 'string' ? srv.read_at : m.read_at;
        const srvDeliveredAt = typeof srv.delivered_at === 'string' ? srv.delivered_at : m.delivered_at;
        const srvClient = typeof srv.client_id === 'string' && srv.client_id ? srv.client_id : m.client_id;
        return {
          ...m,
          id: srvId,
          client_id: srvClient,
          text: srvText,
          created_at: srvCreatedAt,
          delivery_status: normalizedDelivery,
          status: normalizedStatus,
          read_at: srvReadAt || null,
          delivered_at: srvDeliveredAt || null,
        } as any;
      }));
    } catch (e:any) {
      pushToast({ type: 'error', msg: e?.message || 'تعذر إرسال الرسالة' });
    }
  };
  // إرسال حالة الكتابة عبر WS عند الكتابة في الحقل
  const onChangeOutgoing = (val: string) => {
    setOutgoingText(val);
    const now = Date.now();
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN && now - lastTypingSentRef.current > 1200) {
      try { socket.send(JSON.stringify({ type: 'typing', state: 'start' })); lastTypingSentRef.current = now; } catch {}
    }
  };
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'list'>('list'); // عرض قائمة الدردشات أولاً على الجوال
  const [currentContactIndex, setCurrentContactIndex] = useState<number|null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement|null>(null);
  const currentContact = currentContactIndex !== null ? contacts[currentContactIndex] : null;
  const appendEmoji = useCallback((emoji: string) => {
    setOutgoingText(prev => {
      const el = textAreaRef.current;
      if (!el) return prev + emoji;
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : prev.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : prev.length;
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      requestAnimationFrame(() => {
        try {
          el.focus();
          const caret = start + emoji.length;
          el.selectionStart = caret;
          el.selectionEnd = caret;
          el.style.height = 'auto';
          el.style.height = Math.min(160, el.scrollHeight) + 'px';
        } catch {
          try { el.focus(); } catch {}
        }
      });
      return next;
    });
  }, []);
  const [lastSeenMessageId, setLastSeenMessageId] = useState<number | null>(null);
  const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(false); // إظهار/إخفاء القائمة على الموبايل
  const [noteText, setNoteText] = useState('');
  const subscriptionCtaClass = isLightTheme
    ? 'md:ml-auto ml-0 mt-1 md:mt-0 px-2 py-1 rounded border border-rose-300 hover:bg-rose-100 text-red-00 font-semibold shrink-0'
    : 'md:ml-auto ml-0 mt-1 md:mt-0 px-2 py-1 rounded border border-rose-600/40 bg-gray-500/10 hover:bg-rose-500/20 text-rose-200 font-semibold shrink-0';
  const subscriptionCtaStyle = isLightTheme ? { color: '#da6324ff' } : undefined;
  const greenActionButtonClass = isLightTheme
    ? 'rounded-lg border border-[#bce6cf] bg-[#ecfaf3] hover:bg-[#dbf4e7] text-[#1f7c54] shadow-sm'
    : 'rounded-lg bg-green-500/20 hover:bg-green-500/30 backdrop-blur-sm border border-green-400/30 text-green-300';
  // أزلنا ميزة إظهار/إخفاء حقل المعاملات — ستبقى ظاهرة دائماً
  const contactsSigRef = useRef<string>('');
  const [pendingDeleteByConv, setPendingDeleteByConv] = useState<Record<number, { from: string; at: string }>>({});
  const [unreadByConv, setUnreadByConv] = useState<Record<number, number>>({});
  const totalUnread = useMemo(() => Object.values(unreadByConv).reduce((a,b)=>a+(b||0), 0), [unreadByConv]);
  const [unreadRestored, setUnreadRestored] = useState(false);
  // بحث داخل المحادثة الحالية
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  const visibleMessages = useMemo(() => {
    if (!showOnlyTransactions) return messages;
    return messages.filter(m => m?.kind === 'transaction');
  }, [messages, showOnlyTransactions]);
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query) return text;
    try {
      const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      const parts = text.split(re);
      return parts.map((part, idx) => (
        idx % 2 === 1
          ? (
            <span
              key={idx}
              className="bg-amber-300/70 text-gray-900 rounded px-1 font-semibold"
            >
              {part}
            </span>
          )
          : <span key={idx}>{part}</span>
      ));
    } catch { return text; }
  };

  const resolveMessageRefKey = useCallback((msg: any, idx: number) => {
    if (isWalletSettlementMessage(msg)) return buildMessageKey(msg, idx, 'wallet');
    if (msg?.kind === 'transaction' && msg.tx) return buildMessageKey(msg, idx, 'tx');
    if (msg?.kind === 'system') return buildMessageKey(msg, idx, 'sys');
    return buildMessageKey(msg, idx, 'msg');
  }, []);

  // Manual refresh of conversations/contacts mapping
  const refreshContacts = async () => {
    try {
      const convArr = await apiClient.listConversations();
      setConversations(convArr);
      const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
      for (const c of convArr) {
        if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
      }
      setConvMetaById(meta);
      const mapped = convArr.map((c: any) => {
        const meId = profile?.id;
        let other = c.user_a;
        if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
        return {
          id: c.id,
          otherUserId: other?.id,
          otherUsername: other?.username,
          name: other?.display_name || other?.username || other?.email || 'مستخدم',
          avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
          last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
          isMuted: !!(c as any).isMuted,
          mutedUntil: (c as any).mutedUntil ?? null,
        };
      });
      setContacts(mapped);
      pushToast({ type: 'success', msg: 'تم تحديث جهات الاتصال' });
    } catch {
      pushToast({ type: 'error', msg: 'تعذر تحديث جهات الاتصال' });
    }
  };
  const previewFromMessage = useCallback((body?: string | null, attachment?: { name?: string | null }) => {
    const text = (body ?? '').toString().trim();
    if (text) return text;
    const name = typeof attachment?.name === 'string' ? attachment.name.trim() : '';
    if (name) return `📎 ${name}`;
    return attachment ? '📎 ملف مرفق' : '';
  }, []);

  const generateAttachmentPreview = useCallback(async (attachment: AttachmentLike) => {
    if (!attachment || !attachment.url) return null;
    const url = attachment.url;
    const cache = previewUrlCache.current;
    if (cache.has(url)) {
      return cache.get(url) || null;
    }
    if (isPdfAttachment(attachment)) {
      const dataUrl = await renderPdfToDataUrl(url);
      if (dataUrl) {
        cache.set(url, dataUrl);
      }
      return dataUrl;
    }
    return null;
  }, []);

  const requestAttachmentPreview = useCallback((key: string, attachment: AttachmentLike) => {
    setFilePreviewCache(prev => {
      const existing = prev[key];
      if (existing && existing.status !== 'idle') {
        return prev;
      }
      return { ...prev, [key]: { status: 'loading', dataUrl: existing?.dataUrl ?? null } };
    });
    (async () => {
      try {
        const dataUrl = await generateAttachmentPreview(attachment);
        setFilePreviewCache(prev => ({
          ...prev,
          [key]: dataUrl ? { status: 'ready', dataUrl } : { status: 'error', dataUrl: null },
        }));
      } catch (err) {
        console.error('خطأ أثناء إنشاء معاينة المرفق', err);
        setFilePreviewCache(prev => ({ ...prev, [key]: { status: 'error', dataUrl: null } }));
      }
    })();
  }, [generateAttachmentPreview]);

  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    messages.forEach((msg, idx) => {
      const attachment = (msg && typeof msg === 'object') ? (msg.attachment as AttachmentLike | undefined) : undefined;
      if (!isPreviewableAttachment(attachment)) return;
      const safeAttachment = attachment as AttachmentLike;
      const previewKey = buildMessageKey(msg, idx, 'preview');
      const entry = filePreviewCache[previewKey];
      if (!entry) {
        requestAttachmentPreview(previewKey, safeAttachment);
      }
    });
  }, [messages, filePreviewCache, requestAttachmentPreview]);

  const applyConversationPreview = useCallback((convId: number, preview: string, createdAt?: string) => {
    if (!convId) return;
    const ts = createdAt || new Date().toISOString();
    const value = (preview ?? '').toString();
    const finalPreview = value.trim() || value;
    setContacts(prev => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(contact => {
        if (contact.id !== convId) return contact;
        changed = true;
        return { ...contact, last_message_preview: finalPreview, last_message_at: ts };
      });
      return changed ? next : prev;
    });
    setConversations(prev => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(conv => {
        if (!conv || conv.id !== convId) return conv;
        changed = true;
        return { ...conv, last_message_preview: finalPreview, last_message_at: ts };
      });
      return changed ? next : prev;
    });
  }, [setContacts, setConversations]);
  // أرصدة المحافظ (مثال مبدئي)
  const initialWallet = { USD: 0, TRY: 0, EUR: 0, SYP: 0 };
  const [wallet, setWallet] = useState(initialWallet);
  const [counterpartyWallet, setCounterpartyWallet] = useState(initialWallet);
  const [pairWalletByConv, setPairWalletByConv] = useState<Record<number, Record<string, number>>>({});
  const getPairWallet = (convId: number | null) => {
    if (!convId) return initialWallet;
    return pairWalletByConv[convId] || initialWallet;
  };
  const currencyIdByCode = (code:string) => {
    const c = serverCurrencies.find((c:any)=> c.code === code);
    return c ? c.id : undefined;
  };
  const currencyCodes = () => (serverCurrencies.length ? serverCurrencies.map((c:any)=>c.code) : Object.keys(initialWallet));


  const searchMatches = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [] as { key: string; index: number }[];
    const re = new RegExp(escapeRegExp(q), 'i');
    const matches: { key: string; index: number }[] = [];
    visibleMessages.forEach((m, idx) => {
      const surfaces: string[] = [];
      if (m.kind === 'transaction' && m.tx) {
        if (typeof m.tx.note === 'string') surfaces.push(m.tx.note);
        const amount = Number.isFinite(m.tx.amount) ? Math.abs(m.tx.amount) : null;
        if (amount !== null) {
          surfaces.push(`${amount} ${m.tx.symbol || ''}`.trim());
        }
        if (typeof m.text === 'string') surfaces.push(m.text);
      } else if (typeof m.text === 'string') {
        surfaces.push(m.text);
      }
      if (surfaces.some(surface => surface && re.test(surface))) {
        const key = resolveMessageRefKey(m, idx);
        matches.push({ key, index: idx });
      }
    });
    return matches;
  }, [visibleMessages, searchQuery, resolveMessageRefKey]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      if (activeMatchIdx !== 0) setActiveMatchIdx(0);
      return;
    }
    if (searchMatches.length === 0) {
      if (activeMatchIdx !== 0) setActiveMatchIdx(0);
      return;
    }
    if (activeMatchIdx >= searchMatches.length) {
      setActiveMatchIdx(0);
    }
  }, [activeMatchIdx, searchMatches, searchQuery]);

  useEffect(() => {
    if (!searchQuery.trim() || searchMatches.length === 0) return;
    const idx = Math.min(activeMatchIdx, searchMatches.length - 1);
    const targetKey = searchMatches[idx]?.key;
    if (!targetKey) return;
    const node = messageRefs.current[targetKey];
    if (!node) return;
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      node.classList.add('ring-2', 'ring-yellow-300/60');
      const tid = window.setTimeout(() => {
        node.classList.remove('ring-2', 'ring-yellow-300/60');
      }, 1200);
      return () => window.clearTimeout(tid);
    } catch {}
  }, [activeMatchIdx, searchMatches, searchQuery]);
  
  useEffect(()=>{
    if(!isAuthed) return;
    (async()=>{
      try {
        const ws = await apiClient.getWallets();
        const next = { ...initialWallet } as any;
        const discovered: Record<string, any> = {};
        if (Array.isArray(ws)) {
          for (const w of ws) {
            const code = w.currency?.code;
            if (code) {
              const val = parseFloat(w.balance);
              if (!isNaN(val)) next[code] = val;
              const currencyObj = w.currency || {};
              discovered[code] = {
                id: currencyObj.id,
                code,
                name: currencyObj.name,
                symbol: typeof currencyObj.symbol === 'string' ? currencyObj.symbol : '',
                precision: currencyObj.precision,
                is_active: currencyObj.is_active,
              };
            }
          }
        }
        setWallet(next);
        if (Object.keys(discovered).length) {
          setServerCurrencies(prev => {
            const merged = new Map<string, any>();
            for (const item of prev) {
              if (item && item.code) merged.set(item.code, item);
            }
            for (const item of Object.values(discovered)) {
              if (item && item.code) merged.set(item.code, item);
            }
            return Array.from(merged.values());
          });
        }
      } catch (e:any) {
        pushToast({ type:'error', msg:'تعذر جلب المحافظ' });
      }
    })();
  }, [isAuthed]);

  // Load conversations and contacts once after authentication
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    (async () => {
      try {
        // Fetch subscription to show trial banner (owners only)
        try {
          if (!isTeamActor) {
            const sub = await apiClient.getMySubscription();
            const days = sub?.subscription?.remaining_days ?? null;
            const isTrial = sub?.subscription?.is_trial === true;
            if (isTrial && typeof days === 'number' && days > 0) {
              setTrialDaysLeft(days);
              setShowSubBanner(true);
              setSubBannerMsg(`أنت على النسخة المجانية — متبقٍ ${days} يوم`);
            }
          }
        } catch {}

        const convs = await apiClient.listConversations();
        if (!active) return;
        const convArr = Array.isArray(convs) ? convs : [];
        setConversations(convArr);
        const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
        for (const c of convArr) {
          if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
        }
        setConvMetaById(meta);
          const mapped = convArr.map((c: any) => {
          const meId = profile?.id;
          let other = c.user_a;
          if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
          return {
            id: c.id,
            otherUserId: other?.id,
            otherUsername: other?.username,
              name: other?.display_name || other?.username || other?.email || 'مستخدم',
              avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
            last_message_at: c.last_message_at,
            last_message_preview: c.last_message_preview,
            isMuted: !!(c as any).isMuted,
            mutedUntil: (c as any).mutedUntil ?? null,
          };
        });
        setContacts(mapped);
        // reset unread for any conversations not present anymore
        setUnreadByConv(prev => {
          const allowed = new Set(mapped.map(m=>m.id));
          const cp: Record<number, number> = {} as any;
          for (const id of Object.keys(prev)) {
            const n = Number(id);
            if (allowed.has(n)) cp[n] = prev[n];
          }
          return cp;
        });
      } catch {}
    })();
    return () => { active = false; };
  }, [isAuthed, profile?.id]);

  // Restore unread counters from localStorage once after auth
  useEffect(() => {
    if (!isAuthed || !profile?.id || unreadRestored) return;
    try {
      const key = `unread_by_conv_v1_${profile.id}`;
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const next: Record<number, number> = {} as any;
          for (const k of Object.keys(parsed)) {
            const n = Number(k);
            if (Number.isFinite(n)) next[n] = Number(parsed[k]) || 0;
          }
          setUnreadByConv(next);
        }
      }
    } catch {}
    setUnreadRestored(true);
  }, [isAuthed, profile?.id, unreadRestored]);

  // Persist unread counters to localStorage on change
  useEffect(() => {
    if (!isAuthed || !profile?.id) return;
    try {
      const key = `unread_by_conv_v1_${profile.id}`;
      if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(unreadByConv));
    } catch {}
  }, [unreadByConv, isAuthed, profile?.id]);

  // Restore last selected conversation from localStorage (per-user) or fallback to first
  useEffect(() => {
    if (!contacts || contacts.length === 0 || selectedConversationId != null) return;

    // On mobile, don't auto-open any conversation after refresh; keep user in the list view
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      // Ensure we stay on the list; do not read savedId or fallback to first
      return;
    }
    let savedId: number | null = null;
    try {
      const key = `selected_conversation_id_${profile?.id ?? 'anon'}`;
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        const n = Number(raw);
        savedId = Number.isFinite(n) ? n : null;
      }
    } catch {}
    if (savedId && contacts.some(c => c.id === savedId)) {
      const idx = contacts.findIndex(c => c.id === savedId);
      setCurrentContactIndex(idx);
      setSelectedConversationId(savedId);
      setMobileView('chat');
    } else {
      // fallback to first contact
      setCurrentContactIndex(0);
      setSelectedConversationId(contacts[0].id);
    }
  }, [contacts, selectedConversationId, profile?.id]);

  // Keep selected index in sync if contacts reorder while a conversation is selected
  useEffect(() => {
    if (selectedConversationId == null || !contacts || contacts.length === 0) return;
    const idx = contacts.findIndex(c => c.id === selectedConversationId);
    if (idx !== -1 && idx !== currentContactIndex) {
      setCurrentContactIndex(idx);
    }
  }, [contacts, selectedConversationId]);

  // Persist selected conversation to localStorage (per-user key)
  useEffect(() => {
    if (selectedConversationId == null) return;
    try {
      const key = `selected_conversation_id_${profile?.id ?? 'anon'}`;
      if (typeof window !== 'undefined') localStorage.setItem(key, String(selectedConversationId));
    } catch {}
  }, [selectedConversationId, profile?.id]);

  // Live inbox: subscribe to per-user inbox WS for conversation list updates (no polling)
  useEffect(() => {
    if (!isAuthed) return;
    let closed = false;
    const sub = apiClient.connectInboxWithRetry();
    sub.on('open', () => { try { console.debug('[INBOX WS] open'); } catch {} });
    sub.on('message', (e: MessageEvent) => {
      // Debug inbox traffic
      try { const dbg = JSON.parse(e.data); if (dbg?.type) console.debug('[INBOX WS]', dbg.type, dbg); } catch {}
      if (closed) return;
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'inbox.update') {
          setContacts(prev => {
            const copy = prev ? [...prev] : [];
            const idx = copy.findIndex(c => c.id === data.conversation_id);
            if (idx !== -1) {
              // update preview/time and move to top like WhatsApp
              const updated = { ...copy[idx], last_message_preview: data.last_message_preview, last_message_at: data.last_message_at };
              copy.splice(idx, 1);
              copy.unshift(updated);
              return copy;
            }
            // If conversation not loaded yet, fetch full list once
            (async ()=>{
              try {
                const convs = await apiClient.listConversations();
                const mapped = convs.map((c: any) => {
                  const meId = profile?.id;
                  let other = c.user_a;
                  if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                  return {
                    id: c.id,
                    otherUserId: other?.id,
                    otherUsername: other?.username,
                    name: other?.display_name || other?.username || other?.email || 'مستخدم',
                    avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
                    last_message_at: c.last_message_at,
                    last_message_preview: c.last_message_preview,
                    isMuted: !!(c as any).isMuted,
                    mutedUntil: (c as any).mutedUntil ?? null,
                  };
                });
                setConversations(convs);
                setContacts(mapped);
              } catch {}
            })();
            return copy;
          });
          // update unread badge if that conversation is not currently open
          const convId = Number(data.conversation_id);
          if (convId) {
            const isViewing = selectedConversationId === convId && mobileView === 'chat';
            if (!isViewing) {
              setUnreadByConv(prev => ({ ...prev, [convId]: (prev[convId] || 0) + (Number(data.unread_count) || 1) }));
              // Play sound for background/new message if tab hidden or not in chat view
              const isHidden = typeof document !== 'undefined' && document.hidden;
              const muted = contacts.some(c => c.id === convId && c.isMuted);
              if ((isHidden || mobileView !== 'chat') && !muted) {
                try { tryPlayMessageSound(); } catch {}
              }
            } else {
              setUnreadByConv(prev => ({ ...prev, [convId]: 0 }));
            }
          }
        }
      } catch {}
    });
    sub.on('close', (e: CloseEvent) => { try { console.debug('[INBOX WS] close', e.code, e.reason); } catch {} });
    sub.on('error', (e: Event) => { try { console.debug('[INBOX WS] error', e); } catch {} });
    const hb = setInterval(() => {
      const s: WebSocket | null = (sub as any).socket || null;
      if (s && s.readyState === WebSocket.OPEN) {
        try { s.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
    }, 15000);
    return () => { closed = true; clearInterval(hb); sub.close(); };
  }, [isAuthed, profile?.id, selectedConversationId, mobileView]);

  // NOTE: Per-user Pusher notifications block removed. Inbox WS already updates previews/unread.
  // منطق إضافة المعاملة: إذا أدخل المستخدم قيمة في حقل "لنا" فهذا يعني أنه استلم (credit) وبالتالي زيادة في محفظته ونقصان عند الطرف الآخر
  // وإذا وضع في "لكم" يعني أنه دفع (debit) فتقل محفظته وتزداد محفظة الطرف الآخر.
  const addTransaction = async () => {
    if (!selectedConversationId) return;
    if (!amountOurs && !amountYours) return; // لا يوجد إدخال
    if (txLoading) return;
    setTxLoading(true);

    // تحقق من صحة المدخلات (أرقام موجبة فقط) + تقريب إلى 5 منازل
    const normalize = (raw:string) => {
      if (!raw) return NaN;
      const n = parseFloat(normalizeNumberString(raw));
      if (isNaN(n) || n <= 0) return NaN;
      return Number(n.toFixed(5));
    };
    const parsedOurs = normalize(amountOurs);
    const parsedYours = normalize(amountYours);
    const validOurs = !isNaN(parsedOurs) && parsedOurs > 0;
    const validYours = !isNaN(parsedYours) && parsedYours > 0;
    if (!validOurs && !validYours) {
      // كلاهما غير صالح
      setTxLoading(false);
      return;
    }

    // تجهيز العمليات (قد تكون عمليتين متتاليتين)
  const ops: { amount: number; direction: 'lna'|'lkm' }[] = [];
    if (validOurs) ops.push({ amount: parsedOurs, direction: 'lna' });
    if (validYours) ops.push({ amount: parsedYours, direction: 'lkm' });

    // أخذ نسخة للاحتفاظ بها في حالة التراجع (rollback)
    const prevWallet = { ...wallet };
    const prevCounter = { ...counterpartyWallet };
    let success = false;

    // إظهار مؤشر مؤقت (دون تعديل القيمة تفاؤلياً حتى لا تتضاعف)
    setPendingCurrencies(prev => new Set([...Array.from(prev), selectedCurrency]));

    // رسائل تفاؤلية لعرض بطاقة المعاملة مباشرة
    // ملاحظة: لم نعد نضيف رسائل تفاؤلية كفقاعات معاملة؛ نترك الرسائل كنصوص من الخادم كما كانت.

    try {
      let cid = currencyIdByCode(selectedCurrency);
      if (!cid) {
        // محاولة جلب العملات الآن
        try {
          const fresh = await apiClient.getCurrencies();
          setServerCurrencies(fresh);
          cid = fresh.find(c=>c.code===selectedCurrency)?.id;
        } catch {}
        // محاولة bootstrap وإنشاء العملات الافتراضية
        try {
          await apiClient.bootstrapCurrencies();
          const again = await apiClient.getCurrencies();
          setServerCurrencies(again);
          cid = again.find(c=>c.code===selectedCurrency)?.id;
        } catch {}
    }
    if (!cid) throw new Error('لا توجد عملات مهيأة بعد. جرّب إعادة تحميل الصفحة أو تسجيل الخروج والدخول أو تكرار العملية لاحقاً.');
      for (const op of ops) {
        await apiClient.createTransaction(
          selectedConversationId,
          cid,
          op.amount.toFixed(5),
          op.direction,
          noteText || undefined
        );
      }
      // تحديث الملخصات بعد نجاح فعلي (لتأكيد الأرقام من الخادم)
      const [s, n] = await Promise.all([
        apiClient.getSummary(selectedConversationId),
        apiClient.getNetBalance(selectedConversationId)
      ]);
      setSummary(s.summary || []);
      setNetBalance(n.net || []);
      // تأكد من توفر بيانات user_a/user_b لهذه المحادثة
      let metaForConv = convMetaById[selectedConversationId];
      if (!metaForConv) {
        try {
          const conv = await apiClient.getConversation(selectedConversationId);
          if (conv && conv.user_a && conv.user_b) {
            metaForConv = { user_a_id: conv.user_a.id, user_b_id: conv.user_b.id };
            setConvMetaById(prev => ({ ...prev, [selectedConversationId]: metaForConv! }));
          }
        } catch {}
      }
      // إعادة حساب المحفظة الزوجية من n.net (سجل المعاملات) من منظور المستخدم الحالي
      const pair: Record<string, number> = { ...initialWallet };
      const rows = Array.isArray(n?.net) ? n.net : [];
      const flip = (metaForConv && profile?.id)
        ? (profile.id === metaForConv.user_a_id ? 1 : -1)
        : 1;
      for (const row of rows) {
        const code = row?.currency?.code;
        const valRaw = row?.net_from_user_a_perspective;
        const val = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
        if (code) pair[code] = isNaN(val) ? 0 : Number((flip * val).toFixed(5));
      }
      setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: pair }));
      // لم نعد نحدّث محفظة عامة للعرض
      success = true;
      pushToast({ type:'success', msg:'تم حفظ المعاملة' });
      // لا نقوم بإعادة جلب الرسائل هنا؛ نعتمد على إشعار الـ WS لإضافة الرسالة فوراً لتفادي الوميض
    } catch (e) {
      // فشل => التراجع عن التعديلات التفاؤلية
      // تراجُع على المحفظة الزوجية فقط
      if (selectedConversationId) {
        setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: { ...prev[selectedConversationId] } }));
      }
      const errMsg = (e as any)?.message || 'فشل حفظ المعاملة';
      pushToast({ type:'error', msg: errMsg });
  // لا شيء
    } finally {
      if (success) {
        setAmountOurs('');
        setAmountYours('');
        setNoteText('');
        setNoteModalOpen(false);
  // لا شيء
      }
      setPendingCurrencies(prev => { const cp = new Set(prev); cp.delete(selectedCurrency); return cp; });
      setTxLoading(false);
    }
  };

  // نُفضّل الاسم العربي المحلي حسب الكود؛ وإن لم يتوفر نستخدم الاسم القادم من الخادم ثم الكود
  const effectiveCurrencies = serverCurrencies.length
    ? serverCurrencies.map((c:any)=>({
        name: AR_NAME_BY_CODE[c.code] || c.name || c.code,
        code: c.code,
        symbol: (c.symbol && typeof c.symbol === 'string' && c.symbol.trim()) ? c.symbol.trim() : c.code,
      }))
    : fallbackCurrencies;
  const symbolFor = (code:string) => {
    const entry = effectiveCurrencies.find(c=>c.code===code);
    if (!entry) return code;
    return entry.symbol && entry.symbol.trim() ? entry.symbol : entry.code;
  };
  const sanitizeAmountInput = useCallback((raw: string) => {
    const normalized = arabicToEnglishDigits(raw || '')
      .replace(/[\u066B]/g, '.')
      .replace(/[\u066C]/g, '')
      .replace(/[^0-9.,]/g, '')
      .replace(/,/g, '.');
    if (!normalized) return '';
    const match = normalized.match(/^(\d{0,9})(?:\.(\d{0,2})?)?/);
    if (!match) return '';
    const intPart = match[1] || '';
    const fracPart = match[2] || '';
    let formatted = intPart;
    if (normalized.startsWith('.') && !intPart) {
      formatted = '0';
    }
    if (normalized.includes('.') || fracPart) {
      formatted = `${formatted}.${fracPart}`;
    }
    return formatted;
  }, []);
  const formatMoneyValue = (num:number) => {
    if (isNaN(num)) return '0.00';
    const rounded = Number(num.toFixed(5));
    const parts = rounded.toString().split('.');
    if (parts.length === 1) return parts[0] + '.00';
    let frac = parts[1].replace(/0+$/,'');
    if (frac.length === 0) return parts[0] + '.00';
    if (frac.length === 1) return parts[0] + '.' + frac + '0';
    return parts[0] + '.' + frac;
  };
  const formatAmount = (v:number, code:string) => `${formatMoneyValue(v)} ${symbolFor(code)}`;

  // استقبال الرسائل عبر Pusher بدل WebSocket الداخلي
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    const key = (process.env.NEXT_PUBLIC_PUSHER_KEY as string) || '';
    const cluster = (process.env.NEXT_PUBLIC_PUSHER_CLUSTER as string) || '';
    if (!key || !cluster) {
      try { console.warn('[Pusher] Chat feed disabled: missing NEXT_PUBLIC_PUSHER_*'); } catch {}
      return;
    }
    let pusher: any = null;
    let channel: any = null;
    const channelName = `chat_${selectedConversationId}`;
    let soundPromptShown = false;
  const onMessage = (data: any) => {
      try {
        if (data?.type === 'delete.request' && data?.conversation_id) {
          setPendingDeleteByConv(prev => ({ ...prev, [data.conversation_id]: { from: data.username || 'unknown', at: new Date().toISOString() } }));
          return;
        }
        if (data?.type === 'delete.approved' && data?.conversation_id) {
          // المحادثة حذفت بعد موافقة الطرف الآخر
          setPendingDeleteByConv(prev => { const cp = { ...prev }; delete cp[data.conversation_id]; return cp; });
          setContacts(prev => prev.filter(c => c.id !== data.conversation_id));
          if (selectedConversationId === data.conversation_id) {
            setSelectedConversationId(null);
            setCurrentContactIndex(null);
            setMessages([]);
            setSummary(null);
            setNetBalance(null);
          }
          pushToast({ type: 'success', msg: 'تم حذف جهة الاتصال بعد الموافقة' });
          return;
        }
        if (data?.type === 'delete.declined' && data?.conversation_id) {
          setPendingDeleteByConv(prev => { const cp = { ...prev }; delete cp[data.conversation_id]; return cp; });
          pushToast({ type: 'info', msg: 'رفض الطرف الآخر طلب الحذف' });
          return;
        }
  const systemSubtype = typeof data?.systemSubtype === 'string'
    ? data.systemSubtype
    : (typeof data?.system_subtype === 'string' ? data.system_subtype : undefined);
  const settledAt = typeof data?.settled_at === 'string'
    ? data.settled_at
    : (typeof data?.settledAt === 'string' ? data.settledAt : null);
  const incomingDisplay = (data?.senderDisplay || data?.display_name || '').toString();
  const isCurrent = !!(profile?.username && data?.username === profile.username && (!incomingDisplay || !currentSenderDisplay ? true : incomingDisplay === (currentSenderDisplay || '')));
  const txt = (data?.message ?? '').toString();
  const senderDisplay = incomingDisplay;
  const readAtPayload = (typeof data?.read_at === 'string' && data.read_at) ? data.read_at : null;
  const deliveredAtPayload = (typeof data?.delivered_at === 'string' && data.delivered_at) ? data.delivered_at : null;
        const messageIdNum = typeof data?.id === 'number' ? data.id : (typeof data?.message_id === 'number' ? data.message_id : null);
    const txFromServer = normalizeServerTransaction(data?.tx);
    const tx = txFromServer || parseTransaction(txt);
  if (isCurrent) {
          // Reconcile with optimistic 'sending' bubble instead of appending a duplicate
          setMessages(prev => {
            const copy = [...prev];
            if (messageIdNum) {
              const existingIdx = copy.findIndex(m => (m.id || 0) === messageIdNum);
              if (existingIdx !== -1) {
                const existing = copy[existingIdx];
                  copy[existingIdx] = {
                  ...existing,
                  text: txt,
                  kind: tx ? 'transaction' : (data?.kind === 'system' || systemSubtype ? 'system' : 'text'),
                  tx: tx || undefined,
                  delivery_status: Math.max(existing.delivery_status || 0, readAtPayload ? 2 : 1),
                  status: readAtPayload ? 'read' : ((existing.delivery_status || 0) >= 2 ? 'read' : 'delivered'),
                  read_at: readAtPayload || existing.read_at || null,
                  delivered_at: deliveredAtPayload || existing.delivered_at || null,
                  systemSubtype: systemSubtype || existing.systemSubtype,
                  system_subtype: systemSubtype || existing.system_subtype,
                  settled_at: settledAt ?? existing.settled_at ?? null,
                } as any;
                return copy;
              }
            }
            // لم نعد نعيد استخدام رسائل مطابقة بالنص؛ المعاملات المتكررة يجب أن تظهر دائمًا كفقاعات جديدة.
            return [
              ...prev,
              {
                sender: 'current',
                text: txt,
                created_at: new Date().toISOString(),
                kind: tx ? 'transaction' : (data?.kind === 'system' || systemSubtype ? 'system' : 'text'),
                tx: tx || undefined,
                status: readAtPayload ? 'read' : 'delivered',
                delivery_status: readAtPayload ? 2 : 1,
                read_at: readAtPayload,
                delivered_at: deliveredAtPayload,
                senderDisplay: senderDisplay || undefined,
                id: messageIdNum ?? undefined,
                systemSubtype,
                system_subtype: systemSubtype,
                settled_at: settledAt ?? null,
              } as any,
            ];
          });
  } else {
          // Receiver: append the incoming message
          setMessages(prev => {
            if (messageIdNum) {
              const existingIdx = prev.findIndex(m => (m.id || 0) === messageIdNum);
              if (existingIdx !== -1) {
                const copy = [...prev];
                const existing = copy[existingIdx];
                  copy[existingIdx] = {
                  ...existing,
                  text: txt,
                  kind: tx ? 'transaction' : (data?.kind === 'system' || systemSubtype ? 'system' : 'text'),
                  tx: tx || undefined,
                  status: readAtPayload ? 'read' : 'delivered',
                  delivery_status: readAtPayload ? 2 : 1,
                  read_at: readAtPayload,
                  delivered_at: deliveredAtPayload,
                  senderDisplay: senderDisplay || existing.senderDisplay || undefined,
                  systemSubtype: systemSubtype || existing.systemSubtype,
                  system_subtype: systemSubtype || existing.system_subtype,
                  settled_at: settledAt ?? existing.settled_at ?? null,
                } as any;
                return copy;
              }
            }
            return [
              ...prev,
              {
                sender: 'other',
                text: txt,
                created_at: new Date().toISOString(),
                kind: tx ? 'transaction' : (data?.kind === 'system' || systemSubtype ? 'system' : 'text'),
                tx: tx || undefined,
                status: readAtPayload ? 'read' : 'delivered',
                delivery_status: readAtPayload ? 2 : 1,
                read_at: readAtPayload,
                delivered_at: deliveredAtPayload,
                senderDisplay: senderDisplay || undefined,
                id: messageIdNum ?? undefined,
                systemSubtype,
                system_subtype: systemSubtype,
                settled_at: settledAt ?? null,
              } as any,
            ];
          });
          // Show centered alert for add/remove member events
          const mc = detectMemberChange(txt);
          if (mc) {
            const msg = mc.action === 'removed'
              ? `تمت إزالة ${mc.name || 'عضو'} من المحادثة`
              : `تمت إضافة ${mc.name || 'عضو'} إلى المحادثة`;
            pushCenterAlert({ type: mc.action === 'removed' ? 'removed' : 'added', msg });
          }
          // If it is a transaction, refresh aggregates so wallet updates live for recipient
          if (tx && selectedConversationId) {
            refreshConvAggregates(selectedConversationId);
          }
          // Clear unread counter for this conversation if we are currently viewing it
          setUnreadByConv(prev => ({ ...prev, [selectedConversationId]: 0 }));
          // Play a soft sound if tab is hidden OR user is not viewing chat panel (mobile list view)
          const isViewing = mobileView === 'chat';
          if (typeof document !== 'undefined' && (document.hidden || !isViewing)) {
            // Skip sound if current conversation is muted
            const muted = contacts.some(c => c.id === selectedConversationId && c.isMuted);
            if (!muted) {
              tryPlayMessageSound().then(ok => {
                if (!ok && !soundPromptShown) { soundPromptShown = true; pushToast({ type: 'info', msg: 'انقر في الصفحة لتفعيل صوت الإشعارات' }); }
              }).catch(()=>{});
            }
          }
        }
      } catch {}
    };
    (async () => {
      try {
        const mod = await import('pusher-js');
        const Pusher = (mod as any).default || (mod as any);
        pusher = new Pusher(key, { cluster });
        channel = pusher.subscribe(channelName);
        channel.bind('message', onMessage);
      } catch (e) {
        try { console.error('[Pusher] chat init failed', e); } catch {}
      }
    })();
    return () => {
      try { channel && channel.unbind('message', onMessage); } catch {}
      try { pusher && pusher.unsubscribe && pusher.unsubscribe(channelName); } catch {}
      try { pusher && pusher.disconnect && pusher.disconnect(); } catch {}
    };
  }, [isAuthed, selectedConversationId, profile?.username, contacts]);
  

  // Fetch messages when conversation changes (single fetch; no re-fetch on contact list reorder)
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    let active = true;
    // Reset state to prevent leaking messages from previous conversation
    setMessages([]);
    lastMessageIdRef.current = 0;
    setSummary(null);
    setNetBalance(null);
    (async () => {
      try {
        setLoadingMessages(true);
  const data = await apiClient.getMessages(selectedConversationId);
        if (!active) return;
        const mapped = (Array.isArray(data) ? data : []).map((m: any) => {
              const ds: number = (typeof m.delivery_status === 'number' && isFinite(m.delivery_status)) ? m.delivery_status : 0;
              const systemSubtype = typeof m.system_subtype === 'string'
                ? m.system_subtype
                : (typeof m.systemSubtype === 'string' ? m.systemSubtype : undefined);
              const settledAt = typeof m.settled_at === 'string'
                ? m.settled_at
                : (typeof m.settledAt === 'string' ? m.settledAt : undefined);
              const base: any = {
            id: m.id,
            sender: m.sender && profile && m.sender.id === profile.id ? 'current' : 'other',
            text: (m.body ?? '').toString(),
                created_at: m.created_at,
    client_id: typeof m.client_id === 'string' && m.client_id ? m.client_id : undefined,
                attachment: (m.attachment_url || m.attachment_name) ? { url: m.attachment_url || null, name: m.attachment_name || undefined, mime: m.attachment_mime || undefined, size: typeof m.attachment_size === 'number' ? m.attachment_size : undefined } : undefined,
                senderDisplay: (m.senderDisplay || (m.sender && (m.sender.display_name || m.sender.username))) || undefined,
                delivery_status: ds,
                status: ds >= 2 ? 'read' : ds >= 1 ? 'delivered' : 'sent',
                systemSubtype,
                system_subtype: systemSubtype,
                settled_at: settledAt || null,
          };
          if (m.type === 'transaction') {
            const tx = normalizeServerTransaction(m.tx) || parseTransaction(base.text);
            if (tx) return { ...base, kind: 'transaction', tx };
          }
          if (m.type === 'system' || systemSubtype) return { ...base, kind: 'system' };
          return { ...base, kind: 'text' };
        });
        const chrono = mapped.reverse();
        const deduped: typeof chrono = [];
        const seenIds = new Set<number>();
        const seenClientIds = new Set<string>();
        for (const msg of chrono) {
          const idNum = typeof msg.id === 'number' ? msg.id : null;
          const clientKey = typeof msg.client_id === 'string' ? msg.client_id : null;
          if (idNum !== null) {
            if (seenIds.has(idNum)) continue;
            seenIds.add(idNum);
          } else if (clientKey) {
            if (seenClientIds.has(clientKey)) continue;
            seenClientIds.add(clientKey);
          }
          deduped.push(msg);
        }
        setMessages(deduped);
        const last = chrono.length ? (chrono[chrono.length - 1].id || 0) : 0;
        lastMessageIdRef.current = typeof last === 'number' ? last : 0;
      } catch (e) {
        // silent for now
      } finally {
        setLoadingMessages(false);
      }
    })();
    return () => { active = false; };
  }, [isAuthed, selectedConversationId]);

  // التمرير التلقائي لأسفل عند تغير الرسائل
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // نستخدم requestAnimationFrame لضمان أن DOM حدث قبل التمرير
    requestAnimationFrame(()=>{
      el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  // Fetch summary & net balance
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    let active = true;
    (async () => {
      try {
        setLoadingSummary(true);
        const s = await apiClient.getSummary(selectedConversationId);
        const n = await apiClient.getNetBalance(selectedConversationId);
        if (!active) return;
        setSummary(s.summary || []);
        setNetBalance(n.net || []);
        // تأكد من توفر بيانات user_a/user_b لهذه المحادثة
        let metaForConv = convMetaById[selectedConversationId];
        if (!metaForConv) {
          try {
            const conv = await apiClient.getConversation(selectedConversationId);
            if (conv && conv.user_a && conv.user_b) {
              metaForConv = { user_a_id: conv.user_a.id, user_b_id: conv.user_b.id };
              setConvMetaById(prev => ({ ...prev, [selectedConversationId]: metaForConv! }));
            }
          } catch {}
        }
        // بناء المحفظة للعرض من net_balance (تجميعة سجل المعاملات) بمنظور المستخدم الحالي
        const pair: Record<string, number> = { ...initialWallet };
        const rows = Array.isArray(n?.net) ? n.net : [];
        const flip = (metaForConv && profile?.id)
          ? (profile.id === metaForConv.user_a_id ? 1 : -1)
          : 1;
        for (const row of rows) {
          const code = row?.currency?.code;
          const valRaw = row?.net_from_user_a_perspective;
          const val = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
          if (code) pair[code] = isNaN(val) ? 0 : Number((flip * val).toFixed(5));
        }
        setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: pair }));
      } catch (e) {
        // ignore
      } finally {
        setLoadingSummary(false);
      }
    })();
    return () => { active = false; };
  }, [isAuthed, selectedConversationId, convMetaById, profile?.id]);

  // Open resilient WebSocket with retry
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    const controller = apiClient.connectSocketWithRetry(selectedConversationId, { maxAttempts: 8 });
    controller.on('message', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        const PUSHER_ENABLED = Boolean(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER);
        if (payload?.type) {
          try { console.debug('[CHAT WS]', payload.type, { conversation_id: payload.conversation_id, id: payload.id, client_id: payload.client_id, created_at: payload.created_at }); } catch {}
        }
        // Fallback: if Pusher is not configured, use WS chat.message to update the thread
  if (payload.type === 'chat.message') {
          const incDisplay = (payload?.senderDisplay || payload?.display_name || '').toString();
          const isMine = !!(profile?.username && payload?.sender === profile.username && (!incDisplay || !currentSenderDisplay ? true : incDisplay === (currentSenderDisplay || '')));
          const txt = (payload?.body ?? '').toString();
          const messageIdNum = typeof payload.id === 'number' ? payload.id : null;
          const incomingClientId = typeof payload.client_id === 'string' && payload.client_id ? payload.client_id : null;
          const systemSubtype = typeof payload?.systemSubtype === 'string'
            ? payload.systemSubtype
            : (typeof payload?.system_subtype === 'string' ? payload.system_subtype : undefined);
          const settledAt = typeof payload?.settled_at === 'string'
            ? payload.settled_at
            : (typeof payload?.settledAt === 'string' ? payload.settledAt : null);
          const txFromServer = normalizeServerTransaction(payload?.tx);
          const tx = txFromServer || parseTransaction(txt);
          const previewLabel = previewFromMessage(txt, payload?.attachment);
          const previewConvId = typeof payload.conversation_id === 'number' ? payload.conversation_id : selectedConversationId;
          if (previewConvId) {
            applyConversationPreview(previewConvId, previewLabel, payload?.created_at || new Date().toISOString());
          }
          if (isMine) {
            setMessages(prev => {
              const copy = [...prev];
              if (incomingClientId) {
                const byClientIdx = copy.findIndex(m => m.sender === 'current' && m.client_id === incomingClientId);
                if (byClientIdx !== -1) {
                  const existing = copy[byClientIdx];
                  copy[byClientIdx] = {
                    ...existing,
                    id: messageIdNum ?? existing.id,
                    client_id: incomingClientId,
                    text: txt,
                    kind: tx ? 'transaction' : (systemSubtype ? 'system' : 'text'),
                    tx: tx || undefined,
                    senderDisplay: (payload.senderDisplay || payload.display_name || existing.senderDisplay) || undefined,
                    attachment: payload.attachment ? {
                      name: payload.attachment.name,
                      mime: payload.attachment.mime,
                      size: payload.attachment.size,
                      url: payload.attachment.url || existing.attachment?.url || undefined,
                    } : existing.attachment,
                    read_at: typeof payload.read_at === 'string' ? payload.read_at : existing.read_at,
                    delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : existing.delivered_at,
                    delivery_status: Math.max(existing.delivery_status || 0, typeof payload.delivery_status === 'number' ? payload.delivery_status : (payload.read_at ? 2 : 1)),
                    status: (typeof payload.read_at === 'string' && payload.read_at) ? 'read' : ((existing.delivery_status || 0) >= 2 ? 'read' : 'delivered'),
                    systemSubtype: systemSubtype || existing.systemSubtype,
                    system_subtype: systemSubtype || existing.system_subtype,
                    settled_at: settledAt ?? existing.settled_at ?? null,
                  } as any;
                  return copy;
                }
              }
              if (messageIdNum) {
                const existingIdx = copy.findIndex(m => (m.id || 0) === messageIdNum);
                if (existingIdx !== -1) {
                  const existing = copy[existingIdx];
                  copy[existingIdx] = {
                    ...existing,
                    client_id: incomingClientId ?? existing.client_id,
                    text: txt,
                    kind: tx ? 'transaction' : (systemSubtype ? 'system' : 'text'),
                    tx: tx || undefined,
                    senderDisplay: (payload.senderDisplay || payload.display_name || existing.senderDisplay) || undefined,
                    attachment: payload.attachment ? {
                      name: payload.attachment.name,
                      mime: payload.attachment.mime,
                      size: payload.attachment.size,
                      url: payload.attachment.url || existing.attachment?.url || undefined,
                    } : existing.attachment,
                    read_at: typeof payload.read_at === 'string' ? payload.read_at : existing.read_at,
                    delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : existing.delivered_at,
                    delivery_status: Math.max(existing.delivery_status || 0, typeof payload.delivery_status === 'number' ? payload.delivery_status : (payload.read_at ? 2 : 1)),
                    status: (typeof payload.read_at === 'string' && payload.read_at) ? 'read' : ((existing.delivery_status || 0) >= 2 ? 'read' : 'delivered'),
                    systemSubtype: systemSubtype || existing.systemSubtype,
                    system_subtype: systemSubtype || existing.system_subtype,
                    settled_at: settledAt ?? existing.settled_at ?? null,
                  } as any;
                  return copy;
                }
              }
              return [
                ...prev,
                {
                  sender: 'current',
                  text: txt,
                  created_at: payload.created_at || new Date().toISOString(),
                  kind: tx ? 'transaction' : (systemSubtype ? 'system' : 'text'),
                  tx: tx || undefined,
                  status: 'delivered',
                  delivery_status: 1,
                  id: messageIdNum ?? undefined,
                  client_id: incomingClientId ?? undefined,
                  senderDisplay: (profile?.display_name || profile?.username) || undefined,
                  attachment: payload.attachment ? {
                    name: payload.attachment.name,
                    mime: payload.attachment.mime,
                    size: payload.attachment.size,
                    url: payload.attachment.url || undefined,
                  } : undefined,
                  read_at: typeof payload.read_at === 'string' ? payload.read_at : null,
                  delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : null,
                  systemSubtype,
                  system_subtype: systemSubtype,
                  settled_at: settledAt ?? null,
                } as any,
              ];
            });
          } else {
            setMessages(prev => {
              if (messageIdNum) {
                const existingIdx = prev.findIndex(m => (m.id || 0) === messageIdNum);
                if (existingIdx !== -1) {
                  const copy = [...prev];
                  const existing = copy[existingIdx];
                  copy[existingIdx] = {
                    ...existing,
                    client_id: incomingClientId ?? existing.client_id,
                    text: txt,
                    kind: tx ? 'transaction' : (systemSubtype ? 'system' : 'text'),
                    tx: tx || undefined,
                    status: 'delivered',
                    delivery_status: Math.max(existing.delivery_status || 0, 1),
                    senderDisplay: (payload.senderDisplay || payload.display_name || existing.senderDisplay) || undefined,
                    attachment: payload.attachment ? {
                      name: payload.attachment.name,
                      mime: payload.attachment.mime,
                      size: payload.attachment.size,
                      url: payload.attachment.url || existing.attachment?.url || undefined,
                    } : existing.attachment,
                    read_at: typeof payload.read_at === 'string' ? payload.read_at : existing.read_at || null,
                    delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : existing.delivered_at || null,
                    systemSubtype: systemSubtype || existing.systemSubtype,
                    system_subtype: systemSubtype || existing.system_subtype,
                    settled_at: settledAt ?? existing.settled_at ?? null,
                  } as any;
                  return copy;
                }
              }
              return [
                ...prev,
                {
                  sender: 'other',
                  text: txt,
                  created_at: payload.created_at || new Date().toISOString(),
                  kind: tx ? 'transaction' : (systemSubtype ? 'system' : 'text'),
                  tx: tx || undefined,
                  status: 'delivered',
                  delivery_status: 1,
                  id: messageIdNum ?? undefined,
                  client_id: incomingClientId ?? undefined,
                  senderDisplay: (payload.senderDisplay || payload.display_name) || undefined,
                  attachment: payload.attachment ? {
                    name: payload.attachment.name,
                    mime: payload.attachment.mime,
                    size: payload.attachment.size,
                    url: payload.attachment.url || undefined,
                  } : undefined,
                  read_at: typeof payload.read_at === 'string' ? payload.read_at : null,
                  delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : null,
                  systemSubtype,
                  system_subtype: systemSubtype,
                  settled_at: settledAt ?? null,
                } as any,
              ];
            });
            if (tx && selectedConversationId) {
              refreshConvAggregates(selectedConversationId);
            }
            // For recipient, ensure wallet aggregates refresh on incoming transaction
            if (tx && selectedConversationId) {
              refreshConvAggregates(selectedConversationId);
            }
            // If the incoming message has an attachment without a URL yet, fetch it immediately and patch in place
            if (payload.attachment && !payload.attachment.url && typeof payload.id === 'number') {
              (async () => {
                try {
                  const since = Math.max(0, payload.id - 1);
                  const data = await apiClient.getMessagesSince(selectedConversationId, since, 5);
                  const arr = Array.isArray(data) ? data : (Array.isArray((data as any)?.results) ? (data as any).results : []);
                  const found = arr.find((it: any) => it && it.id === payload.id);
                  if (found) {
                    setMessages(prev => prev.map(m => {
                      if (m.id !== payload.id) return m;
                      const updated: any = { ...m };
                      // Update text from backend (empty if no caption)
                      updated.text = (found.body ?? '').toString();
                      // Update attachment fields
                      if (found.attachment_url || found.attachment_name) {
                        updated.attachment = {
                          url: found.attachment_url || null,
                          name: found.attachment_name || undefined,
                          mime: found.attachment_mime || undefined,
                          size: typeof found.attachment_size === 'number' ? found.attachment_size : undefined,
                        };
                      }
                      return updated;
                    }));
                  }
                } catch {}
              })();
            }
            const isViewing = selectedConversationId === payload.conversation_id && mobileView === 'chat';
            if (!isViewing) {
              setUnreadByConv(prev => ({ ...prev, [payload.conversation_id]: (prev[payload.conversation_id] || 0) + 1 }));
              // Play sound if tab hidden or not in chat view
              const isHidden = typeof document !== 'undefined' && document.hidden;
        const muted = contacts.some(c => c.id === payload.conversation_id && c.isMuted);
              if ((isHidden || mobileView !== 'chat') && !muted) {
                try {
                  tryPlayMessageSound().then(ok => { if (!ok) pushToast({ type: 'info', msg: 'انقر في الصفحة لتفعيل صوت الإشعارات' }); }).catch(()=>{});
                } catch {}
              }
            } else {
              setUnreadByConv(prev => ({ ...prev, [payload.conversation_id]: 0 }));
              // If viewing, update last seen id and emit read
              try {
                const idNum = typeof payload.id === 'number' ? payload.id : 0;
                if (idNum > lastMsgIdRef.current) lastMsgIdRef.current = idNum;
                const socket = wsRef.current || (controller as any).socket || null;
                if (socket && socket.readyState === WebSocket.OPEN && idNum > 0) {
                  try {
                    socket.send(JSON.stringify({ type: 'read', last_read_id: lastMsgIdRef.current }));
                  } catch {}
                }
              } catch {}
            }
          }
          return;
        }
        if (payload.type === 'chat.typing') {
          const isMe = payload.user && profile && payload.user === profile.username;
          if (!isMe) {
            setIsOtherTyping(payload.state !== 'stop');
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (payload.state !== 'stop') typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
          }
        }
        if (payload.type === 'chat.read') {
          const reader = typeof payload.reader === 'string' ? payload.reader : null;
          const lastReadRaw = payload.last_read_id ?? payload.lastReadId ?? payload.lastReadID;
          const lastReadId = typeof lastReadRaw === 'number' ? lastReadRaw : Number(lastReadRaw);
          const isFromMe = reader && profile?.username && reader === profile.username;
          if (!isFromMe && Number.isFinite(lastReadId) && lastReadId > 0) {
            const readAt = typeof payload.read_at === 'string' ? payload.read_at : (typeof payload.timestamp === 'string' ? payload.timestamp : undefined);
            setMessages(prev => prev.map(m => {
              const mid = typeof m.id === 'number' ? m.id : 0;
              if (mid <= lastReadId && m.sender === 'current') {
                const nextStatus = m.delivery_status === 2 && m.status === 'read' ? m : {
                  ...m,
                  delivery_status: 2,
                  status: 'read',
                  read_at: readAt || m.read_at || new Date().toISOString(),
                };
                return nextStatus;
              }
              return m;
            }));
          }
          return;
        }
        // Uniform status updates: message.status from backend
        if (payload.type === 'message.status') {
          const idNum: number = typeof payload.id === 'number' ? payload.id : -1;
          const newStatusStr = payload.status as ('delivered'|'read'|undefined);
          const ds: number = typeof payload.delivery_status === 'number'
            ? payload.delivery_status
            : (newStatusStr === 'read' ? 2 : newStatusStr === 'delivered' ? 1 : -1);
          const readAt = (typeof payload.read_at === 'string' && payload.read_at) ? payload.read_at : null;
          const deliveredAt = (typeof payload.delivered_at === 'string' && payload.delivered_at) ? payload.delivered_at : null;
          if (idNum > 0 && ds >= 0) {
            setMessages(prev => prev.map(m => {
              if ((m.id || 0) !== idNum) return m;
              const currDs = typeof m.delivery_status === 'number' ? m.delivery_status : (m.status === 'read' ? 2 : m.status === 'delivered' ? 1 : 0);
              let nextDs = Math.max(currDs, ds);
              const nextReadAt = readAt ? readAt : (m.read_at || null);
              if (readAt && nextDs < 2) {
                nextDs = 2;
              }
              const nextDeliveredAt = deliveredAt || m.delivered_at || (nextDs >= 1 ? (m.delivered_at || null) : m.delivered_at);
              const isRead = !!nextReadAt || nextDs >= 2;
              return {
                ...m,
                delivery_status: nextDs >= 2 ? 2 : nextDs,
                status: isRead ? 'read' : nextDs >= 1 ? 'delivered' : 'sent',
                read_at: nextReadAt || undefined,
                delivered_at: nextDeliveredAt || undefined,
              };
            }));
          }
        }
      } catch {}
    });
    controller.on('open', () => { wsRef.current = (controller as any).socket || null; });
    controller.on('close', () => { wsRef.current = null; });
    // initialize reference immediately in case 'open' fires very fast
    wsRef.current = (controller as any).socket || null;
    return () => { wsRef.current = null; try { controller.close(); } catch {} };
  }, [isAuthed, selectedConversationId, profile?.username, mobileView, currentSenderDisplay, applyConversationPreview, previewFromMessage]);

  // Emit read when window gains focus (if WS is open and we have a last id)
  useEffect(() => {
    const onFocus = () => {
      try {
        const socket = wsRef.current;
        if (socket && socket.readyState === WebSocket.OPEN && lastMsgIdRef.current > 0) {
          socket.send(JSON.stringify({ type: 'read', last_read_id: lastMsgIdRef.current }));
        }
      } catch {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Zero-polling: لا يوجد استعلام دوري للرسائل؛ WS هو المصدر الوحيد بعد الجلب الأولي.

  const router = useRouter();
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      if (useTeamLogin) {
        const owner = ownerUsername.trim();
        const team = teamUsername.trim();
        if (!owner || !team || !password.trim()) {
          throw new Error('يرجى إدخال اسم المالك واسم عضو الفريق وكلمة المرور');
        }
        // Latin-only usernames to match backend rule
        const latinRe = /^[A-Za-z]+$/;
        if (!latinRe.test(owner) || !latinRe.test(team)) {
          throw new Error('أسماء المستخدمين (المالك وعضو الفريق) يجب أن تكون أحرف لاتينية فقط (A-Z)');
        }
        try {
          await apiClient.teamLogin(owner, team, password);
        } catch (e:any) {
          // Normalize backend message
          if ((e?.message || '').toLowerCase().includes('invalid credentials')) {
            throw new Error('بيانات تسجيل الدخول غير صحيحة. تأكد من اسم المالك وعضو الفريق وكلمة المرور');
          }
          throw e;
        }
      } else {
        try {
          await apiClient.login(identifier, password);
        } catch (e:any) {
          if (e && e.otp_required) {
            const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) من تطبيق المصادقة') : '';
            if (!code) throw e;
            await apiClient.login(identifier, password, code);
          } else if ((e?.message || '').toLowerCase().includes('no active account')) {
            // UX: اقترح وضع عضو فريق تلقائياً إذا لم نجد حساب أساسي
            setUseTeamLogin(true);
            setTeamUsername(identifier);
            setError('لم يتم العثور على حساب أساسي بهذا الاسم. جرّب تسجيل دخول عضو فريق: أدخل اسم مستخدم المالك واسم عضو الفريق وكلمة المرور.');
            return; // لا تكمل إعادة التوجيه
          } else {
            throw e;
          }
        }
      }
      const me = await apiClient.getProfile().catch(()=>null);
      if(me) setProfile(me);
      setIsAuthed(true);
      setAuthStatus('authed');
      // Redirect-after-login
      try {
        const dest = sessionStorage.getItem('redirectAfterLogin') || '/';
        sessionStorage.removeItem('redirectAfterLogin');
        router.replace(dest);
      } catch {
        router.replace('/');
      }
    } catch (err:any) {
      const status = err?.status;
      const backendDetail = err?.data?.detail;
      let msg = err?.message || 'فشل تسجيل الدخول';
      if (backendDetail && typeof backendDetail === 'string' && backendDetail.toLowerCase() !== msg.toLowerCase()) {
        msg = `${msg} — ${backendDetail}`;
      }
      if (typeof status === 'number') {
        msg = `${msg} (HTTP ${status})`;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-chatBg text-gray-100 p-4">
        <div className="text-xs text-gray-400 animate-pulse">جاري التحميل...</div>
      </div>
    );
  }

  if (!isAuthed) {
    const inputClass = isLightTheme
      ? 'w-full pl-9 pr-3 bg-white/80 border border-orange-200/70 rounded-lg py-2 text-sm text-gray-800 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition'
      : 'w-full pl-9 pr-3 bg-chatBg border border-chatDivider rounded py-2 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-green-600';
    const formClass = isLightTheme
      ? 'w-full max-w-sm bg-white/80 border border-orange-100/80 backdrop-blur-md rounded-3xl p-10 pt-12 flex flex-col gap-7 shadow-[0_35px_60px_-15px_rgba(255,153,51,0.35)] text-gray-700'
      : 'w-full max-w-sm bg-chatPanel border border-chatDivider rounded-2xl p-10 pt-12 flex flex-col gap-7 shadow-2xl/40';
    const checkboxClasses = isLightTheme
      ? 'accent-orange-400'
      : 'accent-green-600';
    const labelTextClass = isLightTheme ? 'text-gray-600' : '';
    const inputIconClass = isLightTheme ? 'text-orange-300' : 'text-gray-400';
    const submitClass = isLightTheme
      ? 'bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600 hover:from-orange-500 hover:to-orange-700 text-white shadow-lg disabled:opacity-60 rounded-lg py-2 font-semibold text-sm transition'
      : 'bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded py-2 font-semibold text-sm';
    const toggleButtonClass = isLightTheme
      ? 'text-orange-400 hover:text-orange-500 bg-white/70 border border-orange-200/60 shadow-sm'
      : 'text-yellow-300 hover:text-yellow-200 bg-chatPanel/60 border border-chatDivider shadow-lg';
    const toggleIcon = isLightTheme ? <MoonIcon className="w-5 h-5" /> : <SunIcon className="w-5 h-5" />;
    const displayedContactLinks = contactLinks.slice(0, 10);
    const hasContactLinks = displayedContactLinks.length > 0;
    const consentTextClass = isLightTheme ? 'text-xs text-gray-500 text-center leading-relaxed' : 'text-xs text-gray-400 text-center leading-relaxed';
    const consentLinkClass = isLightTheme ? 'text-blue-600 hover:text-blue-500 underline-offset-2 hover:underline' : 'text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline';
    const contactIconButtonBase = isLightTheme
      ? 'group relative flex h-12 w-12 items-center justify-center rounded-full border border-orange-100/80 bg-white/60 backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 shadow-sm transition'
      : 'group relative flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 transition';
    const contactIconInnerBase = 'flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110';

    return (
      <div className={`relative min-h-screen flex items-center justify-center p-6 md:p-8 transition-colors duration-500 ${isLightTheme ? 'bg-gradient-to-br from-white via-orange-50 to-orange-100 text-gray-900' : 'bg-chatBg text-gray-100'}`}>
        <button
          type="button"
          onClick={toggleTheme}
          className={`absolute top-6 right-6 md:top-8 md:right-8 grid place-items-center w-11 h-11 rounded-full backdrop-blur transition ${toggleButtonClass}`}
          aria-label={isLightTheme ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
          title={isLightTheme ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
        >
          {toggleIcon}
        </button>
        <div className="flex w-full flex-col items-center gap-6">
          <form onSubmit={handleLogin} className={`${formClass} transition-all duration-500`}>
          <div className="flex flex-col items-center gap-4 -mt-2">
            <img
              src={brandingLogo || DEFAULT_BRANDING_LOGO}
              alt="شعار التطبيق"
              className="h-40 md:h-52 w-auto object-contain drop-shadow-xl transition-all duration-200"
              onError={(e)=>{
                const target = e.currentTarget as HTMLImageElement & { dataset: DOMStringMap & { fallbackApplied?: string } };
                if (target.dataset.fallbackApplied !== '1') {
                  target.dataset.fallbackApplied = '1';
                  target.src = DEFAULT_BRANDING_LOGO;
                }
              }}
            />
          </div>
          {error && <div className={`${isLightTheme ? 'text-red-500' : 'text-red-400'} text-xs text-center`}>{error}</div>}
          <div className="flex items-center justify-between text-xs">
            <label className={`flex items-center gap-2 cursor-pointer select-none ${labelTextClass}`}>
              <input
                type="checkbox"
                className={checkboxClasses}
                checked={useTeamLogin}
                onChange={e=>{ setUseTeamLogin(e.target.checked); try { localStorage.setItem('useTeamLogin', e.target.checked ? '1' : '0'); } catch {} }}
              />
              <span>تسجيل دخول عضو فريق</span>
            </label>
          </div>

          {useTeamLogin ? (
            <>
              {/* Owner username */}
              <div className="relative">
                <span className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 ${inputIconClass}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zm0 2c-3.866 0-7 3.134-7 7h2a5 5 0 0 1 10 0h2c0-3.866-3.134-7-7-7z" />
                  </svg>
                </span>
                <input value={ownerUsername} onChange={e=>setOwnerUsername(e.target.value)} placeholder="اسم مستخدم المالك" className={inputClass} />
              </div>
              {/* Team username */}
              <div className="relative">
                <span className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 ${inputIconClass}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zm0 2c-3.866 0-7 3.134-7 7h2a5 5 0 0 1 10 0h2c0-3.866-3.134-7-7-7z" />
                  </svg>
                </span>
                <input value={teamUsername} onChange={e=>setTeamUsername(e.target.value)} placeholder="اسم مستخدم عضو الفريق" className={inputClass} />
              </div>
              {/* Password with eye toggle */}
              <PasswordField value={password} onChange={setPassword} tone={isLightTheme ? 'light' : 'dark'} inputClassName={inputClass} />
            </>
          ) : (
            <>
              {/* Username with icon */}
              <div className="relative">
                <span className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 ${inputIconClass}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zm0 2c-3.866 0-7 3.134-7 7h2a5 5 0 0 1 10 0h2c0-3.866-3.134-7-7-7z" />
                  </svg>
                </span>
                <input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="اسم المستخدم أو البريد" className={inputClass} />
              </div>
              {/* Password with eye toggle */}
              <PasswordField value={password} onChange={setPassword} tone={isLightTheme ? 'light' : 'dark'} inputClassName={inputClass} />
            </>
          )}
          <button disabled={loading} className={submitClass}>{loading ? '...' : 'دخول'}</button>
          <p className={consentTextClass}>
            تسجيل الدخول يؤكد موافقتك على
            {' '}
            <a href="/terms" className={consentLinkClass}>
              شروط الاستخدام
            </a>
            {' '}
            و
            {' '}
            <a href="/policy" className={consentLinkClass}>
              سياسة الخصوصية
            </a>
            .
          </p>
          {hasContactLinks && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3" dir="ltr">
              {displayedContactLinks.map((link) => {
                const { Icon, bubbleClass, iconClass } = link.meta;
                return (
                  <a
                    key={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={contactIconButtonBase}
                    title={link.display}
                    aria-label={link.display}
                  >
                    <span className={`${contactIconInnerBase} ${bubbleClass}`}>
                      <Icon className={`h-5 w-5 ${iconClass}`} aria-hidden="true" />
                    </span>
                    <span className="sr-only">{link.display}</span>
                  </a>
                );
              })}
            </div>
          )}
        </form>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="w-full h-screen flex flex-col items-center p-0 md:p-4">{/* نستخدم h-screen لضبط الارتفاع الكامل */}
  <div className="w-full max-w-7xl flex flex-col border border-chatDivider rounded-lg overflow-hidden shadow-xl flex-1 min-h-0">{/* أزلنا height الثابت واستبدلناه بـ flex-1 */}
        <div className="flex flex-1 w-full h-full bg-chatBg isolate">
          {/* Sidebar (شاشات كبيرة فقط) */}
          <aside className="hidden md:flex w-80 md:w-96 bg-chatPanel border-l border-chatDivider flex-col relative z-20">
            <SidebarHeaderAddContact isTeamActor={isTeamActor} onAdded={async (newConv:any)=>{
              const convs = await apiClient.listConversations();
              const convArr = Array.isArray(convs) ? convs : [];
              setConversations(convArr);
              const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
              for (const c of convArr) {
                if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
              }
              setConvMetaById(meta);
              const mapped: {id:number; name:string; avatar:string; otherUsername?:string; last_message_at?: string; last_message_preview?: string; isMuted?: boolean; mutedUntil?: string|null}[] = convArr.map((c: any) => {
                const meId = profile?.id;
                let other = c.user_a;
                if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                return { id: c.id, name: other?.display_name || other?.username || other?.email || 'مستخدم', avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`, otherUsername: other?.username, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview, isMuted: !!(c as any).isMuted, mutedUntil: (c as any).mutedUntil ?? null };
              });
              setContacts(mapped);
              const idx = mapped.findIndex((m:{id:number})=>m.id===newConv.id);
              if(idx!==-1){ setCurrentContactIndex(idx); setSelectedConversationId(newConv.id); }
            }} existingUsernames={contacts.map(c=> c.otherUsername || c.name)} currentUsername={profile?.username} onRefreshContacts={refreshContacts} onSubscriptionGate={(reason)=>{ setSubBannerMsg(reason); setShowSubBanner(true); }} />
            <ul className="flex-1 overflow-y-auto divide-y divide-chatDivider/40 custom-scrollbar">
              {contacts.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-gray-400">
                  لا توجد محادثات بعد — اضغط على زر + لبدء محادثة جديدة
                </li>
              )}
              {contacts
                .slice()
                .sort((a,b)=>{
                  const ap = pinnedIds.includes(a.id) ? 1 : 0;
                  const bp = pinnedIds.includes(b.id) ? 1 : 0;
                  if (ap !== bp) return bp - ap; // pinned first
                  // then by last_message_at desc if available
                  const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                  const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                  return bt - at;
                })
                .map((contact, idx) => (
                <li
                  key={contact.id}
                  onClick={()=>{ const realIdx = contacts.findIndex(c=>c.id===contact.id); setCurrentContactIndex(realIdx); setSelectedConversationId(contact.id); setMobileView('chat'); setOpenMenuForConvId(null); setUnreadByConv(prev=>({ ...prev, [contact.id]: 0 })); }}
                  className={`flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-chatDivider/30 transition ${contact.id === selectedConversationId ? 'bg-chatDivider/50' : ''}`}
                >
                  <img src={contact.avatar} alt={contact.name} className="w-12 h-12 rounded-full border border-chatDivider" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold truncate flex items-center gap-1">{contact.name} {contact.isMuted && <span title="مكتمة">🔕</span>}</span>
                      <span className="text-[11px] text-gray-400" dir="ltr">{contact.last_message_at ? formatTimeShort(contact.last_message_at) : ''}</span>
                    </div>
                    {(() => {
                      const raw = contact.last_message_preview || '';
                      const truncated = truncateContactPreview(raw);
                      return <span className="text-sm text-gray-400">{truncated}</span>;
                    })()}
                  </div>
                  <div
                    className="relative flex items-center gap-2"
                    onClick={(e)=> e.stopPropagation()}
                    ref={(el)=>{
                      if (el) contactMenuRefs.current[contact.id] = el; else delete contactMenuRefs.current[contact.id];
                    }}
                  >
                    {unreadByConv[contact.id] > 0 && (
                      <span className="bg-green-600 text-white rounded-full px-2 py-0.5 text-[11px] leading-none">{unreadByConv[contact.id]}</span>
                    )}
                    <button
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200"
                      title="تحرير"
                      onClick={()=> setOpenMenuForConvId(prev => prev===contact.id ? null : contact.id)}
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                        <path d='M12 20h9'/>
                        <path d='M16.5 3.5a2.121 2.121 0 013 3L7 19 3 20l1-4 12.5-12.5z'/>
                      </svg>
                    </button>
                    {openMenuForConvId === contact.id && (
                      <div className="absolute left-0 top-full mt-2 min-w-[180px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
                        <button
                          onClick={async ()=>{
                            setMuteBusyFor(contact.id);
                            setOpenMenuForConvId(null);
                            const prev = contacts;
                            setContacts(prev.map(c=> c.id===contact.id ? { ...c, isMuted: !c.isMuted } : c));
                            try {
                              if (contact.isMuted) await apiClient.unmuteConversation(contact.id); else await apiClient.muteConversation(contact.id);
                            } catch {
                              setContacts(prev);
                            } finally {
                              setMuteBusyFor(null);
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5 disabled:opacity-50"
                          disabled={muteBusyFor===contact.id}
                        >{contact.isMuted ? 'إلغاء الكتم' : 'كتم المحادثة'}</button>
                        <button
                          onClick={()=>{ setConfirmDialog({ open: true, kind: 'clear', convId: contact.id }); setOpenMenuForConvId(null); }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                        >مسح محتوى الدردشة</button>
                        <button
                          onClick={()=>{ setConfirmDialog({ open: true, kind: 'delete', convId: contact.id }); setOpenMenuForConvId(null); }}
                          className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                        >مسح جهة الاتصال</button>
                        <button
                          onClick={()=>{
                            setPinnedIds(prev => prev.includes(contact.id) ? prev.filter(id=>id!==contact.id) : [contact.id, ...prev]);
                            setOpenMenuForConvId(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                        >{pinnedIds.includes(contact.id) ? 'إلغاء التثبيت' : 'تثبيت في الأعلى'}</button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
          {/* Chat Window */}
          <main className="flex-1 flex flex-col h-full bg-chatBg min-h-0 relative z-0">{/* min-h-0 للسماح للـ overflow بالعمل */}
            {showSubBanner && (
              <div className="bg-amber-500/15 border-b border-amber-400/40 text-amber-200 px-4 py-2 text-xs flex items-center gap-2 flex-wrap md:flex-nowrap">
                <span className="flex-1 min-w-0 whitespace-normal break-words leading-5">{subBannerMsg || 'للوصول الكامل لميزات المنصة يرجى الاشتراك. يمكنك مراسلة الأدمن دون قيود.'}</span>
                <a
                  href="/subscriptions"
                  className={subscriptionCtaClass}
                  style={subscriptionCtaStyle}
                >
                  اذهب لصفحة الاشتراك
                </a>
                <button onClick={()=> setShowSubBanner(false)} className="text-amber-200 hover:text-white shrink-0">✕</button>
              </div>
            )}
            {/* شريط تنبيه بالاشتراك عند وجود أخطاء منطقية من الخادم لاحقاً يمكن ربطه بحالة الملف الشخصي */}
            {/* مبدئياً سنعرض تلميح الانتقال لقسم الاشتراك في حال ظهرت رسائل منع من الخادم عبر التوستات أعلاه */}
            {/* قائمة الدردشات نسخة للجوال */}
            {mobileView === 'list' && (
              <div className="flex flex-col md:hidden h-full">
                <div
                  className="border-b border-chatDivider bg-chatPanel sticky top-0 z-30"
                  style={{ top: 'env(safe-area-inset-top, 0px)' }}
                >
                  <SidebarHeaderAddContact isTeamActor={isTeamActor} onAdded={async (newConv:any)=>{
                    const convs = await apiClient.listConversations();
                    const convArr = Array.isArray(convs) ? convs : [];
                    setConversations(convArr);
                    const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
                    for (const c of convArr) {
                      if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
                    }
                    setConvMetaById(meta);
                    const mapped: {id:number; name:string; avatar:string; otherUsername?:string; last_message_at?: string; last_message_preview?: string; isMuted?: boolean; mutedUntil?: string|null}[] = convArr.map((c: any) => {
                      const meId = profile?.id;
                      let other = c.user_a;
                      if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                      return { id: c.id, name: other?.display_name || other?.username || other?.email || 'مستخدم', avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`, otherUsername: other?.username, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview, isMuted: !!(c as any).isMuted, mutedUntil: (c as any).mutedUntil ?? null };
                    });
                    setContacts(mapped);
                    const idx = mapped.findIndex((m:{id:number})=>m.id===newConv.id);
                    if(idx!==-1){ setCurrentContactIndex(idx); setSelectedConversationId(newConv.id); setMobileView('chat'); }
                  }} existingUsernames={contacts.map(c=> c.otherUsername || c.name)} currentUsername={profile?.username} onRefreshContacts={refreshContacts} onSubscriptionGate={(reason)=>{ setSubBannerMsg(reason); setShowSubBanner(true); }} />
                </div>
                <ul className="flex-1 overflow-y-auto divide-y divide-chatDivider/40 custom-scrollbar">
                  {contacts
                    .slice()
                    .sort((a,b)=>{
                      const ap = pinnedIds.includes(a.id) ? 1 : 0;
                      const bp = pinnedIds.includes(b.id) ? 1 : 0;
                      if (ap !== bp) return bp - ap;
                      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                      return bt - at;
                    })
                    .map((contact, idx) => (
                    <li
                      key={contact.id}
                      onClick={()=>{ const realIdx = contacts.findIndex(c=>c.id===contact.id); setCurrentContactIndex(realIdx); setSelectedConversationId(contact.id); setMobileView('chat'); setOpenMenuForConvId(null); setUnreadByConv(prev=>({ ...prev, [contact.id]: 0 })); }}
                      className={`flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-chatDivider/30 transition ${contact.id === selectedConversationId ? 'bg-chatDivider/50' : ''}`}
                    >
                      <img src={contact.avatar} alt={contact.name} className="w-12 h-12 rounded-full border border-chatDivider" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold truncate flex items-center gap-1">{contact.name} {contact.isMuted && <span title="مكتمة">🔕</span>}</span>
                          <span className="text-[11px] text-gray-400" dir="ltr">{contact.last_message_at ? formatTimeShort(contact.last_message_at) : ''}</span>
                        </div>
                        {(() => {
                          const raw = contact.last_message_preview || '';
                          const truncated = truncateContactPreview(raw);
                          return <span className="text-sm text-gray-400 truncate">{truncated}</span>;
                        })()}
                      </div>
                      <div
                        className="relative flex items-center gap-2"
                        onClick={(e)=> e.stopPropagation()}
                        ref={(el)=>{
                          if (el) contactMenuRefs.current[contact.id] = el; else delete contactMenuRefs.current[contact.id];
                        }}
                      >
                        {unreadByConv[contact.id] > 0 && (
                          <span className="bg-green-600 text-white rounded-full px-2 py-0.5 text-[11px] leading-none">{unreadByConv[contact.id]}</span>
                        )}
                        <button
                          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200"
                          title="تحرير"
                          onClick={()=> setOpenMenuForConvId(prev => prev===contact.id ? null : contact.id)}
                        >
                          <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M12 20h9'/>
                            <path d='M16.5 3.5a2.121 2.121 0 013 3L7 19 3 20l1-4 12.5-12.5z'/>
                          </svg>
                        </button>
                        {openMenuForConvId === contact.id && (
                          <div className="absolute left-0 top-full mt-2 min-w-[180px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
                            <button
                              onClick={async ()=>{
                                setMuteBusyFor(contact.id);
                                setOpenMenuForConvId(null);
                                const prev = contacts;
                                setContacts(prev.map(c=> c.id===contact.id ? { ...c, isMuted: !c.isMuted } : c));
                                try {
                                  if (contact.isMuted) await apiClient.unmuteConversation(contact.id); else await apiClient.muteConversation(contact.id);
                                } catch {
                                  setContacts(prev);
                                } finally {
                                  setMuteBusyFor(null);
                                }
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5 disabled:opacity-50"
                              disabled={muteBusyFor===contact.id}
                            >{contact.isMuted ? 'إلغاء الكتم' : 'كتم المحادثة'}</button>
                            <button
                              onClick={()=>{ setConfirmDialog({ open: true, kind: 'clear', convId: contact.id }); setOpenMenuForConvId(null); }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                            >مسح محتوى الدردشة</button>
                            <button
                              onClick={()=>{ setConfirmDialog({ open: true, kind: 'delete', convId: contact.id }); setOpenMenuForConvId(null); }}
                              className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                            >مسح جهة الاتصال</button>
                            <button
                              onClick={()=>{
                                setPinnedIds(prev => prev.includes(contact.id) ? prev.filter(id=>id!==contact.id) : [contact.id, ...prev]);
                                setOpenMenuForConvId(null);
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                            >{pinnedIds.includes(contact.id) ? 'إلغاء التثبيت' : 'تثبيت في الأعلى'}</button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* واجهة المحادثة */}
            {(selectedConversationId != null && currentContact) && (
              <div className={(mobileView === 'chat' ? 'flex' : 'hidden') + ' md:flex flex-col h-full'}>
                <div
                  className="bg-chatPanel px-6 py-3 font-bold border-b border-chatDivider text-sm flex flex-col gap-2 md:gap-1 relative sticky top-0 z-30 md:static"
                  style={{ top: 'env(safe-area-inset-top, 0px)' }}
                >
                  <div className="flex flex-wrap items-center gap-4 justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      {/* زر رجوع للجوال */}
                      <button onClick={()=>setMobileView('list')} className="md:hidden text-gray-300 hover:text-white" title="رجوع"><svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/></svg></button>
                      <img src={currentContact.avatar} alt={currentContact.name} className="w-9 h-9 rounded-full border border-chatDivider" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold flex items-center gap-1">{currentContact.name} {currentContact.isMuted && <span title="مكتمة">🔕</span>}</span>
                        {isOtherTyping && (
                          <span className="text-[10px] text-green-300 mt-0.5">يكتب الآن…</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center text-gray-300 relative">
                      <button
                        ref={topToolsMenuBtnRef}
                        onClick={()=> setTopToolsMenuOpen(o => !o)}
                        className={`w-9 h-9 rounded-full border flex items-center justify-center transition ${topToolsMenuOpen
                          ? (isLightTheme ? 'border-orange-200 bg-white text-orange-500 shadow' : 'border-chatDivider bg-chatDivider/40 text-white')
                          : (isLightTheme ? 'border-orange-100 bg-white/80 text-orange-400 hover:bg-orange-100' : 'border-chatDivider bg-chatPanel/60 hover:bg-chatDivider/40')}`}
                        aria-haspopup="menu"
                        aria-expanded={topToolsMenuOpen}
                        title="المزيد من الخيارات"
                      >
                        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='currentColor'>
                          <circle cx='12' cy='5' r='1.8' />
                          <circle cx='12' cy='12' r='1.8' />
                          <circle cx='12' cy='19' r='1.8' />
                        </svg>
                      </button>
                      {topToolsMenuOpen && (
                        <div
                          ref={topToolsMenuRef}
                          className="absolute left-0 top-full mt-3 w-48 rounded-xl border border-chatDivider bg-chatBg shadow-2xl overflow-hidden z-40"
                        >
                          <button
                            onClick={()=>{
                              setShowOnlyTransactions(v => !v);
                              setTopToolsMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-xs transition border ${showOnlyTransactions
                              ? (isLightTheme
                                ? 'bg-[#F5FBF6] text-[#134E36] border-[#8DD7B0] shadow-sm'
                                : 'bg-[#133528] text-[#C2F3D4] border-[#2D6A47]')
                              : (isLightTheme
                                ? 'text-[#285E43] hover:bg-[#F7FBF9] border-transparent'
                                : 'text-gray-100 hover:bg-white/10 border-transparent')}`}
                          >
                            <span className="flex items-center gap-2">
                              <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                                <path d='M3 4h18' />
                                <path d='M6 12h12' />
                                <path d='M10 20h4' />
                              </svg>
                              <span>{showOnlyTransactions ? 'عرض جميع الرسائل' : 'فلترة المعاملات فقط'}</span>
                            </span>
                            {showOnlyTransactions && <span className="text-[10px]">✓</span>}
                          </button>
                          <button
                            ref={membersBtnRef}
                            onClick={async()=>{
                              if (!selectedConversationId) return;
                              setTopToolsMenuOpen(false);
                              setMembersPanelOpen(o=>!o);
                              if (!membersPanelOpen) {
                                setMembersBusy(true);
                                try {
                                  const tokenRaw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
                                  const token = tokenRaw ? (JSON.parse(tokenRaw).access as string) : '';
                                  const [team, conv] = await Promise.all([
                                    listTeam(token).catch(()=>[]),
                                    listConversationMembers(token, selectedConversationId).catch(()=>({ members: [] as any[] }))
                                  ]);
                                  setTeamList(team || []);
                                  const mapped = (conv.members || []).map((m: any) => {
                                    const mt: 'user'|'team_member' = (m.role === 'team_member') ? 'team_member' : 'user';
                                    return { id: m.id, username: m.username, display_name: m.display_name || m.username, role: m.role, member_type: mt };
                                  });
                                  setConvMembers(mapped);
                                } finally {
                                  setMembersBusy(false);
                                }
                              }
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-xs text-gray-100 transition hover:bg-white/5"
                          >
                            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                              <path d='M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2' />
                              <circle cx='9' cy='7' r='4' />
                              <path d='M22 21v-2a4 4 0 00-3-3.87' />
                              <path d='M16 3.13a4 4 0 010 7.75' />
                            </svg>
                            <span>أعضاء المحادثة</span>
                          </button>
                          <button
                            onClick={()=>{
                              setTopToolsMenuOpen(false);
                              setSearchOpen(s=>!s);
                              if (!searchOpen) {
                                setTimeout(()=>{
                                  const el = document.getElementById('inchat_search_input');
                                  el && (el as HTMLInputElement).focus();
                                }, 50);
                              }
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-xs text-gray-100 transition hover:bg-white/5"
                          >
                            <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 20 20' fill='currentColor'><path fillRule='evenodd' d='M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z' clipRule='evenodd'/></svg>
                            <span>بحث داخل المحادثة</span>
                          </button>
                          <button
                            onClick={() => {
                              if (!selectedConversationId || !currentContact) return;
                              setTopToolsMenuOpen(false);
                              openExportDialog();
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-xs text-gray-100 transition hover:bg-white/5"
                          >
                            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                              <path d='M12 3v12'/>
                              <path d='M7 11l5 5 5-5'/>
                              <path d='M5 19h14'/>
                            </svg>
                            <span>تصدير المعاملات</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* شريط أرصدة سريع من منظور هذه المحادثة فقط (موجب = لنا، سالب = لكم) — مخفي عند الدردشة مع admin (أو حسابات إدارية مشابهة) أو عند كون المستخدم الحالي أدمن */}
                  {(!isAdminLike(profile?.username) && !isAdminLike(currentContact?.otherUsername)) && (
                    <div
                      dir="rtl"
                      className="flex flex-wrap gap-x-4 gap-y-1 text-xs md:text-sm justify-start"
                    >
                      {(() => {
                        const ORDER = ['USD','TRY','EUR','SYP'];
                        const pair = getPairWallet(selectedConversationId);
                        return ORDER
                          .filter(code => (pair as any)[code] !== undefined)
                          .map(code => {
                            const val = (pair as any)[code] ?? 0;
                            const rounded = Math.round(val * 100) / 100;
                            if (rounded === 0) return null; // إخفاء العملة ذات القيمة صفر
                            const positive = rounded >= 0;
                            const isPending = pendingCurrencies.has(code);
                            return (
                              <span
                                key={code}
                                className={(positive ? 'text-green-400' : 'text-red-400') + ' font-semibold flex items-center gap-1 justify-end md:justify-start text-right flex-none'}
                              >
                                <span dir="ltr" className="inline-flex tabular-nums whitespace-nowrap">
                                  {formatAmount(rounded, code)}
                                </span>
                                {isPending && <span className="text-yellow-400 animate-pulse" title="قيمة مؤقتة قيد التأكيد">⚡</span>}
                              </span>
                            );
                          });
                      })()}
                    </div>
                  )}
                </div>
            {/* Members side panel */}
            {membersPanelOpen && (
              <div ref={membersPanelRef} className="absolute right-0 top-12 md:top-14 z-30 w-full md:w-[420px] max-h-[65vh] overflow-y-auto bg-chatBg border border-chatDivider rounded-lg shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-gray-100">أعضاء المحادثة</div>
                  <button onClick={()=> setMembersPanelOpen(false)} className="text-gray-300 hover:text-white text-xs">إغلاق ✕</button>
                </div>
                {/* Existing members */}
                <div className="mb-3">
                  <div className="text-[11px] text-gray-400 mb-1">المضافون حالياً</div>
                  <ul className="divide-y divide-chatDivider/40 rounded border border-chatDivider/40 overflow-hidden">
                    {convMembers.length === 0 && (
                      <li className="px-3 py-2 text-[11px] text-gray-400">لا يوجد أعضاء بعد</li>
                    )}
                    {convMembers.map(m => (
                      <li key={`m_${m.member_type}_${m.id}`} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-gray-300">{(m.display_name||m.username||'?').slice(0,2)}</div>
                          <div className="truncate">
                            <div className="text-gray-100 truncate">{m.display_name || m.username}</div>
                            <div className="text-[10px] text-gray-400">{(m.role === 'team' || m.role === 'team_member') ? 'عضو فريق' : 'مشارك أساسي'}</div>
                          </div>
                        </div>
                        {!isTeamActor && (
                        <button
                          onClick={async()=>{
                            if (!selectedConversationId) return;
                            setMembersBusy(true);
                            try {
                              const tokenRaw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
                              const token = tokenRaw ? (JSON.parse(tokenRaw).access as string) : '';
                              await removeMemberFromConversation(token, selectedConversationId, m.id, m.member_type || (m.role==='team'?'team_member':'user'));
                              setConvMembers(prev => prev.filter(x => !(x.id === m.id && (x.member_type|| (x.role==='team'?'team_member':'user')) === (m.member_type|| (m.role==='team'?'team_member':'user')))));
                              pushToast({ type: 'success', msg: 'تمت إزالة العضو' });
                              pushCenterAlert({ type:'removed', msg: `تمت إزالة ${(m.display_name||m.username||'عضو')} من المحادثة` });
                            } catch(e:any) {
                              pushToast({ type: 'error', msg: e?.message || 'تعذر الإزالة' });
                            } finally { setMembersBusy(false); }
                          }}
                          className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 text-[11px]"
                          disabled={membersBusy}
                        >إزالة</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Team list to add */}
                <div>
                  <div className="text-[11px] text-gray-400 mb-1">كل أعضاء الفريق</div>
                  <ul className="divide-y divide-chatDivider/40 rounded border border-chatDivider/40 overflow-hidden">
                    {(teamList||[]).map(tm => {
                      const already = convMembers.some(m => m.member_type === 'team_member' && m.id === tm.id);
                      return (
                        <li key={`t_${tm.id}`} className="flex items-center justify-between px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-gray-300">{(tm.display_name||tm.username||'?').slice(0,2)}</div>
                            <div className="truncate">
                              <div className="text-gray-100 truncate">{tm.display_name || tm.username}</div>
                              <div className="text-[10px] text-gray-400">{tm.username}</div>
                            </div>
                          </div>
                          {!isTeamActor && (
                          <button
                            onClick={async()=>{
                              if (!selectedConversationId || already) return;
                              setMembersBusy(true);
                              try {
                                const tokenRaw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
                                const token = tokenRaw ? (JSON.parse(tokenRaw).access as string) : '';
                                await addTeamMemberToConversation(token, selectedConversationId, tm.id);
                                setConvMembers(prev => [...prev, { id: tm.id, username: tm.username, display_name: tm.display_name || tm.username, role: 'team_member', member_type: 'team_member' }]);
                                pushToast({ type: 'success', msg: 'تمت الإضافة للمحادثة' });
                                pushCenterAlert({ type:'added', msg: `تمت إضافة ${(tm.display_name||tm.username||'عضو')} إلى المحادثة` });
                              } catch(e:any) {
                                pushToast({ type: 'error', msg: e?.message || 'تعذر الإضافة' });
                              } finally { setMembersBusy(false); }
                            }}
                            className={"px-2 py-1 rounded border text-[11px] " + (already ? 'bg-white/5 border-white/10 text-gray-400 cursor-not-allowed' : 'bg-green-500/15 hover:bg-green-500/25 border-green-500/25 text-green-300')}
                            disabled={already || membersBusy}
                          >{already ? 'مضاف' : 'إضافة +'}</button>
                          )}
                        </li>
                      );
                    })}
                    {(!teamList || teamList.length === 0) && (
                      <li className="px-3 py-2 text-[11px] text-gray-400">لا يوجد أعضاء فريق. يمكنك إضافة أعضاء من صفحة الفريق.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
            {/* إشعار طلب حذف المحادثة وجهة الاتصال */}
            {selectedConversationId && pendingDeleteByConv[selectedConversationId] && (
              <div className="bg-yellow-500/10 border-y border-yellow-400/40 text-yellow-200 px-6 py-2 text-xs flex items-center gap-3">
                <span className="font-semibold">هناك طلب حذف لهذه المحادثة وجهة الاتصال.</span>
                <span className="px-2 py-0.5 rounded bg-yellow-300 text-yellow-900 font-bold">سيتم حذف المطابقة المالية بين الطرفين</span>
                <span className="ml-auto"></span>
                {(profile?.username && pendingDeleteByConv[selectedConversationId].from !== profile.username) ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async()=>{
                        try { await apiClient.approveDeleteConversation(selectedConversationId!); }
                        catch(e:any){ pushToast({type:'error', msg: e?.message||'تعذر الموافقة'}); }
                      }}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
                    >موافقة على الحذف</button>
                    <button
                      onClick={async()=>{
                        try { await apiClient.declineDeleteConversation(selectedConversationId!); setPendingDeleteByConv(prev=>{ const cp:any={...prev}; delete cp[selectedConversationId!]; return cp; }); pushToast({type:'info', msg:'تم رفض طلب الحذف'}); }
                        catch(e:any){ pushToast({type:'error', msg: e?.message||'تعذر الرفض'}); }
                      }}
                      className="px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white"
                    >رفض</button>
                  </div>
                ) : (
                  <span className="text-[11px]">تم إرسال الطلب — بانتظار موافقة الطرف الآخر</span>
                )}
              </div>
            )}
            {searchOpen && (
              <div className="bg-chatPanel/90 border-b border-chatDivider px-3 py-2 flex items-center gap-1">
                <input
                  id="inchat_search_input"
                  value={searchQuery}
                  onChange={(e)=>{ setSearchQuery(e.target.value); setActiveMatchIdx(0); }}
                  placeholder="ابحث داخل هذه الدردشة"
                  className="flex-1 min-w-0 bg-chatBg border border-chatDivider rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-600 text-gray-100"
                />
                <span className="text-[10px] text-gray-400 min-w-[3rem] text-center px-1">
                  {searchQuery.trim() ? (searchMatches.length ? `${(activeMatchIdx+1)}/${searchMatches.length}` : 'لا نتائج') : ''}
                </span>
                <div className="flex items-center gap-0.5">
                  {/* removed info button by request */}
                  <button
                    onClick={()=> setActiveMatchIdx(i=> (i-1+Math.max(1,searchMatches.length)) % Math.max(1,searchMatches.length))}
                    disabled={!searchMatches.length}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 backdrop-blur-sm"
                    title="السابق"
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M15 5l-7 7 7 7'/></svg>
                  </button>
                  <button
                    onClick={()=> setActiveMatchIdx(i=> (i+1) % Math.max(1,searchMatches.length))}
                    disabled={!searchMatches.length}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 backdrop-blur-sm"
                    title="التالي"
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M9 5l7 7-7 7'/></svg>
                  </button>
                  <button onClick={()=>{ setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300" title="إغلاق">✕</button>
                </div>
              </div>
            )}
            <div
              ref={scrollRef}
              className={`flex-1 p-6 pb-56 md:pb-44 flex flex-col gap-2 overflow-y-auto overflow-x-hidden custom-scrollbar transition-colors duration-500 ${isLightTheme ? 'bg-[radial-gradient(circle_at_top,_rgba(255,241,224,0.92),_rgba(255,255,255,0.98))]' : 'bg-[#0f1f25]'}`}
              dir="rtl"
              id="chatScrollRegion"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 13.5rem)' }}
            >{/* pb-48 للجوال كي لا يغطي الشريط الثابت الرسائل + safe-area */}
              {(function(){
                const parts: React.ReactNode[] = [];
                let lastDayKey = '';
                const dayChipClass = isLightTheme
                  ? 'mx-auto my-3 text-[10px] px-3 py-1 bg-orange-200/70 text-orange-800 border border-orange-300/60 rounded-full shadow-sm'
                  : 'mx-auto my-3 text-[10px] px-3 py-1 bg-gray-700/60 border border-chatDivider rounded-full text-gray-200';
                const systemBubbleClass = isLightTheme
                  ? 'self-center bg-orange-200/70 text-orange-900 px-3 py-1.5 rounded-full text-[11px] border border-orange-300/60 shadow-sm'
                  : 'self-center bg-gray-700/60 text-gray-100 px-3 py-1.5 rounded-full text-[11px] border border-white/10';
                if (showOnlyTransactions) {
                  parts.push(
                    <div
                      key="filter_badge"
                      className={`mx-auto mt-1 mb-0 text-[11px] px-3 py-1 rounded-full border flex items-center gap-2 ${isLightTheme
                        ? 'bg-[#F5FBF6] text-[#134E36] border-[#8DD7B0] shadow-sm'
                        : 'bg-[#133528] text-[#C2F3D4] border-[#2D6A47]'}`}
                    >
                      <span>عرض المعاملات فقط</span>
                      <span className="font-semibold" dir="ltr">{visibleMessages.length}</span>
                      <button onClick={()=> setShowOnlyTransactions(false)} className="ml-2 text-[10px] underline decoration-dotted">
                        إلغاء
                      </button>
                    </div>
                  );
                }
                if (visibleMessages.length === 0) {
                  parts.push(
                    <div key="empty_state" className={`mx-auto mt-10 text-sm ${isLightTheme ? 'text-gray-500 bg-white/70' : 'text-gray-300 bg-white/5'} border ${isLightTheme ? 'border-orange-200/60' : 'border-white/10'} px-4 py-2 rounded-2xl shadow-sm`}>
                      {showOnlyTransactions ? 'لا توجد معاملات محفوظة بعد في هذه المحادثة.' : 'ابدأ المحادثة بكتابة رسالة في الأسفل.'}
                    </div>
                  );
                  return parts;
                }
                visibleMessages.forEach((m, i) => {
                  const dk = dayKeyOf(m.created_at);
                  if (dk !== lastDayKey && dk !== 'unknown') {
                    parts.push(
                      <div key={`sep_${dk}`} className={dayChipClass}>
                        {dayLabelOf(m.created_at)}
                      </div>
                    );
                    lastDayKey = dk;
                  }
                  if (isWalletSettlementMessage(m)) {
                    const key = buildMessageKey(m, i, 'wallet');
                    parts.push(
                      <div key={key} ref={(el)=>{ messageRefs.current[key] = el; }} className="self-center w-full flex justify-center">
                        <WalletSettlementCard msg={m} isLight={isLightTheme} />
                      </div>
                    );
                    return;
                  }
                  if (m.kind === 'transaction' && m.tx) {
                    const key = buildMessageKey(m, i, 'tx');
                    parts.push(
                      <div key={key} ref={(el)=>{ messageRefs.current[key] = el; }} className={m.sender === 'current' ? 'self-start' : 'self-end'}>
                        {m.senderDisplay && (
                          <div className="text-[10px] text-gray-400 mb-1">{m.senderDisplay}</div>
                        )}
                        <TransactionBubble
                          sender={m.sender}
                          tx={m.tx}
                          createdAt={m.created_at}
                          isLight={isLightTheme}
                          noteContent={searchQuery ? highlightText(m.tx.note || '', searchQuery) : undefined}
                        />
                        {searchQuery && m.tx.note && (
                          <div className="sr-only">{m.tx.note}</div>
                        )}
                      </div>
                    );
                  } else if (m.kind === 'system') {
                    const key = buildMessageKey(m, i, 'sys');
                    parts.push(
                      <div key={key} ref={(el)=>{ messageRefs.current[key] = el; }} className={systemBubbleClass}>
                        {m.text}
                      </div>
                    );
                  } else {
                    const key = buildMessageKey(m, i, 'msg');
                    const content = m.text;
                    const showHighlight = !!searchQuery.trim();
                    const bubbleMax = 'inline-flex flex-col w-fit max-w-[200px] md:max-w-[300px] xl:max-w-[360px]';
                    const mineBubbleClass = isLightTheme
                      ? `self-start bg-bubbleSent text-gray-900 px-3 py-2 rounded-2xl rounded-bl-sm ${bubbleMax} text-xs shadow whitespace-pre-line break-words`
                      : `self-start bg-bubbleSent text-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm ${bubbleMax} text-xs shadow whitespace-pre-line break-words`;
                    const theirsBubbleClass = isLightTheme
                      ? `self-end bg-bubbleReceived text-gray-900 px-3 py-2 rounded-2xl rounded-br-sm ${bubbleMax} text-xs shadow whitespace-pre-line break-words`
                      : `self-end bg-bubbleReceived text-white px-3 py-2 rounded-2xl rounded-br-sm ${bubbleMax} text-xs shadow whitespace-pre-line break-words`;
                    const hasAttachment = !!(m.attachment && (m.attachment.url || m.attachment.name));
                    const showMeta = hasAttachment || !!content;
                    parts.push(
                      <div
                        key={key}
                        ref={(el)=>{ messageRefs.current[key] = el; }}
                        className={m.sender === 'current' ? mineBubbleClass : theirsBubbleClass}
                      >
                        {m.senderDisplay && (
                          <div className="text-[10px] text-gray-300 mb-1">{m.senderDisplay}</div>
                        )}
                        {/* Attachment preview if present */}
                        {hasAttachment && (
                          <div className="mb-1">
                            {(() => {
                              const url = m.attachment.url || '';
                              const mime = m.attachment.mime || '';
                              const isImage = (mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(url);
                              if (isImage && url) {
                                return (
                                  <img
                                    src={url}
                                    alt={m.attachment.name || 'image'}
                                    className="block h-auto max-w-[min(100%,220px)] md:max-w-[min(100%,320px)] object-contain rounded border border-white/10 cursor-zoom-in hover:opacity-90 transition"
                                    onClick={(e)=>{ e.stopPropagation(); openImageAt(url); }}
                                  />
                                );
                              }
                              const downloadName = m.attachment.name || 'مرفق';
                              const meta = buildFileMeta(m.attachment.mime, m.attachment.name, m.attachment.size ?? null);
                              const kind = inferFileKind(m.attachment.mime, m.attachment.name);
                              const previewKey = buildMessageKey(m, i, 'preview');
                              const previewState = filePreviewCache[previewKey];
                              const previewUrl = previewState?.dataUrl || null;
                              const previewStatus = previewState?.status || 'idle';
                              const previewLoading = previewStatus === 'loading';
                              const previewError = previewStatus === 'error';
                              const cardClass = isLightTheme
                                ? 'bg-white/95 border border-orange-200/70 text-gray-800 shadow-sm'
                                : 'bg-white/5 border border-white/10 text-gray-100 backdrop-blur-sm';
                              const buttonClass = isLightTheme
                                ? 'text-sm font-semibold py-2 text-orange-600 hover:bg-orange-50 transition'
                                : 'text-sm font-semibold py-2 text-green-300 hover:bg-white/10 transition';
                              const disabled = !url;
                              const handleClick = (evt: ReactMouseEvent<HTMLAnchorElement>) => { if (!url) evt.preventDefault(); evt.stopPropagation(); };
                              return (
                                <div className={`w-full max-w-xs md:max-w-sm rounded-2xl overflow-hidden ${cardClass}`}>
                                  {(previewUrl || previewLoading) && (
                                    <div className={`relative w-full overflow-hidden ${isLightTheme ? 'bg-gray-100 border-b border-orange-200/60' : 'bg-black/40 border-b border-white/10'}`}>
                                      {previewUrl ? (
                                        <img
                                          src={previewUrl}
                                          alt={downloadName}
                                          className="w-full h-auto object-cover"
                                        />
                                      ) : (
                                        <div className={`h-28 grid place-items-center text-[11px] ${isLightTheme ? 'text-orange-500' : 'text-white/70'}`}>
                                          جاري إنشاء معاينة…
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {!previewUrl && previewError && (
                                    <div className={`px-3 pt-3 text-[11px] ${isLightTheme ? 'text-red-500' : 'text-red-300'}`}>
                                      تعذر إنشاء معاينة للملف
                                    </div>
                                  )}
                                  <div className="p-3 flex flex-col items-end gap-1 text-right" dir="rtl">
                                    <div className="font-semibold text-sm break-words" dir="auto">{downloadName}</div>
                                    {meta && <div className="text-[11px] opacity-70" dir="auto">{meta}</div>}
                                  </div>
                                  <div className={`grid grid-cols-2 border-t ${isLightTheme ? 'border-orange-200/60' : 'border-white/10'}`}>
                                    <a
                                      href={url || undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={handleClick}
                                      className={`text-center ${buttonClass} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                    >فتح</a>
                                    <a
                                      href={url || undefined}
                                      download={downloadName}
                                      onClick={handleClick}
                                      className={`text-center border-r ${isLightTheme ? 'border-orange-200/60' : 'border-white/10'} ${buttonClass} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                    >حفظ باسم…</a>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {/* Text with ticks (no inline time) */}
                        {content && (
                          <NormalTextBubble
                            content={content}
                            showHighlight={showHighlight}
                            searchQuery={searchQuery}
                            highlightText={highlightText}
                          />
                        )}
                        {showMeta && (
                          <div className="mt-1 text-[11px] opacity-70 flex items-center gap-1 justify-end" dir="auto">
                            <span dir="ltr">{formatTimeShort(m.created_at)}</span>
                            {m.sender === 'current' && (() => {
                                                  const readAt = m.read_at || null;
                                                  const ds = typeof m.delivery_status === 'number' ? (m.delivery_status >=2 ? 2 : 1) : (m.status === 'read' ? 2 : 1);
                                                  const isRead = !!readAt || ds >= 2;
                                                  return <Ticks read={isRead} className={isRead ? 'text-blue-400' : 'text-gray-400'} />;
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  }
                });
                return parts;
              })()}
              {/* فاصل غير مقروءة بسيط: في هذه النسخة المبدئية لم نحدد بدقة مكانه */}
              {unreadDividerId && (
                <div className="my-2 text-center text-[10px] text-gray-400">رسائل غير مقروءة</div>
              )}
            </div>
            {/* شريط سفلي موحد (معاملات + رسالة) */}
            <div
              className="border-t border-chatDivider bg-chatPanel sticky bottom-0 z-50 flex flex-col gap-2 p-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)' }}
            >
              {(!isAdminLike(profile?.username) && !isAdminLike(currentContact?.otherUsername)) && (
                <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
                  <select value={selectedCurrency} onChange={e=>setSelectedCurrency(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none w-auto min-w-0">
                    {effectiveCurrencies.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                  <input
                    value={amountOurs}
                    onChange={e=>setAmountOurs(sanitizeAmountInput(e.target.value))}
                    inputMode="decimal"
                    placeholder="لنا"
                    className="w-24 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none"
                  />
                  <input
                    value={amountYours}
                    onChange={e=>setAmountYours(sanitizeAmountInput(e.target.value))}
                    inputMode="decimal"
                    placeholder="لكم"
                    className="w-24 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none"
                  />
                  <button
                    onClick={()=>setNoteModalOpen(true)}
                    className="relative group w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200 transition"
                    title="إضافة ملاحظة"
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.6} d='M11 5H6a2 2 0 00-2 2v9.5A1.5 1.5 0 005.5 18H15a2 2 0 002-2v-1M16 3l5 5M16 3v4a1 1 0 001 1h4' />
                    </svg>
                  </button>
                  <button
                    onClick={addTransaction}
                    disabled={txLoading}
                    className={`relative group w-9 h-9 flex items-center justify-center transition disabled:opacity-50 ${greenActionButtonClass}`}
                    title="حفظ المعاملة"
                  >
                    {txLoading ? (
                      <svg className='animate-spin h-5 w-5 text-green-300' viewBox='0 0 24 24'>
                        <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='3'></circle>
                        <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z'></path>
                      </svg>
                    ) : (
                      <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                        <polygon points='22 2 15 22 11 13 2 9 22 2'></polygon>
                        <line x1='22' y1='2' x2='11' y2='13'></line>
                      </svg>
                    )}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                {/* معاينة مرفق قيد الانتظار */}
                {pendingAttachment && (
                  <div
                    className="flex items-center gap-1 text-xs text-gray-200 bg-white/5 border border-white/10 rounded px-2 py-1"
                    title={pendingAttachment.name || undefined}
                  >
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      className='h-4 w-4'
                      viewBox='0 0 24 24'
                      fill='currentColor'
                      aria-hidden='true'
                    >
                      <path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/>
                      <path d='M14 2v6h6'/>
                    </svg>
                    <span className="sr-only">{pendingAttachment.name}</span>
                    <button onClick={()=> setPendingAttachment(null)} className="ml-1 text-gray-400 hover:text-white" title="إزالة">×</button>
                  </div>
                )}
                <input type="file" id="chat_file_input" className="hidden" accept="image/*,application/pdf" onChange={async (e)=>{
                  try {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    // تحقق محلي يطابق حدود الخادم
                    const isPdf = f.type === 'application/pdf';
                    const max = isPdf ? 10*1024*1024 : 5*1024*1024;
                    if (f.size > max) { pushToast({ type: 'error', msg: isPdf ? 'حجم PDF يتجاوز 10MB' : 'حجم الصورة يتجاوز 5MB' }); (e.target as HTMLInputElement).value = ''; return; }
                    setPendingAttachment(f);
                    // نظّف قيمة المدخل للسماح باختيار نفس الملف لاحقاً
                    (e.target as HTMLInputElement).value = '';
                  } catch {}
                }} />
                <button className="text-gray-400 hover:text-white" title="إرفاق" onClick={()=>{ const el = document.getElementById('chat_file_input') as HTMLInputElement|null; el?.click(); }}><svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 10-5.656-5.656L6.343 10.172'/></svg></button>
                <div className="relative">
                  <button
                    ref={emojiButtonRef}
                    className={`w-9 h-9 flex items-center justify-center rounded-lg border transition ${isLightTheme ? 'border-orange-100 bg-white/70 text-orange-400 hover:bg-orange-100' : 'border-white/10 bg-white/5 hover:bg-white/10 text-yellow-200'}`}
                    title="إضافة إيموجي"
                    onClick={()=> setEmojiPanelOpen(o => !o)}
                    aria-haspopup="dialog"
                    aria-expanded={emojiPanelOpen}
                  >
                    <span className="text-lg" aria-hidden="true">😊</span>
                    <span className="sr-only">إضافة رمز تعبيري</span>
                  </button>
                  {emojiPanelOpen && (
                    <div
                      ref={emojiPanelRef}
                      className={`absolute bottom-12 right-0 z-50 w-56 rounded-2xl border shadow-2xl p-3 backdrop-blur ${isLightTheme ? 'bg-white/95 border-orange-100 text-gray-700' : 'bg-[#102028]/95 border-chatDivider text-gray-100'}`}
                    >
                      <div className="text-[10px] text-gray-400 mb-2">اختر رمزاً لإضافته</div>
                      <div className="grid grid-cols-6 gap-1">
                        {EMOJI_PALETTE.map(emoji => (
                          <button
                            key={emoji}
                            onClick={()=> appendEmoji(emoji)}
                            className={`h-8 w-8 flex items-center justify-center rounded-lg transition text-lg ${isLightTheme ? 'hover:bg-orange-100' : 'hover:bg-white/10'}`}
                            title={emoji}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] text-gray-400 text-center">اضغط خارج اللوحة للإغلاق</div>
                    </div>
                  )}
                </div>
                <textarea
                  ref={textAreaRef}
                  rows={1}
                  value={outgoingText}
                  onChange={(e)=>{ onChangeOutgoing(e.target.value); adjustTextareaHeight(); }}
                  onKeyDown={(e)=>{
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                      setTimeout(()=>{ try{ const socket = wsRef.current; if (socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify({ type:'typing', state:'stop'})); }catch{} }, 100);
                    }
                  }}
                  placeholder="اكتب رسالة"
                  className="flex-1 border border-chatDivider bg-chatBg text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-600 resize-none overflow-y-auto min-h-[40px] max-h-40"
                />
                  <button
                   onClick={sendChat}
                   className={`w-10 h-10 flex items-center justify-center transition ${greenActionButtonClass}`}
                   title="إرسال الرسالة"
                 >
                   <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                     <polygon points='22 2 15 22 11 13 2 9 22 2'></polygon>
                     <line x1='22' y1='2' x2='11' y2='13'></line>
                   </svg>
                 </button>
               </div>
               {/* typing indicator moved to header under contact name */}
            </div>
            {/* إغلاق الغلاف الخاص بواجهة المحادثة */}
            </div>
            )}
            {mobileView === 'chat' && (selectedConversationId == null || !currentContact) && (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
                اختر محادثة من القائمة أو ابدأ محادثة جديدة من زر +
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
    {/* Toasts */}
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 rtl:right-auto rtl:left-4">
      {toasts.map(t => (
        <div key={t.id} className={"px-4 py-2 rounded shadow text-xs font-semibold border " + (t.type==='success' ? 'bg-green-600/90 border-green-400 text-white' : t.type==='error' ? 'bg-red-600/90 border-red-400 text-white' : 'bg-gray-600/90 border-gray-400 text-white') }>
          {t.msg}
        </div>
      ))}
    </div>
    {/* Centered Alerts */}
    {centerAlerts.length > 0 && (
      <div className="fixed inset-0 z-[60] pointer-events-none flex items-start justify-center pt-24">
        <div className="flex flex-col gap-2 w-full max-w-md px-4">
          {centerAlerts.map(a => (
            <div key={a.id} className={"mx-auto text-center px-4 py-3 rounded-lg border shadow-lg text-sm font-semibold w-full " + (a.type==='removed' ? 'bg-red-600/90 border-red-400 text-white' : a.type==='added' ? 'bg-green-600/90 border-green-400 text-white' : 'bg-gray-700/90 border-gray-500 text-white') }>
              {a.msg}
            </div>
          ))}
        </div>
      </div>
    )}
    {/* Lightbox Overlay */}
    {lightboxOpen && (() => {
      const items = buildImageItems();
      const item = items[lightboxIndex];
      if (!item) return null;
      return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col" onClick={()=> setLightboxOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span className="opacity-80 truncate pr-2">{item.name || 'صورة'}</span>
            <div className="flex items-center gap-2">
              <a href={item.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">فتح في تبويب</a>
              <button onClick={(e)=>{ e.stopPropagation(); setLightboxOpen(false); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">إغلاق ✕</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-2" onClick={(e)=> e.stopPropagation()}>
            <img src={item.url} alt={item.name || 'image'} className="max-h-[85vh] max-w-[95vw] object-contain" />
          </div>
          {items.length > 1 && (
            <>
              <button
                onClick={(e)=>{ e.stopPropagation(); setLightboxIndex(i=> Math.max(0, i-1)); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                title="السابق"
              >
                ‹
              </button>
              <button
                onClick={(e)=>{ e.stopPropagation(); setLightboxIndex(i=> Math.min(items.length-1, i+1)); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                title="التالي"
              >
                ›
              </button>
            </>
          )}
        </div>
      );
    })()}
    {exportModalOpen && currentContact && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4">
        <div
          ref={exportModalRef}
          className="bg-chatPanel border border-chatDivider rounded-xl w-full max-w-md p-5 flex flex-col gap-4 shadow-2xl"
          dir="rtl"
        >
          <div className="space-y-1 text-center">
            <h3 className="font-bold text-gray-100 text-sm">
              سجل المعاملات المالية بين {(profile?.display_name || profile?.username || 'أنت')} و {currentContact.name}
            </h3>
            <p className="text-[11px] text-gray-300">
              سيتم تصدير المعاملات المالية بين التاريخين المحددين فقط
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 text-xs text-gray-200">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-300">من تاريخ</span>
              <input
                type="date"
                value={exportDateFrom}
                onChange={(e)=>{ setExportDateFrom(e.target.value); setExportError(null); }}
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-green-600 text-gray-100"
                disabled={exportBusy}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-300">إلى تاريخ</span>
              <input
                type="date"
                value={exportDateTo}
                onChange={(e)=>{ setExportDateTo(e.target.value); setExportError(null); }}
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-green-600 text-gray-100"
                disabled={exportBusy}
              />
            </label>
          </div>
          <div className="text-xs text-gray-200">
            <span className="block text-[11px] text-gray-300 mb-2">صيغة الملف</span>
            <div className="flex items-center gap-4">
              <label className={"flex items-center gap-2 px-3 py-2 rounded-full border cursor-pointer transition " + (exportFormat === 'excel' ? 'border-green-400/60 bg-green-500/10 text-green-200' : 'border-chatDivider bg-chatBg/60 text-gray-100 hover:bg-white/5')}>
                <input
                  type="radio"
                  className="hidden"
                  name="export_format"
                  checked={exportFormat === 'excel'}
                  onChange={()=> { setExportFormat('excel'); setExportError(null); }}
                  disabled={exportBusy}
                />
                <span className="text-[11px] font-semibold">Excel</span>
              </label>
              <label className={"flex items-center gap-2 px-3 py-2 rounded-full border cursor-pointer transition " + (exportFormat === 'pdf' ? 'border-blue-400/60 bg-blue-500/10 text-blue-200' : 'border-chatDivider bg-chatBg/60 text-gray-100 hover:bg-white/5')}>
                <input
                  type="radio"
                  className="hidden"
                  name="export_format"
                  checked={exportFormat === 'pdf'}
                  onChange={()=> { setExportFormat('pdf'); setExportError(null); }}
                  disabled={exportBusy}
                />
                <span className="text-[11px] font-semibold">PDF</span>
              </label>
            </div>
          </div>
          {exportError && (
            <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
              {exportError}
            </div>
          )}
          <div className="flex justify-end gap-2 text-xs">
            <button
              onClick={()=> setExportModalOpen(false)}
              className="px-3 py-1.5 rounded bg-gray-600/70 hover:bg-gray-500 text-white disabled:opacity-60"
              disabled={exportBusy}
            >
              إلغاء
            </button>
            <button
              onClick={handleConfirmExport}
              className={`px-4 py-1.5 rounded font-semibold transition ${exportBusy ? 'bg-green-500/40 text-green-100 cursor-wait' : 'bg-green-600 hover:bg-green-700 text-white'}`}
              disabled={exportBusy}
            >
              {exportBusy ? 'جارٍ التصدير…' : 'موافق'}
            </button>
          </div>
        </div>
      </div>
    )}
    {noteModalOpen && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-chatPanel border border-chatDivider rounded-lg w-full max-w-md p-4 flex flex-col gap-3">
          <h3 className="font-bold text-gray-100 text-sm">إضافة ملاحظة</h3>
          <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} rows={4} className="w-full resize-none bg-chatBg border border-chatDivider rounded p-2 text-gray-100 text-xs focus:outline-none focus:ring-1 focus:ring-green-600" placeholder="اكتب ملاحظتك هنا"></textarea>
          <div className="flex justify-end gap-2 text-xs">
            <button onClick={()=>{setNoteText(''); setNoteModalOpen(false);}} className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">إلغاء</button>
            <button onClick={()=>{setNoteModalOpen(false);}} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">حفظ مؤقتاً</button>
          </div>
        </div>
      </div>
    )}
    {confirmDialog?.open && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-chatPanel border border-chatDivider rounded-lg w-full max-w-sm p-4 flex flex-col gap-3">
          <h3 className="font-bold text-gray-100 text-sm">
            {confirmDialog.kind === 'delete' ? 'تأكيد حذف جهة الاتصال' : 'تأكيد مسح محتوى الدردشة'}
          </h3>
          <div className="text-[12px] text-gray-200 leading-6">
            {confirmDialog.kind === 'delete'
              ? 'سيتم حذف جهة الاتصال والمحادثة المرتبطة بها من قائمتك بعد موافقة الطرف الآخر. لن تتمكن من استعادة الرسائل المحذوفة. سيتم إرسال طلب حذف إلى الطرف الآخر. هل أنت متأكد؟'
              : 'سيتم مسح جميع رسائل هذه المحادثة من جهازك وقاعدة البيانات ولن يمكن استعادتها. هل أنت متأكد؟'}
            {confirmDialog.kind === 'delete' && (
              <div className="mt-2">
                <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-[12px] font-bold">سيتم حذف المطابقة المالية بين الطرفين</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 text-xs mt-1">
            <button onClick={()=> setConfirmDialog(null)} className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">إلغاء</button>
            <button
              onClick={async()=>{
                const id = confirmDialog!.convId;
                const kind = confirmDialog!.kind;
                if (kind === 'clear') {
                  try {
                    await apiClient.clearConversation(id);
                    if (selectedConversationId === id) {
                      setMessages([]);
                      setSummary(null);
                      setNetBalance(null);
                    }
                    setContacts(prev => prev.map(c => c.id===id ? { ...c, last_message_preview: '', last_message_at: null } : c));
                    pushToast({type:'success', msg:'تم مسح محتوى الدردشة'});
                  } catch(e:any) {
                    pushToast({type:'error', msg: e?.message||'فشل المسح'});
                  } finally {
                    setConfirmDialog(null);
                  }
                } else if (kind === 'delete') {
                  try {
                    try {
                      await apiClient.requestDeleteConversation(id);
                    } catch (err:any) {
                      if (err && err.otp_required) {
                        const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) لتأكيد طلب الحذف') : '';
                        if (!code) throw err;
                        await apiClient.requestDeleteConversation(id, code);
                      } else {
                        throw err;
                      }
                    }
                    setPendingDeleteByConv(prev=> ({ ...prev, [id]: { from: profile?.username || 'me', at: new Date().toISOString() } }));
                    pushToast({type:'info', msg:'تم إرسال طلب الحذف وينتظر الموافقة'});
                  } catch(e:any) {
                    pushToast({type:'error', msg: e?.message||'تعذر إرسال طلب الحذف'});
                  } finally {
                    setConfirmDialog(null);
                  }
                }
              }}
              className={"px-3 py-1 rounded text-white " + (confirmDialog.kind==='delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700')}
            >
              {confirmDialog.kind === 'delete' ? 'إرسال طلب الحذف' : 'مسح نهائي'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
