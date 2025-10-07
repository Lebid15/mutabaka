import FeatherIcon from '@expo/vector-icons/Feather';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import ChatBubble from '../components/ChatBubble';
import WalletSettlementCard from '../components/WalletSettlementCard';
import { conversations, messages } from '../data/mock';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { HttpError } from '../lib/httpClient';
import { environment } from '../config/environment';
import { getAccessToken } from '../lib/authStorage';
import {
  fetchConversation,
  fetchNetBalance,
  fetchConversationMembers,
  addConversationTeamMember,
  removeConversationMember,
  approveDeleteConversation,
  declineDeleteConversation,
  type ConversationDto,
  type NetBalanceResponse,
  type ConversationMemberSummary,
} from '../services/conversations';
import { fetchMessages, fetchMessagesSince, sendMessage, sendAttachment, type MessageDto, type UploadAttachmentAsset } from '../services/messages';
import { fetchCurrencies, bootstrapCurrencies, type CurrencyDto } from '../services/currencies';
import { createTransaction, fetchTransactions } from '../services/transactions';
import type { TransactionDto } from '../services/transactions';
import { fetchCurrentUser, type CurrentUser } from '../services/user';
import { emitConversationPreviewUpdate } from '../lib/conversationEvents';
import { createWebSocket } from '../lib/wsClient';
import { listTeamMembers, type TeamMember } from '../services/team';

interface BalanceSummary {
  code: string;
  symbol?: string | null;
  amount: number;
}

interface CurrencyOption {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
}

interface TransactionDetails {
  direction: 'lna' | 'lkm';
  amount: number;
  symbol: string;
  currency: string;
  note?: string;
}

interface AttachmentMeta {
  url: string | null;
  name?: string | null;
  mime?: string | null;
  size?: number | null;
}

type ConversationMemberRole = 'participant' | 'team' | 'team_member';
type MemberType = 'user' | 'team_member';

interface ConversationMemberItem {
  memberId: number;
  username: string;
  displayName: string;
  role: ConversationMemberRole;
  memberType: MemberType;
}

const ADMIN_USERNAMES = new Set(['admin', 'madmin', 'a_admin', 'l_admin']);

const EMOJI_PALETTE = ['😀','😂','😍','👍','🙏','🎉','💰','📌','❤️','😢','😎','🤔','✅','❌','🔥','🌟','🥰','😮','💡','📈','🤥','🌎'];

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PDF_MIME_TYPE = 'application/pdf';
const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: PDF_MIME_TYPE,
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const DEFAULT_ATTACHMENT_PREVIEW = '📎 مرفق';
const OTP_MAX_ATTEMPTS = 3;
const DEFAULT_OTP_PROMPT_MESSAGE = 'الرجاء إدخال رمز التحقق المكوَّن من 6 أرقام.';

class OtpCancelledError extends Error {
  constructor() {
    super('OTP_CANCELLED');
    this.name = 'OtpCancelledError';
  }
}

function normalizeMimeType(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (lower === 'image/jpg') {
    return 'image/jpeg';
  }
  return lower;
}

function resolveMimeType(filename?: string | null, mime?: string | null): string | null {
  const normalized = normalizeMimeType(mime);
  if (normalized) {
    return normalized;
  }
  if (!filename) {
    return null;
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  return EXTENSION_MIME_MAP[ext] ?? null;
}

function isAdminLike(username?: string | null): boolean {
  if (!username) {
    return false;
  }
  return ADMIN_USERNAMES.has(username.toLowerCase());
}

function arabicToEnglishDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeNumberString(raw: string): string {
  const normalized = arabicToEnglishDigits(raw || '')
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '')
    .replace(/,/g, '.')
    .trim();
  return normalized;
}

function parseNumericInput(raw: string): number {
  if (!raw) {
    return Number.NaN;
  }
  const normalized = normalizeNumberString(raw);
  if (!normalized) {
    return Number.NaN;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return Number.NaN;
  }
  return Number(value.toFixed(5));
}

function formatBalance(amount: number): string {
  const absolute = Math.abs(amount);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absolute);
}

function computePairBalancesFromNet(net: NetBalanceResponse | null, viewerIsUserA: boolean): BalanceSummary[] {
  if (!net || !Array.isArray(net.net)) {
    return [];
  }

  return net.net
    .map((entry) => {
      const currencyMeta = entry?.currency as { code?: string; symbol?: string | null } | null | undefined;
      const code = currencyMeta?.code;
      if (!code) {
        return null;
      }

      const rawValue = entry?.net_from_user_a_perspective;
      const numericValue = typeof rawValue === 'number'
        ? rawValue
        : Number.parseFloat(String(rawValue ?? '0'));
      if (!Number.isFinite(numericValue)) {
        return null;
      }

      const amount = viewerIsUserA ? numericValue : numericValue * -1;
      const symbol = (currencyMeta as { symbol?: string | null } | null | undefined)?.symbol ?? null;
      return {
        code,
        symbol,
        amount,
      } as BalanceSummary;
    })
    .filter((item): item is BalanceSummary => Boolean(item));
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    const payload = error.payload as Record<string, unknown> | string | null | undefined;
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      const firstValue = Object.values(payload)[0];
      if (typeof firstValue === 'string') {
        return firstValue;
      }
      if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') {
        return firstValue[0];
      }
    }
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

interface NormalizedMessage {
  id: string;
  conversationId: string;
  author: 'me' | 'them';
  senderName: string;
  text: string;
  caption?: string | null;
  time: string;
  date: string;
  timestamp: string | null;
  status?: 'sent' | 'delivered' | 'read';
  deliveredPassively?: boolean;
  variant: 'text' | 'transaction' | 'system' | 'attachment' | 'wallet';
  transaction?: TransactionDetails;
  attachment?: AttachmentMeta | null;
  walletSettlement?: {
    label: string;
    settledAt: string | null;
  };
}

type DeliveryContext = 'passive' | 'active';

type DeliveryDisplay = {
  status: 'sent' | 'delivered' | 'read';
  passive: boolean;
};

function normalizeIdentity(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\s+/g, ' ').toLowerCase();
}

function isMessageFromUser(message: MessageDto, user?: CurrentUser | null): boolean {
  if (!message || !user) {
    return false;
  }
  const sender = message.sender;
  if (sender?.id && sender.id === user.id) {
    return true;
  }
  const normalizedUserUsername = normalizeIdentity(user.username);
  const normalizedSenderUsername = normalizeIdentity(sender?.username);
  if (normalizedUserUsername && normalizedSenderUsername && normalizedUserUsername === normalizedSenderUsername) {
    return true;
  }
  const senderDisplayCandidates: Array<string | null | undefined> = [
    message.senderDisplay,
    sender?.display_name,
    sender?.username,
  ];
  const userDisplayCandidates: Array<string | null | undefined> = [
    user.display_name,
    user.first_name ? `${user.first_name} ${user.last_name ?? ''}` : null,
    user.first_name,
    user.last_name,
    user.username,
  ];
  const normalizedUserDisplays = new Set(
    userDisplayCandidates
      .map((candidate) => normalizeIdentity(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
  for (const value of senderDisplayCandidates) {
    const normalized = normalizeIdentity(value);
    if (normalized && normalizedUserDisplays.has(normalized)) {
      return true;
    }
  }
  return false;
}

function parseTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function matchesOptimisticEcho(candidate: MessageDto, incoming: MessageDto): boolean {
  const candidateBody = (candidate.body ?? '').trim();
  const incomingBody = (incoming.body ?? '').trim();
  if (candidateBody && incomingBody && candidateBody === incomingBody) {
    return true;
  }

  const candidateName = (candidate.attachment_name ?? '').trim();
  const incomingName = (incoming.attachment_name ?? '').trim();
  if (candidateName && incomingName && candidateName === incomingName) {
    return true;
  }

  const candidateSize = typeof candidate.attachment_size === 'number' ? candidate.attachment_size : null;
  const incomingSize = typeof incoming.attachment_size === 'number' ? incoming.attachment_size : null;
  if (candidateSize !== null && incomingSize !== null && Math.abs(candidateSize - incomingSize) <= 4096) {
    return true;
  }

  return false;
}

function removeOptimisticEcho(
  list: MessageDto[],
  incoming: MessageDto,
  user?: CurrentUser | null,
): MessageDto[] {
  if (!user || incoming.id <= 0) {
    return list;
  }
  let removed = false;
  const incomingTimestamp = parseTimestamp(incoming.created_at);
  return list.filter((candidate) => {
    if (removed) {
      return true;
    }
    if (!candidate || candidate.id >= 0) {
      return true;
    }
    if (!isMessageFromUser(candidate, user)) {
      return true;
    }
    if (!matchesOptimisticEcho(candidate, incoming)) {
      return true;
    }
    const candidateTimestamp = parseTimestamp(candidate.created_at);
    if (incomingTimestamp !== null && candidateTimestamp !== null) {
      const diff = Math.abs(incomingTimestamp - candidateTimestamp);
      if (diff > 60000) {
        return true;
      }
    }
    removed = true;
    return false;
  });
}

function decodeJwtPayload(token?: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    if (typeof globalThis.atob !== 'function') {
      return null;
    }
    const decoded = globalThis.atob(padded);
    return decoded ? JSON.parse(decoded) : null;
  } catch (error) {
    console.warn('[Mutabaka] Failed to decode JWT payload', error);
    return null;
  }
}

function formatMemberRole(role: ConversationMemberRole): string {
  switch (role) {
    case 'team_member':
      return 'عضو فريق';
    case 'team':
      return 'عضو إضافي';
    default:
      return 'مشارك أساسي';
  }
}

function getInitials(source: string): string {
  if (!source) {
    return '?';
  }
  const trimmed = source.trim();
  if (!trimmed) {
    return '?';
  }
  const parts = trimmed.split(/\s+/u).slice(0, 2);
  return parts.map((part) => part[0]).join('').toUpperCase();
}

function normalizeConversationMember(entry: ConversationMemberSummary | null | undefined): ConversationMemberItem | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const rawRole = (entry.role ?? 'participant') as ConversationMemberRole;
  const memberType: MemberType = rawRole === 'team_member' ? 'team_member' : 'user';
  const username = typeof entry.username === 'string' ? entry.username : '';
  const displayNameSource = typeof entry.display_name === 'string' && entry.display_name.trim()
    ? entry.display_name.trim()
    : username;
  const memberId = Number(entry.id);
  if (!Number.isFinite(memberId)) {
    return null;
  }
  return {
    memberId,
    username,
    displayName: displayNameSource || username || 'عضو',
    role: rawRole,
    memberType,
  };
}

function getBalancePalette(currency: string, amount: number) {
  const positive = amount >= 0;
  if (positive) {
    if (currency === 'SYP') {
      return { backgroundColor: '#0f766e', textColor: '#fefce8' };
    }
    return { backgroundColor: '#047857', textColor: '#fefce8' };
  }
  return { backgroundColor: '#b91c1c', textColor: '#fee2e2' };
}

function formatMessageTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function formatMessageDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleDateString('ar', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}

function parseTransactionMessage(body: string | null | undefined): TransactionDetails | null {
  if (!body || typeof body !== 'string') {
    return null;
  }
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return null;
  }
  const headerPattern = /^معاملة:\s*(لنا|لكم)\s*([\d\u0660-\u0669\u06F0-\u06F9]+(?:[.,\u066B][\d\u0660-\u0669\u06F0-\u06F9]+)?)\s*([^\s]+)/u;
  const match = normalizedBody.match(headerPattern);
  if (!match) {
    return null;
  }
  const [matchedHeader, directionRaw, amountRaw, symbolRaw] = match;
  if (!directionRaw || !amountRaw || !symbolRaw) {
    return null;
  }
  const direction = directionRaw === 'لنا' ? 'lna' : 'lkm';
  const normalizedAmount = normalizeNumberString(amountRaw);
  const amount = Number.parseFloat(normalizedAmount);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const symbol = symbolRaw.trim();
  const remainder = normalizedBody.slice(matchedHeader.length);
  let note: string | undefined;
  if (remainder) {
    const trimmedRemainder = remainder.replace(/^\s+/u, '');
    const withoutDash = trimmedRemainder.startsWith('-')
      ? trimmedRemainder.slice(1).replace(/^\s+/u, '')
      : trimmedRemainder;
    const cleaned = withoutDash.replace(/\r\n/g, '\n').trim();
    if (cleaned) {
      note = cleaned;
    }
  }
  return {
    direction,
    amount,
    symbol,
    currency: symbol,
    note,
  };
}

function resolveDeliveryContext(
  status?: number,
  fallback?: string | null,
  hint?: DeliveryContext | null,
  previous?: DeliveryContext | null,
): DeliveryContext | undefined {
  if (typeof status === 'number') {
    if (status >= 2) {
      return 'active';
    }
    if (status >= 1) {
      if (hint === 'active' || previous === 'active') {
        return 'active';
      }
      return hint ?? previous ?? 'passive';
    }
  }
  if (fallback === 'read') {
    return 'active';
  }
  if (fallback === 'delivered') {
    if (hint === 'active' || previous === 'active') {
      return 'active';
    }
    return hint ?? previous ?? 'passive';
  }
  return previous ?? hint ?? undefined;
}

function mapDeliveryStatus(
  status?: number,
  fallback?: string | null,
  context?: DeliveryContext | null,
): DeliveryDisplay {
  if (typeof status === 'number') {
    if (status >= 2) {
      return { status: 'read', passive: false };
    }
    if (status >= 1) {
      return { status: 'delivered', passive: context !== 'active' };
    }
  }
  if (fallback === 'read' || fallback === 'delivered' || fallback === 'sent') {
    if (fallback === 'read') {
      return { status: 'read', passive: false };
    }
    if (fallback === 'delivered') {
      return { status: 'delivered', passive: context !== 'active' };
    }
    return { status: 'sent', passive: true };
  }
  return { status: 'sent', passive: true };
}

const MEMBER_EVENT_PATTERNS: RegExp[] = [
  /قام\s+\S+\s+بإضافة\s+/u,
  /قام\s+\S+\s+بإزال\S*/u,
  /تم(?:ت)?\s+إضافتك/u,
  /تم(?:ت)?\s+إزالة\S*/u,
  /تم\s+إضافة\s+/u,
  /تم\s+إزال\S*/u,
];

function isMemberEventBody(body: string | null | undefined): boolean {
  if (!body || typeof body !== 'string') {
    return false;
  }
  const normalized = body.trim();
  if (!normalized) {
    return false;
  }
  return MEMBER_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isMemberSystemMessage(type: string | null | undefined, body: string | null | undefined): boolean {
  const typeHint = typeof type === 'string' ? type.toLowerCase() : '';
  if (typeHint && typeHint !== 'text') {
    if (typeHint.includes('member') || typeHint.includes('system') || typeHint.includes('event')) {
      return true;
    }
  }
  return isMemberEventBody(body);
}

const WALLET_SETTLED_MATCHES = [
  'الحساب صفر',
  'الحساب 000 صفر',
  'الحساب 800 صفر',
  'تمت تسوية جميع المحافظ',
  'تم تصفير جميع المحافظ',
  'تم تصفير المحافظ',
];

const DEFAULT_WALLET_SETTLEMENT_LABEL = 'الحساب صفر';

function normalizeWalletText(value?: string | null): string {
  return (value ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
}

function matchesWalletSettlementPhrase(value?: string | null): boolean {
  const normalized = normalizeWalletText(value);
  if (!normalized) {
    return false;
  }
  return WALLET_SETTLED_MATCHES.some((token) => normalized.includes(token));
}

function extractWalletSubtype(message: MessageDto): string | null {
  const subtypeCandidates: unknown[] = [
    (message as { systemSubtype?: unknown }).systemSubtype,
    (message as { system_subtype?: unknown }).system_subtype,
  ];
  for (const candidate of subtypeCandidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  const typeCandidate = (message as { type?: unknown }).type;
  if (typeof typeCandidate === 'string') {
    const trimmed = typeCandidate.trim();
    if (trimmed.toLowerCase() === 'wallet_settled') {
      return trimmed;
    }
  }
  return null;
}

function readNestedString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
}

function resolveWalletSettlementTimestamp(message: MessageDto): string | null {
  const directCandidates: unknown[] = [
    (message as { settled_at?: unknown }).settled_at,
    (message as { settledAt?: unknown }).settledAt,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  const nestedSources: Array<Record<string, unknown> | null | undefined> = [
    (message as { metadata?: Record<string, unknown> | null | undefined }).metadata,
    (message as { payload?: Record<string, unknown> | null | undefined }).payload,
    (message as { extra?: Record<string, unknown> | null | undefined }).extra,
  ];
  for (const source of nestedSources) {
    const value = readNestedString(source, ['settled_at', 'settledAt', 'timestamp', 'created_at']);
    if (value) {
      return value;
    }
  }
  return null;
}

function detectWalletSettlement(message: MessageDto): { detected: boolean; label: string; settledAt: string | null } {
  const subtype = extractWalletSubtype(message);
  const rawBody = typeof message.body === 'string' ? message.body : '';
  const trimmedBody = normalizeWalletText(rawBody);
  const isWallet = Boolean(
    (subtype && subtype.toLowerCase() === 'wallet_settled')
      || matchesWalletSettlementPhrase(trimmedBody),
  );
  if (!isWallet) {
    return { detected: false, label: DEFAULT_WALLET_SETTLEMENT_LABEL, settledAt: null };
  }
  const settledAt = resolveWalletSettlementTimestamp(message) || message.created_at || null;
  const label = trimmedBody || DEFAULT_WALLET_SETTLEMENT_LABEL;
  return { detected: true, label, settledAt };
}

function formatWalletSettlementTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const datePart = formatMessageDate(value);
  const timePart = formatMessageTime(value);
  return [datePart, timePart].filter(Boolean).join(' ').trim();
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function padTwoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function getLocalDateInfo(value: string | null | undefined): { key: string; date: Date } | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const key = `${localDate.getFullYear()}-${padTwoDigits(localDate.getMonth() + 1)}-${padTwoDigits(localDate.getDate())}`;
  return { key, date: localDate };
}

function formatDaySeparatorLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date.getTime() - today.getTime()) / DAY_IN_MS);
  if (diffDays === 0) {
    return 'اليوم';
  }
  if (diffDays === -1) {
    return 'أمس';
  }
  try {
    return date.toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return `${padTwoDigits(date.getDate())}/${padTwoDigits(date.getMonth() + 1)}/${date.getFullYear()}`;
  }
}

type ExportFormat = 'excel' | 'pdf';

type ExportRow = {
  index: number;
  senderName: string;
  directionLabel: 'لنا' | 'لكم';
  amountDisplay: string;
  amountNumber: number;
  positive: boolean;
  noteText: string;
  dateTimeDisplay: string;
  createdAtISO?: string | null;
};

type NamedEntity = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  name?: string | null;
};

const EXPORT_DEFAULT_RANGE_DAYS = 30;

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`;
}

function safeFilename(raw: string, ext: string): string {
  const sanitized = raw
    .trim()
    .replace(/\s+/g, '-').replace(/[^0-9A-Za-z\u0600-\u06FF_-]+/g, '')
    .slice(0, 80);
  const base = sanitized || 'transactions';
  const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
  return `${base}.${normalizedExt}`;
}

function pickDisplayName(entity: NamedEntity | null | undefined): string {
  if (!entity) {
    return '';
  }
  const candidates = [
    entity.display_name,
    entity.name,
    entity.first_name && entity.last_name ? `${entity.first_name} ${entity.last_name}` : '',
    entity.first_name,
    entity.last_name,
    entity.username,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function formatAmountLabel(amount: number, symbol?: string | null): string {
  const formatted = formatBalance(Math.abs(amount));
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function exportRowsToExcelMobile(
  rows: ExportRow[],
  parties: { a: string; b: string },
  rangeLabel: string,
  filename: string,
): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const sheetData: (string | number)[][] = [
    [`معاملات مالية بين ${parties.a} و ${parties.b}`],
  ];
  if (rangeLabel) {
    sheetData.push([rangeLabel]);
  }
  sheetData.push(['رقم المعاملة', 'اسم المرسل', 'لمن', 'المبلغ و العملة', 'ملاحظة', 'التاريخ و الوقت']);
  rows.forEach((row) => {
    sheetData.push([
      row.index,
      row.senderName,
      row.directionLabel,
      row.amountDisplay,
      row.noteText,
      row.dateTimeDisplay,
    ]);
  });
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 16 },
    { wch: 28 },
    { wch: 16 },
    { wch: 26 },
    { wch: 38 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'التقرير');
  const wbout = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!directory) {
    throw new Error('تعذر تحديد موقع الحفظ');
  }
  const targetUri = `${directory}${filename}`;
  await FileSystem.writeAsStringAsync(targetUri, wbout, { encoding: FileSystem.EncodingType.Base64 });
  return targetUri;
}

async function exportRowsToPdfMobile(
  rows: ExportRow[],
  parties: { a: string; b: string },
  rangeLabel: string,
  filename: string,
): Promise<string> {
  const tableRows = rows
    .map((row, index) => {
      const directionClass = row.positive ? 'positive' : 'negative';
      const noteSafe = row.noteText ? escapeHtml(row.noteText) : '';
      return `
        <tr>
          <td>${row.index}</td>
          <td>${escapeHtml(row.senderName)}</td>
          <td class="${directionClass}">${escapeHtml(row.directionLabel)}</td>
          <td class="${directionClass}">${escapeHtml(row.amountDisplay)}</td>
          <td>${noteSafe}</td>
          <td>${escapeHtml(row.dateTimeDisplay)}</td>
        </tr>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
  <html dir="rtl" lang="ar">
    <head>
      <meta charSet="utf-8" />
      <style>
        body { font-family: 'Tajawal', 'Cairo', 'Segoe UI', sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #f8fafc; }
        .container { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 24px; box-shadow: 0 24px 48px rgba(15, 31, 37, 0.12); }
        h1 { font-size: 20px; margin: 0 0 12px; text-align: center; }
        p.range { font-size: 12px; color: #64748b; text-align: center; margin: 0 0 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e2e8f0; padding: 10px 8px; text-align: center; }
        th { background: #102030; color: #f8fafc; font-weight: 600; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        tbody tr:nth-child(odd) { background: #ffffff; }
        td.positive { color: #16a34a; font-weight: 600; }
        td.negative { color: #dc2626; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>معاملات مالية بين ${escapeHtml(parties.a)} و ${escapeHtml(parties.b)}</h1>
        ${rangeLabel ? `<p class="range">${escapeHtml(rangeLabel)}</p>` : ''}
        <table>
          <thead>
            <tr>
              <th>رقم المعاملة</th>
              <th>اسم المرسل</th>
              <th>لمن</th>
              <th>المبلغ و العملة</th>
              <th>ملاحظة</th>
              <th>التاريخ و الوقت</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </body>
  </html>`;

  let PrintModule: typeof import('expo-print') | null = null;
  try {
    PrintModule = await import('expo-print');
  } catch (error) {
    if (error instanceof Error && /ExpoPrint|ExponentPrint|expo-print/.test(error.message)) {
      throw new Error('لا يدعم هذا الإصدار من التطبيق إنشاء ملفات PDF بعد. يُرجى إعادة بناء التطبيق بعد تثبيت مكتبة expo-print ثم المحاولة من جديد.');
    }
    throw error;
  }

  let result;
  try {
    result = await PrintModule.printToFileAsync({ html, base64: false });
  } catch (error) {
    if (error instanceof Error && /ExpoPrint|ExponentPrint|expo-print/.test(error.message)) {
      throw new Error('لا يدعم هذا الإصدار من التطبيق إنشاء ملفات PDF بعد. يُرجى إعادة بناء التطبيق بعد تثبيت مكتبة expo-print ثم المحاولة من جديد.');
    }
    throw error;
  }
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!directory) {
    return result.uri;
  }
  const targetUri = `${directory}${filename}`;
  try {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  } catch (error) {
    console.warn('[Mutabaka] Failed to clean previous export file', error);
  }
  await FileSystem.moveAsync({ from: result.uri, to: targetUri });
  return targetUri;
}

function resolveConversationPeer(conversation: ConversationDto, viewerId: number) {
  const isUserA = conversation.user_a.id === viewerId;
  return isUserA ? conversation.user_b : conversation.user_a;
}

export default function ChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const { mode, tokens } = useThemeMode();
  const conversationId = route.params?.conversationId;

  const [draft, setDraft] = useState('');
  const [showTransactionsOnly, setShowTransactionsOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('excel');
  const [exportDateFrom, setExportDateFrom] = useState<string>(() => {
    const today = new Date();
    const start = new Date(today.getTime() - (EXPORT_DEFAULT_RANGE_DAYS - 1) * DAY_IN_MS);
    return toDateInputValue(start);
  });
  const [exportDateTo, setExportDateTo] = useState<string>(() => toDateInputValue(new Date()));
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [ourShare, setOurShare] = useState('');
  const [theirShare, setTheirShare] = useState('');
  const [note, setNote] = useState('');
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<string[]>([]);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersBusy, setMembersBusy] = useState(false);
  const [conversationMembers, setConversationMembers] = useState<ConversationMemberItem[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isTeamActor, setIsTeamActor] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOption[]>([]);
  const [currencyPickerVisible, setCurrencyPickerVisible] = useState(false);
  const [pairBalances, setPairBalances] = useState<BalanceSummary[]>([]);
  const [remoteMessages, setRemoteMessages] = useState<MessageDto[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [remoteTitle, setRemoteTitle] = useState<string | null>(null);
  const [remoteAvatar, setRemoteAvatar] = useState<string | null>(null);
  const [peerUser, setPeerUser] = useState<ConversationDto['user_a'] | null>(null);
  const [conversationMeta, setConversationMeta] = useState<{ userAId: number; userBId: number } | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [otpPromptVisible, setOtpPromptVisible] = useState(false);
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [otpPromptMessage, setOtpPromptMessage] = useState(DEFAULT_OTP_PROMPT_MESSAGE);
  const [balancesError, setBalancesError] = useState(false);
  const [pendingDeleteRequest, setPendingDeleteRequest] = useState<{
    fromUserId: number | null;
    fromUsername: string | null;
    fromDisplayName: string | null;
    at: string | null;
  } | null>(null);
  const [deleteRequestBusy, setDeleteRequestBusy] = useState<'approve' | 'decline' | null>(null);
  const isMountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pendingAckRef = useRef<Set<number>>(new Set());
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInboundMessageIdRef = useRef(0);
  const pendingReadRef = useRef<number | null>(null);
  const listRef = useRef<FlatList<NormalizedMessage> | null>(null);
  const otpResolverRef = useRef<((value: string | null) => void) | null>(null);
  const loggedAttachmentIdsRef = useRef<Set<number>>(new Set());
  const myMessageIdsRef = useRef<Set<number>>(new Set());
  const isAtBottomRef = useRef(true);
  const deleteResolutionRef = useRef<'none' | 'approved' | 'declined'>('none');

  // جلب الإيموجي المخصصة من API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${environment.apiBaseUrl}/custom-emojis`);
        if (!response.ok) throw new Error('Failed to fetch emojis');
        const data = await response.json();
        if (cancelled) return;
        const emojis = data.map((item: any) => item.emoji);
        setCustomEmojis(emojis.length > 0 ? emojis : EMOJI_PALETTE);
      } catch (_err) {
        if (cancelled) return;
        setCustomEmojis(EMOJI_PALETTE); // استخدام الافتراضي عند الفشل
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (otpResolverRef.current) {
        try {
          otpResolverRef.current(null);
        } catch {}
        otpResolverRef.current = null;
      }
    };
  }, [conversationId]);

  useEffect(() => {
    deleteResolutionRef.current = 'none';
    setDeleteRequestBusy(null);
    setPendingDeleteRequest(null);
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!active) {
          return;
        }
        const payload = decodeJwtPayload(token) as { actor?: unknown } | null;
        const actorRaw = payload && typeof payload.actor === 'string' ? payload.actor.toLowerCase() : '';
        setIsTeamActor(actorRaw === 'team_member');
      } catch (error) {
        console.warn('[Mutabaka] Failed to decode auth token for members panel', error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!statusBanner || statusBanner.kind !== 'success') {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setStatusBanner(null);
      }
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [statusBanner]);

  const promptForOtp = useCallback((message?: string) => new Promise<string | null>((resolve) => {
    otpResolverRef.current = resolve;
    setOtpCodeInput('');
    setOtpPromptMessage(message || DEFAULT_OTP_PROMPT_MESSAGE);
    setOtpPromptVisible(true);
  }), []);

  const handleOtpInputChange = useCallback((value: string) => {
    const normalized = arabicToEnglishDigits(value).replace(/[^0-9]/gu, '').slice(0, 6);
    setOtpCodeInput(normalized);
  }, []);

  const handleOtpPromptSubmit = useCallback(() => {
    const resolver = otpResolverRef.current;
    const code = otpCodeInput.trim();
    if (!resolver || code.length !== 6) {
      return;
    }
    otpResolverRef.current = null;
    setOtpPromptVisible(false);
    setOtpCodeInput('');
    setOtpPromptMessage(DEFAULT_OTP_PROMPT_MESSAGE);
    resolver(code);
  }, [otpCodeInput]);

  const handleOtpPromptCancel = useCallback(() => {
    const resolver = otpResolverRef.current;
    otpResolverRef.current = null;
    setOtpPromptVisible(false);
    setOtpCodeInput('');
    setOtpPromptMessage(DEFAULT_OTP_PROMPT_MESSAGE);
    if (resolver) {
      resolver(null);
    }
  }, []);

  const fallbackConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversationId],
  );

  const fallbackMessages = useMemo<NormalizedMessage[]>(
    () => messages
      .filter((m) => m.conversationId === conversationId)
      .map((m) => {
        const transaction = parseTransactionMessage(m.text);
        const isSystem = isMemberEventBody(m.text);
        return {
          id: m.id,
          conversationId: m.conversationId,
          author: m.author,
          text: m.text,
          caption: null,
          time: m.time,
          date: '',
          timestamp: null,
          status: isSystem ? undefined : m.status ?? 'sent',
          variant: isSystem ? 'system' : transaction ? 'transaction' : 'text',
          transaction: transaction ?? undefined,
          attachment: null,
          senderName: 'Unknown',
        };
      }),
    [conversationId],
  );

  const numericConversationId = Number(conversationId);
  const shouldUseBackend = !Number.isNaN(numericConversationId);
  const conversationWsUrl = useMemo(() => {
    if (!shouldUseBackend) {
      return null;
    }
    const base = environment.websocketBaseUrl.replace(/\/?$/, '/');
    return `${base}conversations/${numericConversationId}/`;
  }, [numericConversationId, shouldUseBackend]);

  useEffect(() => {
    setEmojiPickerVisible(false);
    setMembersModalVisible(false);
    setMembersError(null);
    setConversationMembers([]);
    setMembersLoading(false);
    setMembersBusy(false);
  }, [conversationId]);

  const flushAck = useCallback(() => {
    if (!pendingAckRef.current.size) {
      return;
    }
    const ids = Array.from(pendingAckRef.current);
    const batch = ids.slice(0, 300);
    batch.forEach((id) => pendingAckRef.current.delete(id));
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'ack', message_ids: batch }));
      } catch (error) {
        console.warn('[Mutabaka] Failed to send ACK batch', error);
        batch.forEach((id) => pendingAckRef.current.add(id));
      }
    } else {
      batch.forEach((id) => pendingAckRef.current.add(id));
    }
    if (pendingAckRef.current.size > 0 && !ackTimerRef.current) {
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        flushAck();
      }, 180);
    }
  }, []);

  const queueAck = useCallback((messageId: number) => {
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return;
    }
    pendingAckRef.current.add(messageId);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      flushAck();
    } else if (!ackTimerRef.current) {
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        flushAck();
      }, 200);
    }
  }, [flushAck]);

  const flushPendingRead = useCallback(() => {
    const socket = wsRef.current;
    const lastId = pendingReadRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !lastId || lastId <= 0) {
      return;
    }
    try {
      socket.send(JSON.stringify({ type: 'read', last_read_id: lastId }));
      pendingReadRef.current = null;
    } catch (error) {
      console.warn('[Mutabaka] Failed to send READ event', error);
    }
  }, []);

  const queueRead = useCallback((messageId: number) => {
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return;
    }
    const pending = pendingReadRef.current ?? 0;
    if (messageId > pending) {
      pendingReadRef.current = messageId;
    }
    flushPendingRead();
  }, [flushPendingRead]);

  const refreshNetBalance = useCallback(async () => {
    if (!shouldUseBackend || !Number.isFinite(numericConversationId) || !currentUser || !conversationMeta) {
      return;
    }

    try {
      const response = await fetchNetBalance(numericConversationId);
      if (!isMountedRef.current) {
        return;
      }

      const viewerIsUserA = currentUser.id === conversationMeta.userAId;
      const computed = computePairBalancesFromNet(response, viewerIsUserA);
      setPairBalances(computed);
      setBalancesError(false);
    } catch (error) {
      console.warn('[Mutabaka] Failed to refresh net balance', error);
    }
  }, [conversationMeta, currentUser, numericConversationId, shouldUseBackend]);

  const handleWsMessage = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'delete.request') {
      const rawIdValue = (payload.user_id ?? payload.userId ?? payload.requester_id ?? payload.requesterId) as number | string | null | undefined;
      const numericId = typeof rawIdValue === 'number'
        ? rawIdValue
        : Number(rawIdValue);
      const usernameRaw = typeof payload.username === 'string' ? payload.username.trim() : '';
      const displayNameRaw = typeof payload.display_name === 'string' ? payload.display_name.trim() : '';
      const requestedAt = typeof payload.requested_at === 'string' && payload.requested_at
        ? payload.requested_at
        : new Date().toISOString();
      const normalizedUsername = usernameRaw || null;
      const normalizedDisplayName = displayNameRaw || null;

      let resolvedId: number | null = Number.isFinite(numericId) ? Number(numericId) : null;
      if (!resolvedId && normalizedUsername) {
        const lower = normalizedUsername.toLowerCase();
        if (currentUser?.username && currentUser.username.trim().toLowerCase() === lower) {
          resolvedId = currentUser.id;
        } else if (peerUser?.username && peerUser.username.trim().toLowerCase() === lower) {
          resolvedId = peerUser.id;
        }
      }

      deleteResolutionRef.current = 'none';
      setDeleteRequestBusy(null);
      setPendingDeleteRequest({
        fromUserId: resolvedId,
        fromUsername: normalizedUsername,
        fromDisplayName: normalizedDisplayName,
        at: requestedAt,
      });

      return;
    }

    if (payload.type === 'delete.approved') {
      const actorDisplayRaw = typeof payload.display_name === 'string' ? payload.display_name.trim() : '';
      const actorUsernameRaw = typeof payload.username === 'string' ? payload.username.trim() : '';
      const actorLabel = actorDisplayRaw
        || actorUsernameRaw
        || (pickDisplayName(peerUser) || peerUser?.username || 'الطرف الآخر');
      const wasLocal = deleteResolutionRef.current === 'approved';
      deleteResolutionRef.current = 'approved';
      setDeleteRequestBusy(null);
      setPendingDeleteRequest(null);
      if (Number.isFinite(numericConversationId)) {
        emitConversationPreviewUpdate({ id: numericConversationId, removed: true });
      }
      const isActorMe = actorUsernameRaw && currentUser?.username
        ? actorUsernameRaw.toLowerCase() === currentUser.username.trim().toLowerCase()
        : false;
      if (!wasLocal) {
        setStatusBanner({
          kind: 'success',
          text: isActorMe
            ? 'تم حذف المحادثة.'
            : `${actorLabel} وافق على حذف هذه المحادثة وسيتم إغلاقها الآن.`,
        });
        navigation.navigate('Home');
      }
      return;
    }

    if (payload.type === 'delete.declined') {
      const actorDisplayRaw = typeof payload.display_name === 'string' ? payload.display_name.trim() : '';
      const actorUsernameRaw = typeof payload.username === 'string' ? payload.username.trim() : '';
      const actorLabel = actorDisplayRaw
        || actorUsernameRaw
        || (pickDisplayName(peerUser) || peerUser?.username || 'الطرف الآخر');
      const wasLocal = deleteResolutionRef.current === 'declined';
      deleteResolutionRef.current = 'declined';
      setDeleteRequestBusy(null);
      setPendingDeleteRequest(null);
      if (Number.isFinite(numericConversationId)) {
        emitConversationPreviewUpdate({ id: numericConversationId });
      }
      const isActorMe = actorUsernameRaw && currentUser?.username
        ? actorUsernameRaw.toLowerCase() === currentUser.username.trim().toLowerCase()
        : false;
      if (!wasLocal) {
        setStatusBanner({
          kind: isActorMe ? 'success' : 'error',
          text: isActorMe
            ? 'قمت برفض طلب حذف المحادثة.'
            : `${actorLabel} رفض طلب حذف المحادثة.`,
        });
      }
      return;
    }

    if (payload.type === 'chat.message') {
      const rawId = typeof payload.id === 'number' ? payload.id : Number(payload.id);
      const messageId = Number.isFinite(rawId) ? rawId : Date.now();
      const createdAt = typeof payload.created_at === 'string' && payload.created_at
        ? payload.created_at
        : new Date().toISOString();
      const deliveryStatus = typeof payload.delivery_status === 'number'
        ? payload.delivery_status
        : payload.status === 'read'
          ? 2
          : payload.status === 'delivered'
            ? 1
            : 0;
      const messageStatus: MessageDto['status'] = deliveryStatus >= 2 ? 'read' : deliveryStatus >= 1 ? 'delivered' : 'sent';
      const senderUsername = typeof payload.sender === 'string' ? payload.sender : '';
      const meUsername = currentUser?.username?.toLowerCase() ?? '';
      const isMine = senderUsername && meUsername && senderUsername.toLowerCase() === meUsername;

      const senderDisplay = typeof payload.senderDisplay === 'string' && payload.senderDisplay.trim()
        ? payload.senderDisplay
        : isMine
          ? currentUser?.display_name || currentUser?.username || 'أنا'
          : peerUser?.display_name || peerUser?.username || senderUsername || 'مستخدم';

      const senderInfo = isMine
        ? currentUser
          ? {
              id: currentUser.id,
              username: currentUser.username,
              display_name: currentUser.display_name,
            }
          : undefined
        : peerUser
        ? {
            id: peerUser.id,
            username: peerUser.username,
            display_name: peerUser.display_name,
          }
        : { id: -1, username: senderUsername || 'unknown' };

      const systemSubtypeValue = (() => {
        const camel = typeof payload.systemSubtype === 'string' ? payload.systemSubtype.trim() : '';
        if (camel) {
          return camel;
        }
        const snake = typeof payload.system_subtype === 'string' ? payload.system_subtype.trim() : '';
        if (snake) {
          return snake;
        }
        return undefined;
      })();
      const settledAtValue = (() => {
        const camel = typeof payload.settledAt === 'string' ? payload.settledAt.trim() : '';
        if (camel) {
          return camel;
        }
        const snake = typeof payload.settled_at === 'string' ? payload.settled_at.trim() : '';
        if (snake) {
          return snake;
        }
        return undefined;
      })();
      const payloadMetadata = typeof payload.metadata === 'object' && payload.metadata !== null
        ? payload.metadata as Record<string, unknown>
        : null;
      const payloadExtra = typeof payload.extra === 'object' && payload.extra !== null
        ? payload.extra as Record<string, unknown>
        : null;
      const payloadBody = typeof payload.payload === 'object' && payload.payload !== null
        ? payload.payload as Record<string, unknown>
        : null;

      const rawAttachment = payload.attachment && typeof payload.attachment === 'object'
        ? payload.attachment as Record<string, unknown>
        : null;
      const attachmentUrl = rawAttachment && typeof rawAttachment.url === 'string' && rawAttachment.url
        ? rawAttachment.url
        : null;
      const attachmentName = rawAttachment && typeof rawAttachment.name === 'string' && rawAttachment.name
        ? rawAttachment.name
        : null;
      const attachmentMime = rawAttachment && typeof rawAttachment.mime === 'string' && rawAttachment.mime
        ? rawAttachment.mime
        : null;
      const rawSize = rawAttachment?.size;
      const attachmentSize = (() => {
        if (typeof rawSize === 'number' && Number.isFinite(rawSize)) {
          return rawSize;
        }
        if (typeof rawSize === 'string') {
          const parsed = Number(rawSize);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        return null;
      })();
      const needsAttachmentRefresh = Boolean(
        rawAttachment && !attachmentUrl && Number.isFinite(messageId) && Number.isFinite(numericConversationId) && shouldUseBackend,
      );

      const nextMessage: MessageDto = {
        id: messageId,
        conversation: numericConversationId,
        sender: senderInfo,
        senderType: 'user',
        senderDisplay,
        type: typeof payload.kind === 'string' ? payload.kind : 'text',
        body: typeof payload.body === 'string' ? payload.body : '',
        created_at: createdAt,
        status: messageStatus,
        delivery_status: deliveryStatus,
        delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : undefined,
        read_at: typeof payload.read_at === 'string' ? payload.read_at : undefined,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        attachment_mime: attachmentMime,
        attachment_size: attachmentSize,
        delivery_context: (() => {
          if (deliveryStatus >= 2) {
            return 'active' as DeliveryContext;
          }
          if (deliveryStatus >= 1) {
            return isMine ? 'passive' : 'active';
          }
          return undefined;
        })(),
        systemSubtype: systemSubtypeValue,
        system_subtype: systemSubtypeValue,
        settledAt: settledAtValue,
        settled_at: settledAtValue,
        metadata: payloadMetadata,
        payload: payloadBody,
        extra: payloadExtra,
      };

      setRemoteMessages((prev) => {
        const baseList = isMine ? removeOptimisticEcho(prev, nextMessage, currentUser) : prev;
        let updated = false;
        const mapped = baseList.map((msg) => {
          if (msg.id !== nextMessage.id) {
            return msg;
          }
          updated = true;
          return {
            ...msg,
            ...nextMessage,
            sender: msg.sender ?? nextMessage.sender,
            senderDisplay: nextMessage.senderDisplay || msg.senderDisplay,
            status: nextMessage.status ?? msg.status,
            delivery_status: nextMessage.delivery_status ?? msg.delivery_status ?? 0,
            delivered_at: nextMessage.delivered_at ?? msg.delivered_at,
            read_at: nextMessage.read_at ?? msg.read_at,
            attachment_url: nextMessage.attachment_url ?? msg.attachment_url ?? null,
            attachment_name: nextMessage.attachment_name ?? msg.attachment_name ?? null,
            attachment_mime: nextMessage.attachment_mime ?? msg.attachment_mime ?? null,
            attachment_size: nextMessage.attachment_size ?? msg.attachment_size ?? null,
            delivery_context: resolveDeliveryContext(
              nextMessage.delivery_status ?? msg.delivery_status,
              nextMessage.status ?? msg.status ?? null,
              nextMessage.delivery_context ?? null,
              msg.delivery_context ?? null,
            ),
          };
        });

        if (Number.isFinite(numericConversationId)) {
          const preview = typeof payload.preview === 'string' && payload.preview.trim()
            ? payload.preview
            : typeof nextMessage.body === 'string' && nextMessage.body.trim()
              ? nextMessage.body
              : attachmentName
                ? attachmentName
              : 'رسالة جديدة';
          emitConversationPreviewUpdate({
            id: numericConversationId,
            lastMessageAt: nextMessage.created_at,
            lastActivityAt: nextMessage.created_at,
            lastMessagePreview: preview,
            unreadCount: isMine ? undefined : 0,
          });
        }
        if (!updated) {
          mapped.push({
            ...nextMessage,
            delivery_context: resolveDeliveryContext(
              nextMessage.delivery_status,
              nextMessage.status ?? null,
              nextMessage.delivery_context ?? null,
              undefined,
            ),
          });
        }

        mapped.sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
            return aTime - bTime;
          }
          return a.id - b.id;
        });

        return mapped;
      });

      if (needsAttachmentRefresh) {
        (async () => {
          try {
            const sinceId = Math.max(0, messageId - 1);
            const refreshed = await fetchMessagesSince(numericConversationId, sinceId, 5);
            if (!isMountedRef.current) {
              return;
            }
            const found = refreshed.find((entry: MessageDto) => entry.id === messageId);
            if (found) {
              setRemoteMessages((prev) => prev.map((msg) => {
                if (msg.id !== messageId) {
                  return msg;
                }
                const mergedDelivery = found.delivery_status ?? msg.delivery_status;
                const mergedStatus = found.status ?? msg.status ?? null;
                return {
                  ...msg,
                  ...found,
                  delivery_context: resolveDeliveryContext(
                    mergedDelivery,
                    mergedStatus,
                    found.delivery_context ?? null,
                    msg.delivery_context ?? null,
                  ),
                };
              }));
            }
          } catch (error) {
            console.warn('[Mutabaka] Failed to refresh attachment metadata', error);
          }
        })();
      }

      if (nextMessage.type === 'transaction') {
        refreshNetBalance();
      }

      if (!isMine && Number.isFinite(messageId)) {
        lastInboundMessageIdRef.current = Math.max(lastInboundMessageIdRef.current, messageId);
        queueAck(messageId);
        queueRead(messageId);
      }

      return;
    }

    if (payload.type === 'message.status') {
      const rawId = typeof payload.id === 'number' ? payload.id : Number(payload.id || payload.message_id);
      if (!Number.isFinite(rawId) || rawId <= 0) {
        return;
      }
      const deliveryStatus = typeof payload.delivery_status === 'number'
        ? payload.delivery_status
        : payload.status === 'read'
          ? 2
          : payload.status === 'delivered'
            ? 1
            : undefined;
      const readAt = typeof payload.read_at === 'string' && payload.read_at ? payload.read_at : undefined;
      const deliveredAt = typeof payload.delivered_at === 'string' && payload.delivered_at ? payload.delivered_at : undefined;

      setRemoteMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== rawId) {
            return msg;
          }
          const nextDelivery = deliveryStatus !== undefined
            ? Math.max(msg.delivery_status ?? 0, deliveryStatus)
            : msg.delivery_status ?? 0;
          const nextStatus: MessageDto['status'] = nextDelivery >= 2 ? 'read' : nextDelivery >= 1 ? 'delivered' : msg.status ?? 'sent';
          const eventContext: DeliveryContext | null = (() => {
            if (deliveryStatus === undefined) {
              return null;
            }
            if (deliveryStatus >= 2) {
              return 'active';
            }
            if (deliveryStatus >= 1) {
              const rawConversationId = (payload as Record<string, unknown> | null | undefined)?.conversation_id;
              const numericContextId = typeof rawConversationId === 'string' || typeof rawConversationId === 'number'
                ? Number(rawConversationId)
                : NaN;
              if (Number.isFinite(numericContextId) && numericContextId === numericConversationId) {
                return 'active';
              }
              return 'passive';
            }
            return null;
          })();
          return {
            ...msg,
            delivery_status: nextDelivery,
            status: nextStatus,
            read_at: readAt ?? msg.read_at ?? (nextStatus === 'read' ? msg.read_at ?? new Date().toISOString() : msg.read_at),
            delivered_at: deliveredAt ?? msg.delivered_at ?? (nextDelivery >= 1 ? (msg.delivered_at ?? msg.created_at) : msg.delivered_at),
            delivery_context: resolveDeliveryContext(
              nextDelivery,
              nextStatus ?? null,
              eventContext,
              msg.delivery_context ?? null,
            ),
          };
        }),
      );
      return;
    }

    if (payload.type === 'chat.read') {
      const reader = typeof payload.reader === 'string' ? payload.reader : '';
      const meUsername = currentUser?.username?.toLowerCase() ?? '';
      if (reader && reader.toLowerCase() === meUsername) {
        return;
      }
      const lastReadId = Number(payload.last_read_id);
      if (!Number.isFinite(lastReadId) || lastReadId <= 0 || !currentUser) {
        return;
      }
      setRemoteMessages((prev) =>
        prev.map((msg) => {
          const isMineMessage =
            (msg.sender?.id === currentUser.id) ||
            (msg.sender?.username && msg.sender.username === currentUser.username) ||
            msg.senderDisplay === currentUser.username ||
            (!!currentUser.display_name && msg.senderDisplay === currentUser.display_name);
          if (isMineMessage && msg.id <= lastReadId) {
            return {
              ...msg,
              delivery_status: 2,
              status: 'read',
              read_at: msg.read_at ?? new Date().toISOString(),
              delivery_context: resolveDeliveryContext(
                2,
                'read',
                'active',
                msg.delivery_context ?? null,
              ),
            };
          }
          return msg;
        }),
      );
    }
  }, [currentUser, peerUser, numericConversationId, queueAck, queueRead, refreshNetBalance, shouldUseBackend, navigation]);

  const loadCurrencyOptions = useCallback(async () => {
    try {
      let list = await fetchCurrencies();
      if (!list.length) {
        try {
          await bootstrapCurrencies();
          list = await fetchCurrencies();
        } catch (error) {
          console.warn('[Mutabaka] bootstrapCurrencies failed', error);
        }
      }
      if (list.length) {
        setCurrencyOptions(list);
        if (!list.some((item) => item.code === selectedCurrency)) {
          setSelectedCurrency(list[0].code);
        }
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to load currencies', error);
    }
  }, [selectedCurrency]);

  const loadConversationData = useCallback(async () => {
    if (!shouldUseBackend) {
      setRemoteMessages([]);
      setRemoteTitle(null);
      setRemoteAvatar(null);
      setCurrentUser(null);
      setConversationMeta(null);
      setErrorMessage(null);
      setLoadingMessages(false);
      pendingAckRef.current.clear();
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      pendingReadRef.current = null;
      lastInboundMessageIdRef.current = 0;
      setPairBalances([]);
      setBalancesError(false);
      setPendingDeleteRequest(null);
      return;
    }

    try {
      setLoadingMessages(true);
      setErrorMessage(null);
      setBalancesError(false);
      let netBalanceErrored = false;
      const [me, conversationData, messagesResponse, netBalance] = await Promise.all([
        fetchCurrentUser(),
        fetchConversation(numericConversationId),
        fetchMessages(numericConversationId),
        fetchNetBalance(numericConversationId).catch((error) => {
          console.warn('[Mutabaka] Failed to fetch net balance', error);
          netBalanceErrored = true;
          return null as NetBalanceResponse | null;
        }),
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setCurrentUser(me);
      const peer = resolveConversationPeer(conversationData, me.id);
      setRemoteTitle(peer.display_name || peer.username);
      setRemoteAvatar(peer.logo_url || null);
      setPeerUser(peer);
      setConversationMeta({ userAId: conversationData.user_a.id, userBId: conversationData.user_b.id });
      const rawDeleteRequester = (conversationData.delete_requested_by ?? conversationData.deleteRequestedBy) as (ConversationDto['user_a'] | number | null | undefined);
      const rawDeleteRequesterId = conversationData.delete_requested_by_id
        ?? conversationData.deleteRequestedById
        ?? (typeof rawDeleteRequester === 'object' && rawDeleteRequester ? rawDeleteRequester.id : undefined)
        ?? (typeof rawDeleteRequester === 'number' ? rawDeleteRequester : undefined);
      const deleteRequestedById = Number.isFinite(Number(rawDeleteRequesterId)) ? Number(rawDeleteRequesterId) : null;
      const deleteRequestedAt = conversationData.delete_requested_at ?? conversationData.deleteRequestedAt ?? null;
      let deleteRequesterUsername: string | null = null;
      let deleteRequesterDisplayName: string | null = null;
      if (rawDeleteRequester && typeof rawDeleteRequester === 'object') {
        deleteRequesterUsername = typeof rawDeleteRequester.username === 'string' ? rawDeleteRequester.username : null;
        const display = typeof rawDeleteRequester.display_name === 'string' && rawDeleteRequester.display_name.trim()
          ? rawDeleteRequester.display_name.trim()
          : null;
        deleteRequesterDisplayName = display ?? deleteRequesterUsername;
      }
      if (!deleteRequesterDisplayName && deleteRequestedById) {
        const match = [conversationData.user_a, conversationData.user_b].find((entry) => entry?.id === deleteRequestedById);
        if (match) {
          deleteRequesterUsername = deleteRequesterUsername ?? (typeof match.username === 'string' ? match.username : null);
          const display = typeof match.display_name === 'string' && match.display_name.trim()
            ? match.display_name.trim()
            : null;
          deleteRequesterDisplayName = display ?? deleteRequesterUsername;
        }
      }
      if (deleteRequestedById) {
        setPendingDeleteRequest({
          fromUserId: deleteRequestedById,
          fromUsername: deleteRequesterUsername ?? null,
          fromDisplayName: deleteRequesterDisplayName ?? null,
          at: deleteRequestedAt,
        });
      } else {
        setPendingDeleteRequest(null);
      }
      const sortedMessages = (messagesResponse.results || [])
        .filter((msg) => msg.conversation === numericConversationId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const normalizedMessages = sortedMessages.map((msg) => ({
        ...msg,
        delivery_context: resolveDeliveryContext(
          msg.delivery_status,
          msg.status ?? null,
          msg.delivery_context ?? null,
          undefined,
        ) ?? msg.delivery_context ?? (msg.delivery_status && msg.delivery_status >= 2
          ? 'active'
          : msg.delivery_status && msg.delivery_status >= 1
            ? 'passive'
            : undefined),
      }));
      setRemoteMessages(normalizedMessages);
      if (sortedMessages.length) {
        const inboundMax = sortedMessages.reduce((max, msg) => {
          if (msg.sender?.id && msg.sender.id !== me.id) {
            return Math.max(max, msg.id);
          }
          return max;
        }, 0);
        if (inboundMax > 0) {
          lastInboundMessageIdRef.current = inboundMax;
          queueRead(inboundMax);
        } else {
          lastInboundMessageIdRef.current = 0;
          pendingReadRef.current = null;
        }
      } else {
        lastInboundMessageIdRef.current = 0;
        pendingReadRef.current = null;
      }
      if (Number.isFinite(numericConversationId)) {
        emitConversationPreviewUpdate({
          id: numericConversationId,
          unreadCount: 0,
        });
      }
      if (netBalance) {
        const viewerIsUserA = conversationData.user_a.id === me.id;
        const computed = computePairBalancesFromNet(netBalance, viewerIsUserA);
        setPairBalances(computed);
        setBalancesError(false);
      } else if (netBalanceErrored) {
        setBalancesError(true);
      } else {
        setPairBalances([]);
        setBalancesError(false);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
  console.warn('[Mutabaka] Failed to load conversation messages', error);
  setErrorMessage('تعذر تحميل الرسائل. تحقق من الاتصال بالخادم.');
      setBalancesError(true);
      setPendingDeleteRequest(null);
    } finally {
      if (isMountedRef.current) {
        setLoadingMessages(false);
      }
    }
  }, [numericConversationId, queueRead, shouldUseBackend]);

  useFocusEffect(
    useCallback(() => {
      loadConversationData();
      let focusTimer: ReturnType<typeof setTimeout> | null = null;
      if (Number.isFinite(numericConversationId)) {
        focusTimer = setTimeout(() => {
          emitConversationPreviewUpdate({ id: numericConversationId, unreadCount: 0 });
        }, 0);
      }

      return () => {
        if (focusTimer) {
          clearTimeout(focusTimer);
          focusTimer = null;
        }
        if (Number.isFinite(numericConversationId)) {
          setTimeout(() => {
            emitConversationPreviewUpdate({ id: numericConversationId, unreadCount: 0 });
          }, 0);
        }
      };
    }, [loadConversationData, numericConversationId]),
  );

  useEffect(() => {
    loadCurrencyOptions();
  }, [loadCurrencyOptions]);

  useEffect(() => {
    if (!conversationWsUrl || !currentUser) {
      return;
    }

    let cancelled = false;
    let manuallyClosed = false;
    const wsUrl = conversationWsUrl as string;

    function scheduleRetry() {
      if (cancelled || manuallyClosed) {
        return;
      }
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;
      if (attempt > 8) {
        return;
      }
      const delay = Math.min(1000 * Math.pow(1.8, attempt - 1), 8000);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    async function connect() {
      if (cancelled) {
        return;
      }
      let token: string | null = null;
      try {
        token = await getAccessToken();
      } catch (error) {
        console.warn('[Mutabaka] Failed to read auth token for chat socket', error);
      }
      let socket: WebSocket | null = null;
      try {
        socket = createWebSocket(wsUrl, {
          token,
          query: {
            tenant: environment.tenantHost,
            tenant_host: environment.tenantHost,
          },
        });
      } catch (error) {
        console.warn('[Mutabaka] Failed to open chat socket', error);
        scheduleRetry();
        return;
      }
      wsRef.current = socket;
      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        console.log('[Mutabaka] Chat socket opened');
        flushAck();
        flushPendingRead();
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleWsMessage(payload);
        } catch (error) {
          console.warn('[Mutabaka] Failed to parse chat socket payload', error);
        }
      };
      socket.onerror = (error) => {
        console.warn('[Mutabaka] Chat socket error event', error);
        try {
          socket?.close();
        } catch {}
      };
      socket.onclose = (event) => {
        console.warn('[Mutabaka] Chat socket closed', { code: event.code, reason: event.reason });
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!cancelled && !manuallyClosed && event.code !== 1000) {
          scheduleRetry();
        }
      };
    }

    reconnectAttemptsRef.current = 0;
    connect();

    return () => {
      cancelled = true;
      manuallyClosed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      pendingAckRef.current.clear();
    };
  }, [conversationWsUrl, currentUser, flushAck, flushPendingRead, handleWsMessage]);

  const conversationMessages = useMemo<NormalizedMessage[]>(() => {
    if (remoteMessages.length && currentUser) {
      return remoteMessages.map((msg) => {
        const transaction = parseTransactionMessage(msg.body);
        const rawBody = typeof msg.body === 'string' ? msg.body : '';
        const trimmedBody = rawBody.trim();
        const walletMeta = detectWalletSettlement(msg);
        const hasRemoteAttachment = Boolean(msg.attachment_url || msg.attachment_name);
        const attachmentFallback = msg.attachment_name || (msg.attachment_url ? DEFAULT_ATTACHMENT_PREVIEW : '');
        const body = walletMeta.detected ? walletMeta.label : (trimmedBody || attachmentFallback);
        const isSystem = walletMeta.detected ? false : isMemberSystemMessage(msg.type, msg.body);
        const attachmentMeta: AttachmentMeta | null = hasRemoteAttachment
          ? {
              url: typeof msg.attachment_url === 'string' ? msg.attachment_url : null,
              name: msg.attachment_name ?? null,
              mime: msg.attachment_mime ?? null,
              size: msg.attachment_size ?? null,
            }
          : null;
        const variant: NormalizedMessage['variant'] = walletMeta.detected
          ? 'wallet'
          : isSystem
            ? 'system'
            : transaction
              ? 'transaction'
              : attachmentMeta
                ? 'attachment'
                : 'text';
        const numericMessageId = Number.isFinite(msg.id) ? Number(msg.id) : undefined;
        const computedIsMine = (numericMessageId !== undefined && myMessageIdsRef.current.has(numericMessageId))
          || isMessageFromUser(msg, currentUser);
        if (computedIsMine && numericMessageId !== undefined) {
          myMessageIdsRef.current.add(numericMessageId);
        }
        if (__DEV__ && attachmentMeta) {
          const logged = loggedAttachmentIdsRef.current;
          if (!logged.has(msg.id)) {
            logged.add(msg.id);
            console.debug('[Mutabaka][ChatScreen] attachment meta', {
              id: msg.id,
              url: attachmentMeta.url,
              name: attachmentMeta.name,
              mime: attachmentMeta.mime,
              size: attachmentMeta.size,
            });
          }
        }
        const author: NormalizedMessage['author'] = computedIsMine ? 'me' : 'them';
        const senderName = computedIsMine 
          ? (currentUser?.display_name || currentUser?.username || 'أنا')
          : (msg.senderDisplay || msg.sender?.display_name || msg.sender?.username || 'مستخدم');
        const deliveryDisplay = isSystem
          ? null
          : mapDeliveryStatus(msg.delivery_status, msg.status, msg.delivery_context ?? null);
        return {
          id: String(msg.id),
          conversationId: String(msg.conversation),
          author,
          senderName,
          text: body,
          caption: walletMeta.detected ? null : (trimmedBody || null),
          time: formatMessageTime(msg.created_at),
          date: formatMessageDate(msg.created_at),
          timestamp: msg.created_at ?? null,
          status: walletMeta.detected ? undefined : deliveryDisplay?.status,
          deliveredPassively: deliveryDisplay?.status === 'delivered' ? deliveryDisplay.passive : undefined,
          variant,
          transaction: walletMeta.detected ? undefined : transaction ?? undefined,
          attachment: walletMeta.detected ? null : attachmentMeta,
          walletSettlement: walletMeta.detected ? { label: walletMeta.label, settledAt: walletMeta.settledAt } : undefined,
        };
      });
    }
    return fallbackMessages;
  }, [currentUser, remoteMessages, fallbackMessages]);

  const headerTitle = remoteTitle ?? fallbackConversation?.title ?? 'محادثة';
  const viewerDisplayName = pickDisplayName(currentUser) || currentUser?.username || 'أنت';
  const peerDisplayName = pickDisplayName(peerUser) || remoteTitle || 'الطرف الآخر';

  const normalizedSearchQuery = searchQuery.trim();

  const visibleMessages = useMemo<NormalizedMessage[]>(() => {
    let next = [...conversationMessages];
    if (showTransactionsOnly) {
      next = next.filter((msg) => msg.variant === 'transaction');
    }
    return next;
  }, [conversationMessages, showTransactionsOnly]);

  const searchMatches = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [] as { messageId: string }[];
    }
    const needle = normalizedSearchQuery.toLowerCase();
    return visibleMessages.reduce<{ messageId: string }[]>((acc, message) => {
      const haystacks: string[] = [];
      if (message.text) {
        haystacks.push(message.text);
      }
      if (message.transaction?.note) {
        haystacks.push(message.transaction.note);
      }
      if (message.attachment?.name) {
        haystacks.push(message.attachment.name);
      }
      const hasMatch = haystacks.some((value) => value && value.toLowerCase().includes(needle));
      if (hasMatch) {
        acc.push({ messageId: message.id });
      }
      return acc;
    }, []);
  }, [normalizedSearchQuery, visibleMessages]);

  useEffect(() => {
    if (!normalizedSearchQuery) {
      if (activeSearchIndex !== 0) {
        setActiveSearchIndex(0);
      }
      return;
    }
    if (!searchMatches.length) {
      if (activeSearchIndex !== 0) {
        setActiveSearchIndex(0);
      }
      return;
    }
    if (activeSearchIndex > searchMatches.length - 1) {
      setActiveSearchIndex(0);
    }
  }, [activeSearchIndex, normalizedSearchQuery, searchMatches.length]);

  const searchMatchSet = useMemo(() => new Set(searchMatches.map((entry) => entry.messageId)), [searchMatches]);

  const activeSearchMatchId = useMemo(() => {
    if (!searchMatches.length) {
      return null;
    }
    const index = Math.min(activeSearchIndex, searchMatches.length - 1);
    return searchMatches[index]?.messageId ?? null;
  }, [activeSearchIndex, searchMatches]);

  const listData = useMemo(() => [...visibleMessages].reverse(), [visibleMessages]);

  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    listData.forEach((message, index) => {
      map.set(message.id, index);
    });
    return map;
  }, [listData]);

  useEffect(() => {
    if (!normalizedSearchQuery) {
      return;
    }
    setActiveSearchIndex(0);
  }, [normalizedSearchQuery]);

  const scrollToMessageId = useCallback((messageId: string | null) => {
    if (!messageId) {
      return;
    }
    const list = listRef.current;
    if (!list) {
      return;
    }
    const index = messageIndexMap.get(messageId);
    if (index === undefined) {
      return;
    }
    isAtBottomRef.current = false;
    setShowJumpToLatest(true);
    InteractionManager.runAfterInteractions(() => {
      try {
        list.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch (error) {
        console.warn('[Mutabaka] Failed to scroll to message, falling back to offset', error);
        try {
          list.scrollToOffset({ offset: 0, animated: true });
        } catch {}
      }
    });
  }, [messageIndexMap]);

  useEffect(() => {
    if (!normalizedSearchQuery || !activeSearchMatchId) {
      return;
    }
    scrollToMessageId(activeSearchMatchId);
  }, [activeSearchMatchId, normalizedSearchQuery, scrollToMessageId]);

  const goToNextSearchMatch = useCallback(() => {
    const count = searchMatches.length;
    if (!count) {
      return;
    }
    setActiveSearchIndex((prev) => (prev + 1) % count);
  }, [searchMatches.length]);

  const goToPreviousSearchMatch = useCallback(() => {
    const count = searchMatches.length;
    if (!count) {
      return;
    }
    setActiveSearchIndex((prev) => (prev - 1 + count) % count);
  }, [searchMatches.length]);

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event?.nativeEvent?.contentOffset?.y ?? 0;
    const nearBottom = offsetY <= 24;
    if (nearBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = nearBottom;
      setShowJumpToLatest(!nearBottom);
    }
  }, []);

  const handleJumpToLatest = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    try {
      list.scrollToOffset({ offset: 0, animated: true });
      isAtBottomRef.current = true;
      setShowJumpToLatest(false);
    } catch (error) {
      console.warn('[Mutabaka] Failed to jump to latest message', error);
    }
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setSearchQuery('');
        setActiveSearchIndex(0);
      }
      return !prev;
    });
  }, []);

  useEffect(() => {
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [conversationId]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      setShowJumpToLatest(false);
    }
  }, [visibleMessages.length]);

  const closeActionsMenu = useCallback(() => {
    setActionsMenuVisible(false);
  }, []);

  const handleToggleActionsMenu = useCallback(() => {
    setActionsMenuVisible((prev) => !prev);
  }, []);

  const handleSelectFilterAction = useCallback(() => {
    setShowTransactionsOnly((prev) => !prev);
    closeActionsMenu();
  }, [closeActionsMenu]);

  const closeExportModal = useCallback(() => {
    if (exportBusy) {
      return;
    }
    setExportModalVisible(false);
    setExportError(null);
  }, [exportBusy]);

  const handleSelectExportAction = useCallback(() => {
    closeActionsMenu();
    if (!shouldUseBackend || !Number.isFinite(numericConversationId)) {
      setExportError('هذه المحادثة غير متاحة للتصدير حالياً');
      return;
    }
    const now = new Date();
    const to = toDateInputValue(now);
    const from = toDateInputValue(new Date(now.getTime() - (EXPORT_DEFAULT_RANGE_DAYS - 1) * DAY_IN_MS));
    setExportDateFrom(from);
    setExportDateTo(to);
    setExportFormat('excel');
    setExportError(null);
    setExportBusy(false);
    setExportModalVisible(true);
  }, [closeActionsMenu, numericConversationId, shouldUseBackend]);

  const handleApproveDeleteRequest = useCallback(async () => {
    if (!pendingDeleteRequest || deleteRequestBusy === 'approve') {
      return;
    }
    if (!shouldUseBackend || !Number.isFinite(numericConversationId)) {
      Alert.alert('غير متاح حالياً', 'لا يمكن معالجة طلب الحذف بدون اتصال بالخادم.');
      return;
    }
    if (!currentUser) {
      Alert.alert('المستخدم غير معروف', 'يرجى إعادة فتح المحادثة ثم المحاولة من جديد.');
      return;
    }
    if (pendingDeleteRequest.fromUserId && pendingDeleteRequest.fromUserId === currentUser.id) {
      Alert.alert('بانتظار الطرف الآخر', 'لا يمكنك الموافقة على طلب أرسلته بنفسك.');
      return;
    }
    setDeleteRequestBusy('approve');
    try {
      await approveDeleteConversation(numericConversationId);
      deleteResolutionRef.current = 'approved';
      setPendingDeleteRequest(null);
      emitConversationPreviewUpdate({ id: numericConversationId, removed: true });
      setStatusBanner({ kind: 'success', text: 'تم حذف جهة الاتصال.' });
      navigation.navigate('Home');
    } catch (error) {
      const message = extractErrorMessage(error, 'تعذر الموافقة على طلب الحذف.');
      setStatusBanner({ kind: 'error', text: message });
    } finally {
      if (isMountedRef.current) {
        setDeleteRequestBusy(null);
      }
    }
  }, [pendingDeleteRequest, deleteRequestBusy, shouldUseBackend, numericConversationId, currentUser, navigation]);

  const handleDeclineDeleteRequest = useCallback(async () => {
    if (!pendingDeleteRequest || deleteRequestBusy === 'decline') {
      return;
    }
    if (!shouldUseBackend || !Number.isFinite(numericConversationId)) {
      Alert.alert('غير متاح حالياً', 'لا يمكن معالجة طلب الحذف بدون اتصال بالخادم.');
      return;
    }
    if (pendingDeleteRequest.fromUserId && currentUser && pendingDeleteRequest.fromUserId === currentUser.id) {
      Alert.alert('طلبك قيد الانتظار', 'لا يمكنك رفض طلب أرسلته بنفسك. يمكنك سحب الطلب من خلال مراسلة الدعم.');
      return;
    }
    setDeleteRequestBusy('decline');
    try {
      await declineDeleteConversation(numericConversationId);
      deleteResolutionRef.current = 'declined';
      setPendingDeleteRequest(null);
      emitConversationPreviewUpdate({ id: numericConversationId });
      setStatusBanner({ kind: 'success', text: 'تم رفض طلب الحذف.' });
    } catch (error) {
      const message = extractErrorMessage(error, 'تعذر رفض طلب الحذف.');
      setStatusBanner({ kind: 'error', text: message });
    } finally {
      if (isMountedRef.current) {
        setDeleteRequestBusy(null);
      }
    }
  }, [pendingDeleteRequest, deleteRequestBusy, shouldUseBackend, numericConversationId, currentUser]);

  const handleConfirmExport = useCallback(async () => {
    if (exportBusy) {
      return;
    }
    if (!shouldUseBackend || !Number.isFinite(numericConversationId)) {
      setExportError('هذه المحادثة غير متاحة للتصدير حالياً');
      return;
    }
    if (!currentUser) {
      setExportError('لا تزال بيانات المستخدم قيد التحميل، حاول بعد قليل');
      return;
    }

    const fromValue = exportDateFrom.trim();
    const toValue = exportDateTo.trim();
    if (!fromValue || !toValue) {
      setExportError('يرجى اختيار تاريخ البداية والنهاية');
      return;
    }

    const fromDate = new Date(`${fromValue}T00:00:00`);
    const toDate = new Date(`${toValue}T23:59:59`);
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
      const pageSize = 200;
      let page = 1;
      let hasNext = true;
      const allTransactions: TransactionDto[] = [];

      while (hasNext) {
        const response = await fetchTransactions({
          conversation: numericConversationId,
          fromDate: fromValue,
          toDate: toValue,
          ordering: 'created_at',
          page,
          pageSize,
        });
        const batch = Array.isArray(response?.results) ? response.results : [];
        if (batch.length) {
          allTransactions.push(...batch);
        }
        if (response?.next && batch.length) {
          page += 1;
        } else {
          hasNext = false;
        }
      }

      if (!allTransactions.length) {
        setExportError('لا توجد معاملات ضمن النطاق المحدد');
        return;
      }

      const viewerName = pickDisplayName(currentUser) || currentUser.username || 'أنا';
      const otherName = peerDisplayName || 'جهة الاتصال';

      const rows: ExportRow[] = allTransactions
        .map((item) => {
          const directionLabel: 'لنا' | 'لكم' = item.direction_label === 'لكم' ? 'لكم' : 'لنا';
          const amountSource = item.amount_value ?? item.amount ?? '0';
          const parsedAmount = Number.parseFloat(String(amountSource));
          const amountNumber = Number.isFinite(parsedAmount) ? parsedAmount : 0;
          const currencySymbol = item.currency?.symbol || item.currency?.code || '';
          const senderName = pickDisplayName(item.from_user_info) || item.from_user_info?.username || (directionLabel === 'لنا' ? otherName : viewerName);
          const noteText = typeof item.note === 'string' ? item.note.trim() : '';
          const createdAt = item.created_at;
          const formattedDate = createdAt ? `${formatMessageDate(createdAt)} ${formatMessageTime(createdAt)}`.trim() : '';
          return {
            index: 0,
            senderName,
            directionLabel,
            amountDisplay: formatAmountLabel(amountNumber, currencySymbol),
            amountNumber: Math.abs(amountNumber),
            positive: directionLabel === 'لنا',
            noteText,
            dateTimeDisplay: formattedDate,
            createdAtISO: createdAt,
          } as ExportRow;
        })
        .sort((a, b) => {
          const aTime = a.createdAtISO ? new Date(a.createdAtISO).getTime() : 0;
          const bTime = b.createdAtISO ? new Date(b.createdAtISO).getTime() : 0;
          return aTime - bTime;
        })
        .map((row, index) => ({ ...row, index: index + 1 }));

      if (!rows.length) {
        setExportError('لا توجد معاملات ضمن النطاق المحدد');
        return;
      }

      const rangeLabel = `الفترة: ${fromValue} → ${toValue}`;
      const filename = safeFilename(
        `transactions_${numericConversationId}_${exportFormat}_${fromValue}_${toValue}`,
        exportFormat === 'excel' ? 'xlsx' : 'pdf',
      );

      const fileUri = exportFormat === 'excel'
        ? await exportRowsToExcelMobile(rows, { a: viewerName, b: otherName }, rangeLabel, filename)
        : await exportRowsToPdfMobile(rows, { a: viewerName, b: otherName }, rangeLabel, filename);

      const mimeType = exportFormat === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
      let shared = false;
      try {
        const Sharing = await import('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType,
            dialogTitle: filename,
            UTI: exportFormat === 'pdf' ? 'com.adobe.pdf' : 'org.openxmlformats.spreadsheetml.sheet',
          });
          shared = true;
        }
      } catch (shareModuleError) {
        console.warn('[Mutabaka] expo-sharing not available, falling back to native share', shareModuleError);
      }

      if (!shared) {
        await Share.share({
          url: fileUri,
          message: `ملف التصدير: ${filename}`,
          title: filename,
        });
      }

      setStatusBanner({
        kind: 'success',
        text: exportFormat === 'excel'
          ? 'تم إنشاء ملف Excel ويمكنك مشاركته الآن.'
          : 'تم إنشاء ملف PDF ويمكنك مشاركته الآن.',
      });
      setExportError(null);
      setExportModalVisible(false);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'تعذر إكمال التصدير';
      setExportError(message);
    } finally {
      setExportBusy(false);
    }
  }, [
    currentUser,
    exportBusy,
    exportDateFrom,
    exportDateTo,
    exportFormat,
    numericConversationId,
    peerDisplayName,
    setExportError,
    setExportModalVisible,
    setStatusBanner,
    shouldUseBackend,
  ]);

  const handleSelectSearchAction = useCallback(() => {
    closeActionsMenu();
    toggleSearch();
  }, [closeActionsMenu, toggleSearch]);

  const hasSearchResults = Boolean(normalizedSearchQuery) && searchMatches.length > 0;
  const clampedSearchIndex = hasSearchResults
    ? Math.min(activeSearchIndex, searchMatches.length - 1)
    : 0;
  const searchResultPosition = hasSearchResults ? clampedSearchIndex + 1 : 0;
  const showSearchNavigation = hasSearchResults && searchMatches.length > 1;

  const currencyMap = useMemo(() => {
    const map = new Map<string, CurrencyOption>();
    currencyOptions.forEach((option) => {
      map.set(option.code, option);
    });
    return map;
  }, [currencyOptions]);

  const selectedCurrencyOption = useMemo(() => currencyMap.get(selectedCurrency), [currencyMap, selectedCurrency]);

  const canManageMembers = useMemo(() => {
    if (isTeamActor) {
      return false;
    }
    if (!shouldUseBackend || !currentUser || !conversationMeta) {
      return false;
    }
    return currentUser.id === conversationMeta.userAId || currentUser.id === conversationMeta.userBId;
  }, [conversationMeta, currentUser, isTeamActor, shouldUseBackend]);

  const handleInsertEmoji = useCallback((emoji: string) => {
    if (!emoji) {
      return;
    }
    setDraft((prev) => {
      const next = prev ?? '';
      const needsSpace = next.length > 0 && !/\s$/.test(next);
      return `${next}${needsSpace ? ' ' : ''}${emoji}`;
    });
  }, []);

  const loadMembersPanelData = useCallback(async () => {
    if (!shouldUseBackend || Number.isNaN(numericConversationId)) {
      setMembersError('هذه الميزة غير متاحة حالياً في الوضع التجريبي.');
      return;
    }
    setMembersLoading(true);
    setMembersError(null);
    try {
      const teamPromise = isTeamActor
        ? Promise.resolve<TeamMember[]>([])
        : listTeamMembers().catch((error) => {
          if (error instanceof HttpError && error.status === 403) {
            return [];
          }
          throw error;
        });
      const [membersResponse, teamList] = await Promise.all([
        fetchConversationMembers(numericConversationId),
        teamPromise,
      ]);
      if (!isMountedRef.current) {
        return;
      }
      const normalizedMembers = (membersResponse || [])
        .map((entry) => normalizeConversationMember(entry))
        .filter((entry): entry is ConversationMemberItem => Boolean(entry));
      setConversationMembers(normalizedMembers);
      setTeamMembers(Array.isArray(teamList) ? teamList : []);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractErrorMessage(error, 'تعذر تحميل أعضاء المحادثة');
      setMembersError(message);
    } finally {
      if (isMountedRef.current) {
        setMembersLoading(false);
        setMembersBusy(false);
      }
    }
  }, [isTeamActor, numericConversationId, shouldUseBackend]);

  const handleToggleMembersPanel = useCallback(() => {
    setMembersModalVisible((prev) => {
      if (!prev) {
        loadMembersPanelData();
      }
      return !prev;
    });
  }, [loadMembersPanelData]);

  const handleSelectMembersAction = useCallback(() => {
    closeActionsMenu();
    handleToggleMembersPanel();
  }, [closeActionsMenu, handleToggleMembersPanel]);

  const handleRemoveConversationMember = useCallback(async (member: ConversationMemberItem) => {
    if (!shouldUseBackend || Number.isNaN(numericConversationId)) {
      Alert.alert('الميزة غير متاحة', 'لا يمكن تعديل أعضاء المحادثة في الوضع التجريبي.');
      return;
    }
    if (!canManageMembers) {
      Alert.alert('الصلاحيات غير كافية', 'لا تملك صلاحية تعديل أعضاء هذه المحادثة.');
      return;
    }
    if (member.role === 'participant') {
      Alert.alert('غير مسموح', 'لا يمكن إزالة المشاركين الأساسيين من المحادثة.');
      return;
    }

    setMembersBusy(true);
    setMembersError(null);
    const targetType = member.memberType === 'team_member' || member.role === 'team' ? 'team_member' : 'user';
    try {
      await removeConversationMember(numericConversationId, member.memberId, targetType);
      setConversationMembers((prev) => prev.filter((item) => !(item.memberId === member.memberId && item.memberType === member.memberType)));
      setStatusBanner({ kind: 'success', text: `تمت إزالة ${member.displayName || member.username || 'العضو'} من المحادثة` });
    } catch (error) {
      const message = extractErrorMessage(error, 'تعذر إزالة العضو');
      Alert.alert('تعذر الإزالة', message);
    } finally {
      if (isMountedRef.current) {
        setMembersBusy(false);
      }
    }
  }, [canManageMembers, numericConversationId, shouldUseBackend]);

  const handleAddTeamMember = useCallback(async (teamMember: TeamMember) => {
    if (!shouldUseBackend || Number.isNaN(numericConversationId)) {
      Alert.alert('الميزة غير متاحة', 'لا يمكن تعديل أعضاء المحادثة في الوضع التجريبي.');
      return;
    }
    if (!canManageMembers) {
      Alert.alert('الصلاحيات غير كافية', 'لا تملك صلاحية تعديل أعضاء هذه المحادثة.');
      return;
    }
    const alreadyMember = conversationMembers.some((member) => (
      member.memberType === 'team_member' && member.memberId === teamMember.id
    ));
    if (alreadyMember) {
      return;
    }

    setMembersBusy(true);
    setMembersError(null);
    try {
      await addConversationTeamMember(numericConversationId, teamMember.id);
      const normalized: ConversationMemberItem = {
        memberId: teamMember.id,
        username: teamMember.username,
        displayName: (teamMember.display_name || teamMember.username || '').trim() || teamMember.username,
        role: 'team_member',
        memberType: 'team_member',
      };
      setConversationMembers((prev) => [...prev, normalized]);
      setStatusBanner({ kind: 'success', text: `تمت إضافة ${normalized.displayName} إلى المحادثة` });
    } catch (error) {
      const message = extractErrorMessage(error, 'تعذر إضافة العضو');
      Alert.alert('تعذر الإضافة', message);
    } finally {
      if (isMountedRef.current) {
        setMembersBusy(false);
      }
    }
  }, [canManageMembers, conversationMembers, numericConversationId, shouldUseBackend]);

  const handleSaveTransaction = useCallback(async () => {
    if (!shouldUseBackend || Number.isNaN(numericConversationId) || transactionLoading) {
      return;
    }

    const parsedOurs = parseNumericInput(ourShare);
    const parsedTheirs = parseNumericInput(theirShare);
    const operations: { amount: number; direction: 'lna' | 'lkm' }[] = [];
    if (!Number.isNaN(parsedOurs)) {
      operations.push({ amount: parsedOurs, direction: 'lna' });
    }
    if (!Number.isNaN(parsedTheirs)) {
      operations.push({ amount: parsedTheirs, direction: 'lkm' });
    }

    if (!operations.length) {
      Alert.alert('القيمة غير صالحة', 'الرجاء إدخال قيمة موجبة في أحد الحقول قبل الحفظ.');
      return;
    }

    let currencyId = selectedCurrencyOption?.id;
    if (!currencyId) {
      try {
        let latest = await fetchCurrencies();
        if (!latest.length) {
          try {
            await bootstrapCurrencies();
            latest = await fetchCurrencies();
          } catch (error) {
            console.warn('[Mutabaka] bootstrapCurrencies retry failed', error);
          }
        }
        setCurrencyOptions(latest);
        currencyId = latest.find((item) => item.code === selectedCurrency)?.id;
      } catch (error) {
        console.warn('[Mutabaka] Failed to refresh currencies', error);
      }
    }

    if (!currencyId) {
      Alert.alert('لم يتم العثور على العملة', 'تعذر تحديد العملة المختارة. حاول اختيار عملة أخرى أو إعادة تحميل الصفحة.');
      return;
    }

    setTransactionLoading(true);
    setStatusBanner(null);

    try {
      for (const op of operations) {
        await createTransaction({
          conversation: numericConversationId,
          currency_id: currencyId,
          amount: op.amount.toFixed(5),
          direction: op.direction,
          note: note.trim() || undefined,
        });
      }

      setStatusBanner({ kind: 'success', text: 'تم حفظ المعاملة' });
      setOurShare('');
      setTheirShare('');
      setNote('');
      setNoteModalVisible(false);
      await loadConversationData();
    } catch (error) {
      const message = extractErrorMessage(error, 'فشل حفظ المعاملة');
      setStatusBanner({ kind: 'error', text: message });
      Alert.alert('فشل حفظ المعاملة', message);
    } finally {
      if (isMountedRef.current) {
        setTransactionLoading(false);
      }
    }
  }, [loadConversationData, note, numericConversationId, ourShare, selectedCurrency, selectedCurrencyOption, shouldUseBackend, theirShare, transactionLoading]);

  const isLight = mode === 'light';

  const headerBackground = isLight ? '#fff3e4' : tokens.panel;
  const headerBorderColor = tokens.divider;
  const headerButtonBackground = isLight ? '#fff9f2' : tokens.panelAlt;
  const headerButtonBorder = isLight ? '#f4d7c0' : tokens.divider;
  const headerPrimaryText = isLight ? '#2d241a' : '#ffffff';
  const headerSecondaryText = isLight ? '#8c6d52' : '#94a3b8';
  const headerIconColor = isLight ? '#f97316' : '#facc15';
  const actionsMenuTriggerActiveBackground = isLight ? '#fde4c3' : '#1f2937';
  const actionsMenuTriggerActiveBorder = isLight ? '#f9d3a7' : '#334155';
  const actionsMenuTriggerActiveIcon = isLight ? '#b45309' : '#facc15';

  const filterActiveBackground = isLight ? '#dcfce7' : '#14532d';
  const filterActiveBorder = isLight ? '#4ade80' : '#22c55e';
  const filterActiveIcon = isLight ? '#047857' : '#bbf7d0';

  const exportActiveBackground = isLight ? '#ecfdf5' : '#064e3b';
  const exportActiveBorder = isLight ? '#6ee7b7' : '#047857';
  const exportActiveIcon = isLight ? '#047857' : '#86efac';

  const searchActiveBackground = isLight ? '#fde4c3' : '#1f2937';
  const searchActiveBorder = isLight ? '#f9d3a7' : '#334155';
  const searchActiveIcon = isLight ? '#b45309' : '#facc15';

  const membersActiveBackground = isLight ? '#dbeafe' : '#1e293b';
  const membersActiveBorder = isLight ? '#93c5fd' : '#334155';
  const membersActiveIcon = isLight ? '#1d4ed8' : '#bfdbfe';

  const actionsMenuTriggerActive = actionsMenuVisible || showTransactionsOnly || membersModalVisible || searchOpen || exportModalVisible;

  const deleteBannerBackground = isLight ? 'rgba(251, 191, 36, 0.16)' : 'rgba(120, 53, 15, 0.45)';
  const deleteBannerBorder = isLight ? '#facc15' : '#fbbf24';
  const deleteBannerTitleColor = isLight ? '#92400e' : '#fde68a';
  const deleteBannerSubtitleColor = isLight ? '#b45309' : '#facc15';
  const deleteBannerInfoColor = isLight ? '#78350f' : '#fef3c7';
  const deleteApproveBackground = isLight ? '#dc2626' : '#b91c1c';
  const deleteApproveBorder = isLight ? '#b91c1c' : '#ef4444';
  const deleteApproveText = isLight ? '#fef2f2' : '#fee2e2';
  const deleteDeclineBackground = isLight ? '#f8fafc' : 'rgba(148, 163, 184, 0.2)';
  const deleteDeclineBorder = isLight ? '#cbd5f5' : '#94a3b8';
  const deleteDeclineText = isLight ? '#0f172a' : '#e2e8f0';

  const membersCardBackground = isLight ? '#fff7ed' : tokens.panelAlt;
  const membersAvatarBackground = isLight ? '#fffaf4' : tokens.panel;
  const membersAvatarBorder = isLight ? '#fce7c3' : tokens.divider;
  const membersRoleColor = isLight ? '#b45309' : '#e2e8f0';
  const membersSectionHeaderColor = isLight ? '#9a3412' : '#cbd5f5';

  const daySeparatorBackground = isLight ? 'rgba(249, 115, 22, 0.16)' : 'rgba(30, 41, 59, 0.7)';
  const daySeparatorBorder = isLight ? 'rgba(249, 115, 22, 0.35)' : 'rgba(253, 224, 71, 0.35)';
  const daySeparatorTextColor = isLight ? '#92400e' : '#fde68a';

  const composerBackground = isLight ? '#fff6ec' : tokens.panel;
  const composerButtonBackground = isLight ? '#fffaf4' : tokens.panelAlt;
  const composerButtonBorder = headerButtonBorder;
  const composerInputBackground = isLight ? '#ffffff' : tokens.panelAlt;
  const composerInputBorder = isLight ? '#f4d3b5' : tokens.divider;
  const composerPlaceholderColor = isLight ? '#7c2d12' : '#facc15';

  const composerLineHeight = 20;
  const composerMaxLines = 4;
  const composerWrapperVerticalPadding = 20;
  const composerMinContentHeight = 32;
  const composerMaxContentHeight = composerLineHeight * composerMaxLines;
  const composerMinWrapperHeight = composerMinContentHeight + composerWrapperVerticalPadding;
  const composerMaxWrapperHeight = composerMaxContentHeight + composerWrapperVerticalPadding;
  const [composerContentHeight, setComposerContentHeight] = useState(composerMinContentHeight);

  const handleComposerContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const height = event?.nativeEvent?.contentSize?.height;
      if (!Number.isFinite(height)) {
        return;
      }
      const clamped = Math.min(
        composerMaxContentHeight,
        Math.max(composerMinContentHeight, height),
      );
      setComposerContentHeight((prev) => (Math.abs(prev - clamped) < 1 ? prev : clamped));
    },
    [composerMaxContentHeight, composerMinContentHeight],
  );

  useEffect(() => {
    if (!draft) {
      setComposerContentHeight(composerMinContentHeight);
    }
  }, [draft, composerMinContentHeight]);

  const composerWrapperHeight = Math.min(
    composerMaxWrapperHeight,
    Math.max(composerMinWrapperHeight, composerContentHeight + composerWrapperVerticalPadding),
  );
  const composerReachedMaxLines = composerContentHeight >= composerMaxContentHeight - 1;

  const actionBaseStyle = useMemo(
    () => ({ backgroundColor: headerButtonBackground, borderColor: headerButtonBorder }),
    [headerButtonBackground, headerButtonBorder],
  );

  const sortedConversationMembers = useMemo(() => (
    [...conversationMembers].sort((a, b) => {
      const nameA = (a.displayName || a.username || '').trim().toLowerCase();
      const nameB = (b.displayName || b.username || '').trim().toLowerCase();
      if (nameA < nameB) {
        return -1;
      }
      if (nameA > nameB) {
        return 1;
      }
      return 0;
    })
  ), [conversationMembers]);

  const teamMemberIdsInConversation = useMemo(() => {
    const identifiers = new Set<number>();
    conversationMembers.forEach((member) => {
      if (member.memberType === 'team_member') {
        identifiers.add(member.memberId);
      }
    });
    return identifiers;
  }, [conversationMembers]);

  const sortedTeamMembers = useMemo(() => (
    teamMembers
      .filter((member) => {
        const identifier = Number(member?.id);
        if (!Number.isFinite(identifier)) {
          return true;
        }
        return !teamMemberIdsInConversation.has(identifier);
      })
      .sort((a, b) => {
        const nameA = (a.display_name || a.username || '').trim().toLowerCase();
        const nameB = (b.display_name || b.username || '').trim().toLowerCase();
        if (nameA < nameB) {
          return -1;
        }
        if (nameA > nameB) {
          return 1;
        }
        return 0;
      })
  ), [teamMemberIdsInConversation, teamMembers]);

  const balances = useMemo(() => {
    if (!pairBalances.length) {
      return [] as BalanceSummary[];
    }
    const priority = ['USD', 'TRY', 'EUR', 'SYP'];
    const map = new Map<string, BalanceSummary>();
    pairBalances.forEach((balance) => {
      map.set(balance.code, balance);
    });
    const ordered = priority
      .map((code) => map.get(code))
      .filter((item): item is BalanceSummary => Boolean(item));
    const remaining = pairBalances.filter((balance) => !priority.includes(balance.code));
    return [...ordered, ...remaining].filter((balance) => Math.abs(balance.amount) >= 0.005);
  }, [pairBalances]);

  const renderBalanceChip = useCallback((balance: BalanceSummary) => {
    const positive = balance.amount >= 0;
    const textColor = positive ? '#047857' : '#b91c1c';
    const symbol = currencyMap.get(balance.code)?.symbol || balance.symbol || balance.code;
    const formatted = formatBalance(Math.abs(balance.amount));

    return (
      <View key={balance.code} style={styles.balanceChip}>
        <Text style={[styles.balanceText, { color: textColor }]} numberOfLines={1}>
          {formatted}
          <Text style={[styles.balanceCurrency, { color: textColor }]}> {symbol}</Text>
        </Text>
      </View>
    );
  }, [currencyMap]);

  const hideFinancialTools = useMemo(() => (
    isAdminLike(currentUser?.username) || isAdminLike(peerUser?.username)
  ), [currentUser?.username, peerUser?.username]);

  const showBalancesRow = useMemo(() => (
    !hideFinancialTools && (balances.length > 0 || balancesError)
  ), [balances.length, balancesError, hideFinancialTools]);

  const deleteRequestIsMine = useMemo(() => {
    if (!pendingDeleteRequest || !currentUser) {
      return false;
    }
    const requesterId = pendingDeleteRequest.fromUserId;
    if (typeof requesterId === 'number' && Number.isFinite(requesterId) && requesterId === currentUser.id) {
      return true;
    }
    const requesterUsername = pendingDeleteRequest.fromUsername?.trim().toLowerCase();
    if (requesterUsername && currentUser.username?.trim().toLowerCase() === requesterUsername) {
      return true;
    }
    return false;
  }, [pendingDeleteRequest, currentUser]);

  const deleteRequesterName = useMemo(() => {
    if (!pendingDeleteRequest) {
      return null;
    }
    if (deleteRequestIsMine) {
      return pickDisplayName(currentUser) || currentUser?.username || 'أنت';
    }
    const display = pendingDeleteRequest.fromDisplayName?.trim();
    if (display) {
      return display;
    }
    const username = pendingDeleteRequest.fromUsername?.trim();
    if (username) {
      return username;
    }
    const requesterId = pendingDeleteRequest.fromUserId;
    if (typeof requesterId === 'number' && peerUser?.id === requesterId) {
      return pickDisplayName(peerUser) || peerUser?.username || 'الطرف الآخر';
    }
    return pickDisplayName(peerUser) || peerUser?.username || 'الطرف الآخر';
  }, [pendingDeleteRequest, deleteRequestIsMine, currentUser, peerUser]);

  const deleteRequestTimestampLabel = useMemo(() => {
    if (!pendingDeleteRequest?.at) {
      return null;
    }
    const datePart = formatMessageDate(pendingDeleteRequest.at);
    const timePart = formatMessageTime(pendingDeleteRequest.at);
    if (datePart && timePart) {
      return `${datePart} ${timePart}`;
    }
    return datePart || timePart || null;
  }, [pendingDeleteRequest]);

  const renderEmpty = useCallback(() => {
    if (shouldUseBackend && loadingMessages) {
      return (
        <View style={[styles.emptyState, { transform: [{ scaleY: -1 }, { scaleX: -1 }] }]}>
          <Text style={[styles.emptyText, { color: tokens.textMuted }]}>جارٍ تحميل الرسائل…</Text>
        </View>
      );
    }
    return (
      <View style={[styles.emptyState, { transform: [{ scaleY: -1 }] }]}>
      </View>
    );
  }, [loadingMessages, shouldUseBackend, tokens.textMuted]);

  const renderMessage = useCallback((
    { item, index }: ListRenderItemInfo<NormalizedMessage>,
  ) => {
    const nextEntry = index < listData.length - 1 ? listData[index + 1] : null;
    const info = getLocalDateInfo(item.timestamp);
    let dayLabel: string | null = null;

    if (info) {
      if (!nextEntry) {
        dayLabel = formatDaySeparatorLabel(info.date);
      } else {
        const nextInfo = getLocalDateInfo(nextEntry.timestamp);
        if (!nextInfo || nextInfo.key !== info.key) {
          dayLabel = formatDaySeparatorLabel(info.date);
        }
      }
    }

    const isSearchMatch = searchMatchSet.has(item.id);
    const isActiveSearchMatch = activeSearchMatchId === item.id;
    if (item.variant === 'wallet') {
      const walletTimestamp = formatWalletSettlementTimestamp(item.walletSettlement?.settledAt ?? item.timestamp);
      const walletLabel = item.walletSettlement?.label || item.text || DEFAULT_WALLET_SETTLEMENT_LABEL;
      return (
        <View style={styles.messageItem}>
          {dayLabel ? (
            <View
              style={[
                styles.daySeparator,
                { backgroundColor: daySeparatorBackground, borderColor: daySeparatorBorder },
              ]}
            >
              <Text style={[styles.daySeparatorText, { color: daySeparatorTextColor }]}>{dayLabel}</Text>
            </View>
          ) : null}
          <View style={styles.walletCardWrapper}>
            <WalletSettlementCard
              label={walletLabel}
              timestamp={walletTimestamp}
              highlightQuery={isSearchMatch ? normalizedSearchQuery : ''}
              highlightActive={isSearchMatch && isActiveSearchMatch}
            />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.messageItem}>
        {dayLabel ? (
          <View
            style={[
              styles.daySeparator,
              { backgroundColor: daySeparatorBackground, borderColor: daySeparatorBorder },
            ]}
          >
            <Text style={[styles.daySeparatorText, { color: daySeparatorTextColor }]}>{dayLabel}</Text>
          </View>
        ) : null}
        <ChatBubble
          text={item.text}
          caption={item.caption}
          time={item.time}
          date={item.date}
          isMine={item.author === 'me'}
          senderName={item.senderName}
          status={item.status}
          deliveredPassively={item.deliveredPassively}
          variant={item.variant}
          transaction={item.transaction}
          attachment={item.attachment}
          highlightQuery={isSearchMatch ? normalizedSearchQuery : ''}
          highlightActive={isSearchMatch && isActiveSearchMatch}
        />
      </View>
    );
  }, [activeSearchMatchId, daySeparatorBackground, daySeparatorBorder, daySeparatorTextColor, listData, normalizedSearchQuery, searchMatchSet]);

  const handleAttachmentPress = useCallback(async () => {
    if (attachmentUploading) {
      return;
    }
    if (!shouldUseBackend || !Number.isFinite(numericConversationId)) {
      setStatusBanner({ kind: 'error', text: 'إرسال المرفقات متاح فقط بعد الاتصال بالخادم.' });
      return;
    }

    let pickedAsset: DocumentPicker.DocumentPickerAsset | null = null;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!result) {
        return;
      }

      const maybeResult = result as unknown as {
        canceled?: boolean;
        assets?: DocumentPicker.DocumentPickerAsset[];
        type?: string;
      };

      if (maybeResult.canceled) {
        return;
      }
      if (Array.isArray(maybeResult.assets) && maybeResult.assets.length > 0) {
        pickedAsset = maybeResult.assets[0] ?? null;
      } else if (maybeResult.type === 'success') {
        pickedAsset = result as unknown as DocumentPicker.DocumentPickerAsset;
      } else if (maybeResult.type === 'cancel') {
        return;
      } else if ((result as unknown as DocumentPicker.DocumentPickerAsset)?.uri) {
        pickedAsset = result as unknown as DocumentPicker.DocumentPickerAsset;
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to open document picker', error);
      setStatusBanner({ kind: 'error', text: 'تعذر فتح مستعرض الملفات.' });
      return;
    }

    if (!pickedAsset) {
      return;
    }

    const effectiveMime = resolveMimeType(pickedAsset.name, pickedAsset.mimeType);
    const isImage = Boolean(effectiveMime && IMAGE_MIME_TYPES.has(effectiveMime));
    const isPdf = effectiveMime === PDF_MIME_TYPE;
    if (!isImage && !isPdf) {
      setStatusBanner({ kind: 'error', text: 'يمكنك إرفاق صور (JPG/PNG/GIF/WEBP) أو ملفات PDF فقط.' });
      return;
    }

    const size = typeof pickedAsset.size === 'number' ? pickedAsset.size : null;
    const sizeLimit = isImage ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
    if (size !== null && size > sizeLimit) {
      const limitLabel = isImage ? '5 ميغابايت' : '10 ميغابايت';
      setStatusBanner({ kind: 'error', text: `يتجاوز حجم الملف الحد الأقصى (${limitLabel}).` });
      return;
    }

    const fileCopyUri = (pickedAsset as { fileCopyUri?: string | null }).fileCopyUri ?? null;

    const uploadAsset: UploadAttachmentAsset = {
      uri: pickedAsset.uri,
      fileCopyUri,
      name: pickedAsset.name || 'attachment',
      mimeType: effectiveMime ?? undefined,
      size,
    };

    const originalDraft = draft;
    const caption = draft.trim();
    const optimisticBody = caption || DEFAULT_ATTACHMENT_PREVIEW;
    const createdAt = new Date().toISOString();
    const optimisticId = -Math.floor(Date.now() + Math.random() * 1000);
    const optimisticMessage: MessageDto = {
      id: optimisticId,
      conversation: numericConversationId,
      sender: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        display_name: currentUser.display_name,
      } : undefined,
      senderType: 'user',
      senderDisplay: currentUser?.display_name || currentUser?.username || 'أنا',
      type: 'text',
      body: optimisticBody,
      created_at: createdAt,
      status: 'sent',
      delivery_status: 0,
      attachment_url: pickedAsset.uri,
      attachment_name: uploadAsset.name ?? null,
      attachment_mime: uploadAsset.mimeType ?? null,
      attachment_size: size,
    };

    if (caption) {
      setDraft('');
    }
    setStatusBanner(null);
    setAttachmentUploading(true);
    myMessageIdsRef.current.add(optimisticId);
    setRemoteMessages((prev) => [...prev, optimisticMessage]);

    const optimisticPreview = caption || uploadAsset.name || DEFAULT_ATTACHMENT_PREVIEW;

    emitConversationPreviewUpdate({
      id: numericConversationId,
      lastMessageAt: createdAt,
      lastActivityAt: createdAt,
      lastMessagePreview: optimisticPreview,
      unreadCount: 0,
    });

    const removeOptimistic = () => {
      myMessageIdsRef.current.delete(optimisticId);
      setRemoteMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
    };

    try {
      const attemptSend = async (otpCode?: string) => sendAttachment(
        numericConversationId,
        uploadAsset,
        caption || undefined,
        otpCode,
      );

      let response: MessageDto | null = null;
      let otpCode: string | null = null;
      let attempts = 0;

      while (response === null) {
        try {
          response = await attemptSend(otpCode ?? undefined);
        } catch (error) {
          if (error instanceof HttpError && error.status === 403 && (error.payload as any)?.otp_required) {
            if (attempts >= OTP_MAX_ATTEMPTS) {
              throw error;
            }
            const detail = extractErrorMessage(error, '');
            const promptMessage = detail && detail.toLowerCase().includes('invalid')
              ? 'الرمز غير صحيح، حاول مرة أخرى.'
              : DEFAULT_OTP_PROMPT_MESSAGE;
            const nextCode = await promptForOtp(promptMessage);
            if (!nextCode) {
              throw new OtpCancelledError();
            }
            otpCode = nextCode;
            attempts += 1;
            continue;
          }
          throw error;
        }
      }

      if (!response) {
        throw new Error('Attachment upload failed without response');
      }

      if (Number.isFinite(response.id)) {
        myMessageIdsRef.current.add(response.id);
      }
      myMessageIdsRef.current.delete(optimisticId);
      setRemoteMessages((prev) => {
        const withoutOptimistic = prev.filter((msg) => msg.id !== optimisticId);
        const withoutDuplicate = withoutOptimistic.filter((msg) => msg.id !== response!.id);
        const normalizedResponse: MessageDto = {
          ...response!,
          delivery_context: resolveDeliveryContext(
            response!.delivery_status,
            response!.status ?? null,
            response!.delivery_context ?? (response!.delivery_status && response!.delivery_status >= 1 ? 'passive' : null),
            undefined,
          ),
        };
        const next = [...withoutDuplicate, normalizedResponse];
        return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });

      const responsePreview = (() => {
        const body = typeof response.body === 'string' ? response.body.trim() : '';
        if (body) {
          return body;
        }
        if (response.attachment_name && response.attachment_name.trim()) {
          return response.attachment_name;
        }
        if (response.attachment_url) {
          return DEFAULT_ATTACHMENT_PREVIEW;
        }
        return optimisticPreview;
      })();

      emitConversationPreviewUpdate({
        id: numericConversationId,
        lastMessageAt: response.created_at,
        lastActivityAt: response.created_at,
        lastMessagePreview: responsePreview,
        unreadCount: 0,
      });

      if (isMountedRef.current) {
        setStatusBanner({ kind: 'success', text: 'تم إرسال المرفق' });
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to send attachment', error);
      removeOptimistic();
      if (caption) {
        setDraft(originalDraft);
      }
      let bannerMessage: string;
      if (error instanceof OtpCancelledError) {
        bannerMessage = 'تم إلغاء الإرسال قبل إدخال رمز التحقق.';
      } else if (error instanceof HttpError && error.status === 403 && (error.payload as any)?.otp_required) {
        const detail = extractErrorMessage(error, '');
        if (detail && detail.toLowerCase().includes('invalid')) {
          bannerMessage = 'رمز التحقق غير صحيح.';
        } else {
          bannerMessage = 'رمز التحقق مطلوب لإرسال المرفق.';
        }
      } else {
        bannerMessage = extractErrorMessage(error, 'تعذر إرسال المرفق');
      }
      setStatusBanner({ kind: 'error', text: bannerMessage });
    } finally {
      if (isMountedRef.current) {
        setAttachmentUploading(false);
      }
    }
  }, [attachmentUploading, shouldUseBackend, numericConversationId, draft, currentUser, promptForOtp]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }

    if (!shouldUseBackend || Number.isNaN(numericConversationId)) {
      const optimistic: MessageDto = {
        id: Number.NEGATIVE_INFINITY,
        conversation: numericConversationId,
        sender: currentUser ? {
          id: currentUser.id,
          username: currentUser.username,
          display_name: currentUser.display_name,
        } : undefined,
        senderType: 'user',
        senderDisplay: currentUser?.display_name || currentUser?.username || 'أنا',
        type: 'text',
        body: text,
        created_at: new Date().toISOString(),
        status: 'sent',
        delivery_status: 0,
      };
      myMessageIdsRef.current.add(optimistic.id);
      setRemoteMessages((prev) => [...prev, optimistic]);
      setDraft('');
      if (Number.isFinite(numericConversationId)) {
        const previewText = optimistic.body && optimistic.body.trim().length ? optimistic.body : 'رسالة جديدة';
        emitConversationPreviewUpdate({
          id: numericConversationId,
          lastMessageAt: optimistic.created_at,
          lastActivityAt: optimistic.created_at,
          lastMessagePreview: previewText,
          unreadCount: 0,
        });
      }
      return;
    }

    const optimisticId = -Math.floor(Date.now() + Math.random() * 1000);
    const optimisticMessage: MessageDto = {
      id: optimisticId,
      conversation: numericConversationId,
      sender: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        display_name: currentUser.display_name,
      } : undefined,
      senderType: 'user',
      senderDisplay: currentUser?.display_name || currentUser?.username || 'أنا',
      type: 'text',
      body: text,
      created_at: new Date().toISOString(),
      status: 'sent',
      delivery_status: 0,
    };

    myMessageIdsRef.current.add(optimisticId);
    setRemoteMessages((prev) => [...prev, optimisticMessage]);
    setDraft('');
    setSendingMessage(true);
    setStatusBanner(null);

    const optimisticPreview = optimisticMessage.body && optimisticMessage.body.trim().length
      ? optimisticMessage.body
      : 'رسالة جديدة';

    emitConversationPreviewUpdate({
      id: numericConversationId,
      lastMessageAt: optimisticMessage.created_at,
      lastActivityAt: optimisticMessage.created_at,
      lastMessagePreview: optimisticPreview,
      unreadCount: 0,
    });

    try {
      const response = await sendMessage(numericConversationId, text);
      if (Number.isFinite(response.id)) {
        myMessageIdsRef.current.add(response.id);
      }
      myMessageIdsRef.current.delete(optimisticId);
      setRemoteMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== optimisticId);
        const withoutDuplicate = filtered.filter((msg) => msg.id !== response.id);
        const normalizedResponse: MessageDto = {
          ...response,
          delivery_context: resolveDeliveryContext(
            response.delivery_status,
            response.status ?? null,
            response.delivery_context ?? (response.delivery_status && response.delivery_status >= 1 ? 'passive' : null),
            undefined,
          ),
        };
        const next = [...withoutDuplicate, normalizedResponse];
        return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });

      const responsePreview = typeof response.body === 'string' && response.body.trim().length
        ? response.body
        : optimisticPreview;
      emitConversationPreviewUpdate({
        id: numericConversationId,
        lastMessageAt: response.created_at,
        lastActivityAt: response.created_at,
        lastMessagePreview: responsePreview,
        unreadCount: 0,
      });
    } catch (error) {
      setRemoteMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
      myMessageIdsRef.current.delete(optimisticId);
      setDraft(text);
      const message = extractErrorMessage(error, 'تعذر إرسال الرسالة');
      if (error instanceof HttpError && error.status === 403 && (error.payload as any)?.otp_required) {
        Alert.alert('رمز التحقق مطلوب', 'الرجاء إدخال رمز OTP من تطبيق المصادقة ثم إعادة المحاولة.');
      } else {
        Alert.alert('تعذر إرسال الرسالة', message);
      }
    } finally {
      if (isMountedRef.current) {
        setSendingMessage(false);
      }
    }
  }, [currentUser, draft, numericConversationId, shouldUseBackend]);

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <View style={[styles.screen, { backgroundColor: tokens.background }]}> 
            <View
              style={[styles.headerContainer, { backgroundColor: headerBackground, borderColor: headerBorderColor }]}
            >
              <View style={styles.headerRow}>
                <Pressable
                  onPress={() => navigation.goBack()}
                  accessibilityLabel="رجوع"
                  style={[styles.headerButton, actionBaseStyle]}
                >
                  <FeatherIcon name="arrow-right" size={18} color={headerIconColor} />
                </Pressable>
                <View style={styles.contactInfo}>
                  <View style={[styles.avatar, actionBaseStyle]}>
                    {remoteAvatar ? (
                      <Image source={{ uri: remoteAvatar }} style={styles.avatarImage} />
                    ) : (
                      <FeatherIcon name="user" size={20} color={headerIconColor} />
                    )}
                  </View>
                  <Text
                    style={[styles.contactName, { color: headerPrimaryText }]}
                    numberOfLines={1}
                  >
                    {headerTitle}
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <Pressable
                    accessibilityLabel="المزيد من الخيارات"
                    onPress={handleToggleActionsMenu}
                    style={[
                      styles.actionButton,
                      actionBaseStyle,
                      actionsMenuTriggerActive && {
                        backgroundColor: actionsMenuTriggerActiveBackground,
                        borderColor: actionsMenuTriggerActiveBorder,
                      },
                    ]}
                  >
                    <FeatherIcon
                      name="more-vertical"
                      size={18}
                      color={actionsMenuTriggerActive ? actionsMenuTriggerActiveIcon : headerIconColor}
                    />
                  </Pressable>
                </View>
              </View>

              <Modal
                visible={actionsMenuVisible}
                transparent
                animationType="fade"
                onRequestClose={closeActionsMenu}
              >
                <TouchableWithoutFeedback onPress={closeActionsMenu}>
                  <View style={styles.actionsMenuOverlay}>
                    <View
                      style={[
                        styles.actionsMenuContainer,
                        { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder },
                      ]}
                      onStartShouldSetResponder={() => true}
                    >
                      <Pressable
                        accessibilityLabel="فلترة المعاملات"
                        onPress={handleSelectFilterAction}
                        style={[
                          styles.actionsMenuItem,
                          { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder },
                          showTransactionsOnly && {
                            backgroundColor: filterActiveBackground,
                            borderColor: filterActiveBorder,
                          },
                        ]}
                      >
                        <FeatherIcon
                          name="sliders"
                          size={18}
                          color={showTransactionsOnly ? filterActiveIcon : headerIconColor}
                        />
                        <Text
                          style={[
                            styles.actionsMenuLabel,
                            { color: showTransactionsOnly ? filterActiveIcon : headerPrimaryText },
                          ]}
                        >
                          فلترة المعاملات
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="أعضاء المحادثة"
                        onPress={handleSelectMembersAction}
                        style={[
                          styles.actionsMenuItem,
                          { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder },
                          membersModalVisible && {
                            backgroundColor: membersActiveBackground,
                            borderColor: membersActiveBorder,
                          },
                        ]}
                      >
                        <FeatherIcon
                          name="users"
                          size={18}
                          color={membersModalVisible ? membersActiveIcon : headerIconColor}
                        />
                        <Text
                          style={[
                            styles.actionsMenuLabel,
                            { color: membersModalVisible ? membersActiveIcon : headerPrimaryText },
                          ]}
                        >
                          أعضاء المحادثة
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="تصدير المحادثة"
                        onPress={handleSelectExportAction}
                        style={[
                          styles.actionsMenuItem,
                          { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder },
                          exportModalVisible && {
                            backgroundColor: exportActiveBackground,
                            borderColor: exportActiveBorder,
                          },
                        ]}
                      >
                        <FeatherIcon
                          name="download"
                          size={18}
                          color={exportModalVisible ? exportActiveIcon : headerIconColor}
                        />
                        <Text
                          style={[
                            styles.actionsMenuLabel,
                            { color: exportModalVisible ? exportActiveIcon : headerPrimaryText },
                          ]}
                        >
                          تصدير
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="بحث داخل المحادثة"
                        onPress={handleSelectSearchAction}
                        style={[
                          styles.actionsMenuItem,
                          { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder },
                          searchOpen && {
                            backgroundColor: searchActiveBackground,
                            borderColor: searchActiveBorder,
                          },
                        ]}
                      >
                        <FeatherIcon
                          name="search"
                          size={18}
                          color={searchOpen ? searchActiveIcon : headerIconColor}
                        />
                        <Text
                          style={[
                            styles.actionsMenuLabel,
                            { color: searchOpen ? searchActiveIcon : headerPrimaryText },
                          ]}
                        >
                          بحث داخل المحادثة
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </Modal>

              <Modal
                visible={exportModalVisible}
                transparent
                animationType="fade"
                onRequestClose={closeExportModal}
              >
                <Pressable style={styles.modalOverlay} onPress={closeExportModal}>
                  <View
                    style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
                    onStartShouldSetResponder={() => true}
                  >
                    <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>
                      {`سجل المعاملات المالية بين ${viewerDisplayName} و ${peerDisplayName}`}
                    </Text>
                    <Text style={[styles.exportSubtitle, { color: tokens.textMuted }]}>
                      سيتم تصدير المعاملات المالية بين التاريخين المحددين فقط
                    </Text>
                    <View style={styles.exportInputsRow}>
                      <View style={styles.exportFieldGroup}>
                        <Text style={[styles.exportLabel, { color: tokens.textMuted }]}>من تاريخ</Text>
                        <TextInput
                          value={exportDateFrom}
                          onChangeText={(value) => {
                            setExportDateFrom(value);
                            setExportError(null);
                          }}
                          editable={!exportBusy}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={tokens.textMuted}
                          keyboardType="numbers-and-punctuation"
                          textAlign="right"
                          style={[
                            styles.exportInput,
                            {
                              color: tokens.textPrimary,
                              borderColor: tokens.divider,
                              backgroundColor: tokens.panelAlt,
                            },
                          ]}
                        />
                      </View>
                      <View style={styles.exportFieldGroup}>
                        <Text style={[styles.exportLabel, { color: tokens.textMuted }]}>إلى تاريخ</Text>
                        <TextInput
                          value={exportDateTo}
                          onChangeText={(value) => {
                            setExportDateTo(value);
                            setExportError(null);
                          }}
                          editable={!exportBusy}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={tokens.textMuted}
                          keyboardType="numbers-and-punctuation"
                          textAlign="right"
                          style={[
                            styles.exportInput,
                            {
                              color: tokens.textPrimary,
                              borderColor: tokens.divider,
                              backgroundColor: tokens.panelAlt,
                            },
                          ]}
                        />
                      </View>
                    </View>
                    <View style={styles.exportFormatGroup}>
                      <Text style={[styles.exportLabel, { color: tokens.textMuted }]}>صيغة الملف</Text>
                      <View style={styles.exportRadioRow}>
                        <Pressable
                          style={[
                            styles.exportRadioOption,
                            { borderColor: tokens.divider, backgroundColor: tokens.panelAlt },
                            exportFormat === 'excel' && styles.exportRadioOptionExcelActive,
                            exportBusy && styles.modalButtonDisabled,
                          ]}
                          onPress={() => {
                            if (!exportBusy) {
                              setExportFormat('excel');
                              setExportError(null);
                            }
                          }}
                          disabled={exportBusy}
                        >
                          <FeatherIcon
                            name={exportFormat === 'excel' ? 'check-circle' : 'circle'}
                            size={16}
                            color={exportFormat === 'excel' ? '#22c55e' : tokens.textMuted}
                          />
                          <Text
                            style={[
                              styles.exportRadioText,
                              { color: exportFormat === 'excel' ? '#16a34a' : tokens.textPrimary },
                            ]}
                          >
                            Excel
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.exportRadioOption,
                            { borderColor: tokens.divider, backgroundColor: tokens.panelAlt },
                            exportFormat === 'pdf' && styles.exportRadioOptionPdfActive,
                            exportBusy && styles.modalButtonDisabled,
                          ]}
                          onPress={() => {
                            if (!exportBusy) {
                              setExportFormat('pdf');
                              setExportError(null);
                            }
                          }}
                          disabled={exportBusy}
                        >
                          <FeatherIcon
                            name={exportFormat === 'pdf' ? 'check-circle' : 'circle'}
                            size={16}
                            color={exportFormat === 'pdf' ? '#3b82f6' : tokens.textMuted}
                          />
                          <Text
                            style={[
                              styles.exportRadioText,
                              { color: exportFormat === 'pdf' ? '#2563eb' : tokens.textPrimary },
                            ]}
                          >
                            PDF
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    {exportError ? (
                      <View
                        style={[
                          styles.exportErrorBox,
                          { borderColor: '#fda4af', backgroundColor: 'rgba(248, 113, 113, 0.12)' },
                        ]}
                      >
                        <Text style={[styles.exportErrorText, { color: '#b91c1c' }]}>{exportError}</Text>
                      </View>
                    ) : null}
                    <View style={styles.modalActions}>
                      <Pressable
                        style={[
                          styles.modalButton,
                          styles.modalButtonSecondary,
                          { borderColor: tokens.divider },
                          exportBusy && styles.modalButtonDisabled,
                        ]}
                        onPress={closeExportModal}
                        disabled={exportBusy}
                      >
                        <Text style={[styles.modalButtonTextSecondary, { color: tokens.textPrimary }]}>إلغاء</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.modalButton,
                          styles.modalButtonPrimary,
                          exportBusy && styles.modalButtonDisabled,
                        ]}
                        onPress={handleConfirmExport}
                        disabled={exportBusy}
                      >
                        <Text style={styles.modalButtonTextPrimary}>
                          {exportBusy ? 'جارٍ التصدير…' : 'موافق'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              </Modal>

              {searchOpen ? (
                <View
                  style={[styles.searchBar, { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder }]}
                >
                  <FeatherIcon name="search" size={16} color={headerIconColor} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="ابحث داخل هذه المحادثة"
                    placeholderTextColor={headerSecondaryText}
                    style={[styles.searchInput, { color: headerPrimaryText }]}
                    textAlign="right"
                  />
                  {hasSearchResults ? (
                    <View style={styles.searchNavControls}>
                      <Text style={[styles.searchNavCounter, { color: headerSecondaryText }]}>
                        {searchResultPosition}/{searchMatches.length}
                      </Text>
                      {showSearchNavigation ? (
                        <>
                          <Pressable
                            accessibilityLabel="النتيجة السابقة"
                            onPress={goToPreviousSearchMatch}
                            hitSlop={8}
                            style={[styles.searchNavButton, { borderColor: headerButtonBorder, backgroundColor: headerButtonBackground }]}
                          >
                            <FeatherIcon name="chevron-up" size={14} color={headerIconColor} />
                          </Pressable>
                          <Pressable
                            accessibilityLabel="النتيجة التالية"
                            onPress={goToNextSearchMatch}
                            hitSlop={8}
                            style={[styles.searchNavButton, { borderColor: headerButtonBorder, backgroundColor: headerButtonBackground }]}
                          >
                            <FeatherIcon name="chevron-down" size={14} color={headerIconColor} />
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ) : normalizedSearchQuery ? (
                    <Text style={[styles.searchNavCounter, { color: headerSecondaryText }]}>لا نتائج</Text>
                  ) : null}
                </View>
              ) : null}

              {showBalancesRow ? (
                <View style={styles.balanceRow}>
                  {balances.length > 0 ? (
                    balances.map(renderBalanceChip)
                  ) : (
                    <View style={[styles.balanceChip, styles.balancePlaceholder]}>
                      <Text style={styles.balancePlaceholderText}>الرصيد غير متاح حالياً</Text>
                    </View>
                  )}
                </View>
              ) : null}

              {pendingDeleteRequest && !currentUser?.is_team_member ? (
                <View
                  style={[styles.deleteBanner, { backgroundColor: deleteBannerBackground, borderColor: deleteBannerBorder }]}
                >
                  <Text style={[styles.deleteBannerTitle, { color: deleteBannerTitleColor }]}>
                    {deleteRequestIsMine
                      ? 'تم إرسال طلب حذف جهة الاتصال.'
                      : `${deleteRequesterName || 'الطرف الآخر'} طلب حذف جهة الاتصال.`}
                  </Text>
                  <Text style={[styles.deleteBannerSubtitle, { color: deleteBannerSubtitleColor }]}>
                    سيتم حذف المطابقة المالية بين الطرفين بمجرد الموافقة.
                  </Text>
                  {deleteRequestTimestampLabel ? (
                    <Text style={[styles.deleteBannerInfo, { color: deleteBannerInfoColor }]}>
                      {`التوقيت: ${deleteRequestTimestampLabel}`}
                    </Text>
                  ) : null}
                  {deleteRequestIsMine ? (
                    <Text style={[styles.deleteBannerInfo, { color: deleteBannerInfoColor }]}>
                      بانتظار موافقة الطرف الآخر على الطلب.
                    </Text>
                  ) : (
                    <View style={styles.deleteBannerActions}>
                      <Pressable
                        style={[
                          styles.deleteBannerButton,
                          { backgroundColor: deleteApproveBackground, borderColor: deleteApproveBorder },
                          deleteRequestBusy ? { opacity: 0.7 } : null,
                        ]}
                        accessibilityLabel="الموافقة على حذف جهة الاتصال"
                        onPress={handleApproveDeleteRequest}
                        disabled={deleteRequestBusy !== null}
                      >
                        {deleteRequestBusy === 'approve' ? (
                          <ActivityIndicator size="small" color={deleteApproveText} />
                        ) : (
                          <Text style={[styles.deleteBannerButtonText, { color: deleteApproveText }]}>موافقة</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[
                          styles.deleteBannerButton,
                          { backgroundColor: deleteDeclineBackground, borderColor: deleteDeclineBorder },
                          deleteRequestBusy ? { opacity: 0.7 } : null,
                        ]}
                        accessibilityLabel="رفض طلب حذف جهة الاتصال"
                        onPress={handleDeclineDeleteRequest}
                        disabled={deleteRequestBusy !== null}
                      >
                        {deleteRequestBusy === 'decline' ? (
                          <ActivityIndicator size="small" color={deleteDeclineText} />
                        ) : (
                          <Text style={[styles.deleteBannerButtonText, { color: deleteDeclineText }]}>رفض</Text>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : null}
            </View>

            {errorMessage ? (
              <View style={[styles.errorBanner, { backgroundColor: isLight ? '#fee2e2' : '#7f1d1d' }]}
              >
                <Text style={{ color: isLight ? '#991b1b' : '#fecdd3', fontSize: 12, textAlign: 'center', fontWeight: '600' }}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            <View style={styles.listWrapper}>
              <FlatList<NormalizedMessage>
                ref={listRef}
                data={listData}
                inverted
                maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 20 }}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderMessage}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingTop: 8, paddingBottom: composerHeight + 12 },
                ]}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={renderEmpty}
                refreshing={shouldUseBackend ? loadingMessages : false}
                onRefresh={loadConversationData}
                onScroll={handleListScroll}
                scrollEventThrottle={16}
                onScrollToIndexFailed={({ index }) => {
                  requestAnimationFrame(() => {
                    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                  });
                }}
              />
              {showJumpToLatest ? (
                <Pressable
                  style={[
                    styles.jumpToLatestButton,
                    {
                      backgroundColor: headerButtonBackground,
                      borderColor: headerButtonBorder,
                      bottom: composerHeight + 24,
                    },
                  ]}
                  onPress={handleJumpToLatest}
                  hitSlop={10}
                >
                  <Text style={[styles.jumpToLatestText, { color: headerPrimaryText }]}>⬇️</Text>
                </Pressable>
              ) : null}
            </View>

            <View
              style={[styles.composer, { backgroundColor: composerBackground, borderColor: tokens.divider }]}
              onLayout={(event) => {
                const height = event?.nativeEvent?.layout?.height;
                if (!Number.isFinite(height)) {
                  return;
                }
                setComposerHeight((prev) => (Math.abs(prev - height) > 0.5 ? height : prev));
              }}
            > 
              {statusBanner ? (
                <View
                  style={[
                    styles.statusBanner,
                    statusBanner.kind === 'success'
                      ? { backgroundColor: isLight ? '#dcfce7' : '#14532d', borderColor: isLight ? '#34d399' : '#22c55e' }
                      : { backgroundColor: isLight ? '#fee2e2' : '#7f1d1d', borderColor: isLight ? '#f87171' : '#fda4af' },
                  ]}
                >
                  <FeatherIcon
                    name={statusBanner.kind === 'success' ? 'check-circle' : 'alert-circle'}
                    size={16}
                    color={statusBanner.kind === 'success' ? (isLight ? '#166534' : '#bbf7d0') : (isLight ? '#b91c1c' : '#fecdd3')}
                  />
                  <Text
                    style={[
                      styles.statusBannerText,
                      { color: statusBanner.kind === 'success' ? (isLight ? '#166534' : '#bbf7d0') : (isLight ? '#b91c1c' : '#fecdd3') },
                    ]}
                  >
                    {statusBanner.text}
                  </Text>
                  <Pressable hitSlop={10} onPress={() => setStatusBanner(null)}>
                    <FeatherIcon name="x" size={14} color={isLight ? '#525252' : '#e2e8f0'} />
                  </Pressable>
                </View>
              ) : null}

              {!hideFinancialTools ? (
                <View style={styles.transactionRow}>
                  <Pressable
                    style={[styles.transactionIconButton, styles.transactionSend, transactionLoading && { opacity: 0.6 }]}
                    accessibilityLabel="حفظ المعاملة"
                    onPress={handleSaveTransaction}
                    disabled={transactionLoading}
                  >
                    {transactionLoading ? (
                      <ActivityIndicator size="small" color="#047857" />
                    ) : (
                      <FeatherIcon name="send" size={16} color="#047857" />
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.transactionIconButton, styles.transactionNote, note ? { borderWidth: 2, borderColor: '#f97316' } : null]}
                    accessibilityLabel="إضافة ملاحظة"
                    onPress={() => setNoteModalVisible(true)}
                  >
                    <FeatherIcon name="edit-3" size={16} color={isLight ? '#92400e' : '#facc15'} />
                  </Pressable>
                  <TextInput
                    value={theirShare}
                    onChangeText={setTheirShare}
                    placeholder="لكم"
                    placeholderTextColor={composerPlaceholderColor}
                    style={[styles.transactionInput, { color: tokens.textPrimary, borderColor: composerInputBorder, backgroundColor: composerInputBackground }]}
                    textAlign="center"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    value={ourShare}
                    onChangeText={setOurShare}
                    placeholder="لنا"
                    placeholderTextColor={composerPlaceholderColor}
                    style={[styles.transactionInput, { color: tokens.textPrimary, borderColor: composerInputBorder, backgroundColor: composerInputBackground }]}
                    textAlign="center"
                    keyboardType="decimal-pad"
                  />
                  <Pressable
                    style={[styles.currencySelector, { borderColor: composerInputBorder, backgroundColor: composerButtonBackground }]}
                    accessibilityLabel="تغيير العملة"
                    onPress={() => setCurrencyPickerVisible(true)}
                  >
                    <Text style={[styles.currencyText, { color: tokens.textPrimary }]}>
                      {selectedCurrencyOption?.name || selectedCurrency}
                    </Text>
                    <FeatherIcon name="chevron-down" size={16} color={headerSecondaryText} />
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.messageRow}>
                <View style={styles.messageActions}>
                  <Pressable
                    accessibilityLabel="إرفاق ملف"
                    onPress={handleAttachmentPress}
                    disabled={attachmentUploading}
                    style={[
                      styles.composerButton,
                      { backgroundColor: composerButtonBackground, borderColor: composerButtonBorder },
                      attachmentUploading && { opacity: 0.6 },
                    ]}
                  >
                    {attachmentUploading ? (
                      <ActivityIndicator size="small" color={headerIconColor} />
                    ) : (
                      <FeatherIcon name="paperclip" size={18} color={headerIconColor} />
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityLabel="إضافة رمز تعبيري"
                    onPress={() => setEmojiPickerVisible((prev) => !prev)}
                    style={[styles.composerButton, { backgroundColor: composerButtonBackground, borderColor: composerButtonBorder }]}
                  >
                    <Text style={{ fontSize: 18 }}>😊</Text>
                  </Pressable>
                </View>
                <View style={styles.messageFieldArea}>
                  <View
                    style={[
                      styles.composerInputWrapper,
                      {
                        backgroundColor: composerInputBackground,
                        borderColor: composerInputBorder,
                        minHeight: composerMinWrapperHeight,
                        maxHeight: composerMaxWrapperHeight,
                        height: composerWrapperHeight,
                      },
                    ]}
                  >
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="اكتب رسالة"
                      placeholderTextColor={composerPlaceholderColor}
                      multiline
                      onContentSizeChange={handleComposerContentSizeChange}
                      scrollEnabled={composerReachedMaxLines}
                      style={[
                        styles.composerInput,
                        {
                          color: tokens.textPrimary,
                          height: composerContentHeight,
                          maxHeight: composerMaxContentHeight,
                        },
                      ]}
                      textAlign="right"
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="إرسال الرسالة"
                  onPress={handleSend}
                  disabled={sendingMessage || !draft.trim()}
                  style={[
                    styles.sendButton,
                    { backgroundColor: '#f97316', opacity: sendingMessage || !draft.trim() ? 0.7 : 1 },
                  ]}
                >
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#fff7ed" />
                  ) : (
                    <FeatherIcon name="send" size={18} color="#fff7ed" />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={membersModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMembersModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMembersModalVisible(false)}>
          <View
            style={[styles.membersModalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.membersModalHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق نافذة الأعضاء"
                onPress={() => setMembersModalVisible(false)}
                style={[styles.membersCloseButton, { borderColor: tokens.divider, backgroundColor: headerButtonBackground }]}
              >
                <FeatherIcon name="x" size={16} color={tokens.textPrimary} />
              </Pressable>
              <Text style={[styles.membersModalTitle, { color: tokens.textPrimary }]}>أعضاء المحادثة</Text>
              {membersBusy && !membersLoading ? (
                <ActivityIndicator size="small" color="#f97316" style={styles.membersBusyIndicator} />
              ) : (
                <View style={styles.membersBusyPlaceholder} />
              )}
            </View>

            {membersLoading ? (
              <View style={styles.membersLoadingState}>
                <ActivityIndicator size="small" color="#f97316" />
                <Text style={[styles.membersLoadingText, { color: tokens.textMuted }]}>جارٍ تحميل الأعضاء…</Text>
              </View>
            ) : membersError ? (
              <View style={styles.membersErrorContainer}>
                <Text style={[styles.membersErrorText, { color: tokens.textPrimary }]}>{membersError}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="إعادة تحميل أعضاء المحادثة"
                  onPress={loadMembersPanelData}
                  style={[styles.membersRetryButton, { borderColor: headerButtonBorder, backgroundColor: headerButtonBackground }]}
                >
                  <Text style={[styles.membersRetryText, { color: headerPrimaryText }]}>إعادة المحاولة</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                style={styles.membersScroll}
                contentContainerStyle={styles.membersScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.membersSection}>
                  <Text style={[styles.membersSectionHeader, { color: membersSectionHeaderColor }]}>المضافون حالياً</Text>
                  {sortedConversationMembers.length === 0 ? (
                    <Text style={[styles.membersEmptyText, { color: tokens.textMuted }]}>لا يوجد أعضاء بعد.</Text>
                  ) : (
                    sortedConversationMembers.map((member) => {
                      const canRemoveMember = canManageMembers && member.role !== 'participant';
                      return (
                        <View
                          key={`${member.memberType}-${member.memberId}`}
                          style={[styles.memberEntry, { borderColor: tokens.divider, backgroundColor: membersCardBackground }]}
                        >
                          <View style={styles.memberInfo}>
                            <View style={[styles.memberAvatar, { backgroundColor: membersAvatarBackground, borderColor: membersAvatarBorder }]}> 
                              <Text style={[styles.memberAvatarText, { color: headerPrimaryText }]}>
                                {getInitials(member.displayName || member.username)}
                              </Text>
                            </View>
                            <View style={styles.memberTextGroup}>
                              <Text style={[styles.memberName, { color: tokens.textPrimary }]} numberOfLines={1}>
                                {member.displayName || member.username}
                              </Text>
                              <Text style={[styles.memberRole, { color: membersRoleColor }]}>
                                {formatMemberRole(member.role)}
                              </Text>
                            </View>
                          </View>
                          {canRemoveMember ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`إزالة ${member.displayName || member.username} من المحادثة`}
                              onPress={() => handleRemoveConversationMember(member)}
                              disabled={membersBusy}
                              style={[styles.memberActionButton, styles.memberRemoveButton, membersBusy && styles.memberActionButtonDisabled]}
                            >
                              <Text style={[styles.memberActionText, styles.memberRemoveText]}>إزالة</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>

                {canManageMembers ? (
                  <View style={styles.membersSection}>
                    <Text style={[styles.membersSectionHeader, { color: membersSectionHeaderColor }]}>كل أعضاء الفريق</Text>
                    {sortedTeamMembers.length === 0 ? (
                      <Text style={[styles.membersEmptyText, { color: tokens.textMuted }]}>لا يوجد أعضاء فريق حالياً.</Text>
                    ) : (
                      sortedTeamMembers.map((teamMember) => {
                        const alreadyMember = teamMemberIdsInConversation.has(teamMember.id);
                        return (
                          <View
                            key={`team-${teamMember.id}`}
                            style={[styles.memberEntry, { borderColor: tokens.divider, backgroundColor: membersCardBackground }]}
                          >
                            <View style={styles.memberInfo}>
                              <View style={[styles.memberAvatar, { backgroundColor: membersAvatarBackground, borderColor: membersAvatarBorder }]}> 
                                <Text style={[styles.memberAvatarText, { color: headerPrimaryText }]}>
                                  {getInitials(teamMember.display_name || teamMember.username)}
                                </Text>
                              </View>
                              <View style={styles.memberTextGroup}>
                                <Text style={[styles.memberName, { color: tokens.textPrimary }]} numberOfLines={1}>
                                  {teamMember.display_name || teamMember.username}
                                </Text>
                                <Text style={[styles.memberRole, { color: tokens.textMuted }]}>
                                  @{teamMember.username}
                                </Text>
                              </View>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={alreadyMember ? `${teamMember.display_name || teamMember.username} مضاف إلى المحادثة` : `إضافة ${teamMember.display_name || teamMember.username} إلى المحادثة`}
                              onPress={() => handleAddTeamMember(teamMember)}
                              disabled={alreadyMember || membersBusy}
                              style={[
                                styles.memberActionButton,
                                styles.memberAddButton,
                                (alreadyMember || membersBusy) && styles.memberActionButtonDisabled,
                              ]}
                            >
                              <Text style={[styles.memberActionText, styles.memberAddText]}>
                                {alreadyMember ? 'مضاف' : 'إضافة +'}
                              </Text>
                            </Pressable>
                          </View>
                        );
                      })
                    )}
                  </View>
                ) : (
                  <Text style={[styles.membersHintText, { color: tokens.textMuted }]}>يمكنك الاطلاع على الأعضاء الحاليين فقط.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={emojiPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEmojiPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEmojiPickerVisible(false)}>
          <View
            style={[styles.emojiPanel, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>اختر رمزاً تعبيرياً</Text>
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.emojiGrid}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {(customEmojis.length > 0 ? customEmojis : EMOJI_PALETTE).map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.emojiButton}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    handleInsertEmoji(emoji);
                  }}
                >
                  <Text style={styles.emojiChar}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={currencyPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCurrencyPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCurrencyPickerVisible(false)}>
          <View
            style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>اختر العملة</Text>
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.modalListContent}
              keyboardShouldPersistTaps="handled"
            >
              {currencyOptions.length === 0 ? (
                <Text style={[styles.modalEmptyText, { color: tokens.textMuted }]}>لا توجد عملات متاحة حالياً.</Text>
              ) : (
                currencyOptions.map((option) => {
                  const isActive = option.code === selectedCurrency;
                  return (
                    <Pressable
                      key={option.id ?? option.code}
                      style={[styles.modalOption, isActive && styles.modalOptionActive]}
                      onPress={() => {
                        setSelectedCurrency(option.code);
                        setCurrencyPickerVisible(false);
                      }}
                    >
                      <Text style={[styles.modalOptionText, { color: tokens.textPrimary }]}>
                        {option.name || option.code}
                      </Text>
                      <Text style={[styles.modalOptionSymbol, { color: tokens.textMuted }]}>
                        {option.symbol || option.code}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={otpPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={handleOtpPromptCancel}
      >
        <Pressable style={styles.modalOverlay} onPress={handleOtpPromptCancel}>
          <View
            style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>رمز التحقق</Text>
            <Text style={[styles.otpPromptText, { color: tokens.textMuted }]}>{otpPromptMessage}</Text>
            <TextInput
              value={otpCodeInput}
              onChangeText={handleOtpInputChange}
              placeholder="••••••"
              placeholderTextColor={tokens.textMuted}
              style={[styles.otpInput, { color: tokens.textPrimary, borderColor: tokens.divider, backgroundColor: composerInputBackground }]}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={6}
              onSubmitEditing={handleOtpPromptSubmit}
              textAlign="center"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={handleOtpPromptCancel}
              >
                <Text style={[styles.modalButtonTextSecondary, { color: tokens.textPrimary }]}>إلغاء</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  (otpCodeInput.trim().length !== 6) && styles.modalButtonDisabled,
                ]}
                onPress={handleOtpPromptSubmit}
                disabled={otpCodeInput.trim().length !== 6}
              >
                <Text style={styles.modalButtonTextPrimary}>تأكيد</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={noteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNoteModalVisible(false)}>
          <View
            style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>ملاحظة للمعاملة</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="أدخل ملاحظة اختيارية"
              placeholderTextColor={tokens.textMuted}
              style={[styles.noteInput, { color: tokens.textPrimary, borderColor: tokens.divider, backgroundColor: composerInputBackground }]}
              multiline
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, styles.modalButtonSecondary]} onPress={() => setNoteModalVisible(false)}>
                <Text style={[styles.modalButtonTextSecondary, { color: tokens.textPrimary }]}>إلغاء</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalButtonPrimary]} onPress={() => setNoteModalVisible(false)}>
                <Text style={styles.modalButtonTextPrimary}>حفظ</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  contactInfo: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: 8,
    marginHorizontal: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginStart: 'auto',
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginStart: 8,
  },
  actionsMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 64,
    paddingStart: 150,
    paddingEnd: 16,
  },
  actionsMenuContainer: {
    minWidth: 210,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    rowGap: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  actionsMenuItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    columnGap: 10,
  },
  actionsMenuLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 16,
    columnGap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    marginStart: 10,
  },
  searchNavControls: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    marginStart: 8,
  },
  searchNavButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchNavCounter: {
    fontSize: 11,
    fontWeight: '600',
  },
  balanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  balanceChip: {
    marginStart: 16,
    marginBottom: 8,
  },
  balancePlaceholder: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  balancePlaceholderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b45309',
  },
  balanceText: {
    fontSize: 12,
    fontWeight: '700',
  },
  balanceCurrency: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBanner: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    rowGap: 6,
  },
  deleteBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  deleteBannerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  deleteBannerInfo: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    lineHeight: 18,
  },
  deleteBannerActions: {
    flexDirection: 'row-reverse',
    columnGap: 12,
    marginTop: 4,
  },
  deleteBannerButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 18,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBannerButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listWrapper: {
    flex: 1,
    position: 'relative',
  },
  listContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  daySeparator: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginBottom: 16,
    borderWidth: 1,
  },
  messageItem: {
    marginBottom: 16,
  },
  walletCardWrapper: {
    alignItems: 'center',
  },
  jumpToLatestButton: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  jumpToLatestText: {
    fontSize: 18,
  },
  daySeparatorText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 13,
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    rowGap: 12,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  composerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'flex-start',
  },
  composerInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    minHeight: 32,
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    columnGap: 12,
  },
  transactionIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionSend: {
    backgroundColor: '#d1fae5',
  },
  transactionNote: {
    backgroundColor: '#fef3c7',
  },
  transactionInput: {
    width: 88,
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 42,
    columnGap: 6,
  },
  currencyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
  },
  messageFieldArea: {
    flex: 1,
  },
  messageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    rowGap: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  exportSubtitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  exportInputsRow: {
    width: '100%',
    rowGap: 12,
  },
  exportFieldGroup: {
    width: '100%',
    rowGap: 6,
  },
  exportLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  exportInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  exportFormatGroup: {
    width: '100%',
    rowGap: 10,
  },
  exportRadioRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    columnGap: 12,
  },
  exportRadioOption: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    columnGap: 8,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  exportRadioOptionExcelActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  exportRadioOptionPdfActive: {
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  exportRadioText: {
    fontSize: 13,
    fontWeight: '600',
  },
  exportErrorBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  exportErrorText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '600',
  },
  otpPromptText: {
    fontSize: 13,
    textAlign: 'right',
    lineHeight: 20,
  },
  modalList: {
    maxHeight: 320,
    rowGap: 8,
  },
  modalListContent: {
    rowGap: 8,
    paddingVertical: 4,
  },
  modalEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  modalOption: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalOptionActive: {
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  modalOptionSymbol: {
    fontSize: 12,
    fontWeight: '500',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  otpInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
  },
  emojiPanel: {
    width: '90%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  emojiGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingVertical: 8,
  },
  emojiButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    marginHorizontal: 6,
    marginVertical: 6,
  },
  emojiChar: {
    fontSize: 26,
  },
  membersModalCard: {
    width: '92%',
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  membersModalHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  membersModalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    marginHorizontal: 12,
  },
  membersCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membersBusyIndicator: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membersBusyPlaceholder: {
    width: 32,
    height: 32,
  },
  membersLoadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    rowGap: 12,
  },
  membersLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  membersErrorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 12,
    paddingVertical: 16,
  },
  membersErrorText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  membersRetryButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  membersRetryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  membersScroll: {
    maxHeight: 400,
  },
  membersScrollContent: {
    paddingBottom: 8,
    rowGap: 18,
  },
  membersSection: {
    rowGap: 10,
  },
  membersSectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  membersEmptyText: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 18,
  },
  memberEntry: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  memberInfo: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    columnGap: 12,
    flexShrink: 1,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  memberAvatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  memberTextGroup: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  memberRole: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'right',
  },
  memberActionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  memberActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  memberRemoveButton: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  memberRemoveText: {
    color: '#b91c1c',
  },
  memberAddButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.45)',
  },
  memberAddText: {
    color: '#047857',
  },
  memberActionButtonDisabled: {
    opacity: 0.6,
  },
  membersHintText: {
    fontSize: 12,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    columnGap: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    borderWidth: 1,
  },
  modalButtonPrimary: {
    backgroundColor: '#f97316',
  },
  modalButtonTextSecondary: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalButtonTextPrimary: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff7ed',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
});
