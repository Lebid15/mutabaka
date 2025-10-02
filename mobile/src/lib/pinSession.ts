import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';
import { setUnlockedTokens, clearAuthTokens, type AuthTokens } from './authStorage';

const META_KEY = '@mutabaka/pin/meta';
const PIN_RECORD_KEY = 'mutabaka_pin_record';
const SESSION_RECORD_KEY = 'mutabaka_pin_session';

const SECURE_STORE_FALLBACK_PREFIX = '@mutabaka/securestore/fallback/';
let secureStoreStatus: 'unknown' | 'available' | 'missing' = 'unknown';
let secureStoreFallbackWarned = false;
const isDevBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

const makeFallbackKey = (key: string) => `${SECURE_STORE_FALLBACK_PREFIX}${key}`;

function isSecureStoreUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { message?: unknown; code?: unknown; name?: unknown };
  const message = typeof err.message === 'string' ? err.message : '';
  const code = typeof err.code === 'string' ? err.code : '';
  const name = typeof err.name === 'string' ? err.name : '';
  return (
    code === 'ERR_UNAVAILABLE' ||
    /ExpoSecureStore/i.test(message) ||
    /native module/i.test(message) ||
    /unavailable/i.test(message) ||
    name === 'UnavailabilityError'
  );
}

async function warnAndMaybeFallback(error: unknown): Promise<void> {
  if (!secureStoreFallbackWarned && isDevBuild && isSecureStoreUnavailable(error)) {
    secureStoreFallbackWarned = true;
    console.warn('[Mutabaka] expo-secure-store native module unavailable in this build; using AsyncStorage fallback (development only).', error);
  }
}

async function secureStoreGetItem(key: string): Promise<string | null> {
  if (secureStoreStatus === 'missing') {
    return AsyncStorage.getItem(makeFallbackKey(key));
  }
  try {
    const value = await SecureStore.getItemAsync(key);
    secureStoreStatus = 'available';
    if (value === null || typeof value === 'undefined') {
      await AsyncStorage.removeItem(makeFallbackKey(key)).catch(() => undefined);
      return null;
    }
    return value;
  } catch (error) {
    if (isSecureStoreUnavailable(error)) {
      secureStoreStatus = 'missing';
      await warnAndMaybeFallback(error);
      if (!isDevBuild) {
        throw error instanceof Error ? error : new Error('expo-secure-store unavailable');
      }
      return AsyncStorage.getItem(makeFallbackKey(key));
    }
    throw error;
  }
}

async function secureStoreSetItem(key: string, value: string): Promise<void> {
  if (secureStoreStatus === 'missing') {
    await AsyncStorage.setItem(makeFallbackKey(key), value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
    secureStoreStatus = 'available';
    await AsyncStorage.removeItem(makeFallbackKey(key)).catch(() => undefined);
  } catch (error) {
    if (isSecureStoreUnavailable(error)) {
      secureStoreStatus = 'missing';
      await warnAndMaybeFallback(error);
      if (!isDevBuild) {
        throw error instanceof Error ? error : new Error('expo-secure-store unavailable');
      }
      await AsyncStorage.setItem(makeFallbackKey(key), value);
      return;
    }
    throw error;
  }
}

async function secureStoreDeleteItem(key: string): Promise<void> {
  if (secureStoreStatus === 'missing') {
    await AsyncStorage.removeItem(makeFallbackKey(key)).catch(() => undefined);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
    secureStoreStatus = 'available';
    await AsyncStorage.removeItem(makeFallbackKey(key)).catch(() => undefined);
  } catch (error) {
    if (isSecureStoreUnavailable(error)) {
      secureStoreStatus = 'missing';
      await warnAndMaybeFallback(error);
      if (!isDevBuild) {
        throw error instanceof Error ? error : new Error('expo-secure-store unavailable');
      }
      await AsyncStorage.removeItem(makeFallbackKey(key)).catch(() => undefined);
      return;
    }
    throw error;
  }
}

const PIN_ITERATIONS = 4000;
const SESSION_ITERATIONS = 6000;
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const MAX_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface PinMetadata {
  userId: number;
  username?: string;
  displayName?: string;
  pinEnabledLocal: boolean;
  pinEpochLocal: number;
  attemptCount: number;
  lastAttemptTs: number;
  lockUntilTs?: number | null;
  lastUnlockedAt?: number | null;
}

export interface PinStatusPayload {
  pin_enabled: boolean;
  pin_set: boolean;
  pin_epoch: number;
  pin_failed_attempts?: number;
  pin_locked_until?: string | null;
  pin_initialized_at?: string | null;
}

export interface UnlockResult {
  tokens: AuthTokens;
  metadata: PinMetadata;
}

export class PinSessionError extends Error {
  code: 'LOCKED' | 'INVALID_PIN' | 'NO_SESSION';
  remainingMs?: number;

  constructor(code: 'LOCKED' | 'INVALID_PIN' | 'NO_SESSION', message: string, remainingMs?: number) {
    super(message);
    this.code = code;
    this.remainingMs = remainingMs;
  }
}

function now(): number {
  return Date.now();
}

function serializeMeta(meta: PinMetadata): string {
  return JSON.stringify(meta);
}

function deserializeMeta(raw: string | null): PinMetadata | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PinMetadata;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return {
      userId: Number(parsed.userId) || 0,
      username: typeof (parsed as any).username === 'string' ? (parsed as any).username : undefined,
      displayName: typeof (parsed as any).displayName === 'string' ? (parsed as any).displayName : undefined,
      pinEnabledLocal: Boolean(parsed.pinEnabledLocal),
      pinEpochLocal: Number(parsed.pinEpochLocal) || 0,
      attemptCount: Number(parsed.attemptCount) || 0,
      lastAttemptTs: Number(parsed.lastAttemptTs) || 0,
      lockUntilTs: parsed.lockUntilTs ? Number(parsed.lockUntilTs) : null,
      lastUnlockedAt: (parsed as any).lastUnlockedAt ? Number((parsed as any).lastUnlockedAt) : undefined,
    } satisfies PinMetadata;
  } catch (error) {
    console.warn('[Mutabaka] Failed to parse PIN metadata', error);
    return null;
  }
}

async function loadMetadata(): Promise<PinMetadata | null> {
  const raw = await AsyncStorage.getItem(META_KEY);
  return deserializeMeta(raw);
}

async function saveMetadata(meta: PinMetadata): Promise<void> {
  await AsyncStorage.setItem(META_KEY, serializeMeta(meta));
}

async function deleteMetadata(): Promise<void> {
  await AsyncStorage.removeItem(META_KEY);
}

interface PinRecordPayload {
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
}

interface SessionRecordPayload {
  salt: string;
  iv: string;
  cipher: string;
  iterations: number;
  createdAt: number;
}

async function fetchPinRecord(): Promise<PinRecordPayload | null> {
  try {
    const raw = await secureStoreGetItem(PIN_RECORD_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PinRecordPayload;
  } catch (error) {
    console.warn('[Mutabaka] Failed to parse pin record', error);
    return null;
  }
}

async function fetchSessionRecord(): Promise<SessionRecordPayload | null> {
  try {
    const raw = await secureStoreGetItem(SESSION_RECORD_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionRecordPayload;
  } catch (error) {
    console.warn('[Mutabaka] Failed to parse session record', error);
    return null;
  }
}

function computeLockDurationMs(attemptCount: number): number {
  if (attemptCount <= 0) {
    return 0;
  }
  const base = 1000 * Math.pow(2, Math.min(attemptCount, MAX_ATTEMPTS_BEFORE_LOCK));
  return Math.min(MAX_LOCK_DURATION_MS, base);
}

function deriveKey(pin: string, saltHex: string, iterations: number): CryptoJS.lib.WordArray {
  const salt = CryptoJS.enc.Hex.parse(saltHex);
  return CryptoJS.PBKDF2(pin, salt, { keySize: 256 / 32, iterations });
}

async function storePinRecord(pin: string): Promise<PinRecordPayload> {
  const salt = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const hash = deriveKey(pin, salt, PIN_ITERATIONS).toString();
  const payload: PinRecordPayload = {
    salt,
    hash,
    iterations: PIN_ITERATIONS,
    createdAt: now(),
  };
  await secureStoreSetItem(PIN_RECORD_KEY, JSON.stringify(payload));
  return payload;
}

async function storeEncryptedSession(pin: string, tokens: AuthTokens): Promise<SessionRecordPayload> {
  const salt = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const iv = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const key = deriveKey(pin, salt, SESSION_ITERATIONS);
  const cipher = CryptoJS.AES.encrypt(JSON.stringify(tokens), key, {
    iv: CryptoJS.enc.Hex.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();
  const payload: SessionRecordPayload = {
    salt,
    iv,
    cipher,
    iterations: SESSION_ITERATIONS,
    createdAt: now(),
  };
  await secureStoreSetItem(SESSION_RECORD_KEY, JSON.stringify(payload));
  return payload;
}

async function clearSecureRecords(): Promise<void> {
  await secureStoreDeleteItem(PIN_RECORD_KEY).catch(() => undefined);
  await secureStoreDeleteItem(SESSION_RECORD_KEY).catch(() => undefined);
}

export async function inspectState(): Promise<{ metadata: PinMetadata | null; hasSecureSession: boolean }>
{
  const [meta, session] = await Promise.all([loadMetadata(), fetchSessionRecord()]);
  return {
    metadata: meta,
    hasSecureSession: Boolean(session && meta && meta.pinEnabledLocal),
  };
}

export async function clearAll(options?: { keepTokens?: boolean }): Promise<void> {
  await Promise.all([deleteMetadata(), clearSecureRecords()]);
  if (!options?.keepTokens) {
    await clearAuthTokens();
  }
}

export async function resetForUser(userId: number): Promise<void> {
  const meta = await loadMetadata();
  if (meta && meta.userId !== userId) {
    await clearAll();
    return;
  }
  await Promise.all([deleteMetadata(), clearSecureRecords(), clearAuthTokens()]);
}

async function recordFailedAttempt(meta: PinMetadata | null): Promise<PinMetadata> {
  const current = meta ?? {
    userId: 0,
    username: undefined,
    displayName: undefined,
    pinEnabledLocal: true,
    pinEpochLocal: 0,
    attemptCount: 0,
    lastAttemptTs: 0,
    lockUntilTs: null,
  } satisfies PinMetadata;
  const attemptCount = (current.attemptCount || 0) + 1;
  const duration = computeLockDurationMs(attemptCount);
  const next: PinMetadata = {
    ...current,
    attemptCount,
    lastAttemptTs: now(),
    lockUntilTs: duration > 0 ? now() + duration : null,
  };
  await saveMetadata(next);
  return next;
}

async function resetAttempts(meta: PinMetadata): Promise<PinMetadata> {
  const next = {
    ...meta,
    attemptCount: 0,
    lastAttemptTs: now(),
    lockUntilTs: null,
    lastUnlockedAt: now(),
  } satisfies PinMetadata;
  await saveMetadata(next);
  return next;
}

export async function setPinForSession(options: {
  pin: string;
  tokens: AuthTokens;
  userId: number;
  serverStatus: PinStatusPayload;
  displayName?: string | null;
  username?: string | null;
}): Promise<void> {
  const { pin, tokens, userId, serverStatus, displayName, username } = options;
  await storePinRecord(pin);
  await storeEncryptedSession(pin, tokens);
  const meta: PinMetadata = {
    userId,
    username: username ?? undefined,
    displayName: displayName ?? undefined,
    pinEnabledLocal: true,
    pinEpochLocal: Number(serverStatus.pin_epoch) || 0,
    attemptCount: 0,
    lastAttemptTs: now(),
    lockUntilTs: null,
    lastUnlockedAt: now(),
  };
  await saveMetadata(meta);
  setUnlockedTokens(tokens);
}

export async function updateSessionAfterUnlock(options: {
  pin: string;
  tokens: AuthTokens;
  serverStatus: PinStatusPayload;
  metadata: PinMetadata;
  displayName?: string | null;
  username?: string | null;
}): Promise<void> {
  const { pin, tokens, serverStatus, metadata, displayName, username } = options;
  await storeEncryptedSession(pin, tokens);
  const nextMeta: PinMetadata = {
    ...metadata,
    pinEnabledLocal: Boolean(serverStatus.pin_enabled || metadata.pinEnabledLocal),
    pinEpochLocal: Number(serverStatus.pin_epoch) || metadata.pinEpochLocal,
    attemptCount: 0,
    lastAttemptTs: now(),
    lockUntilTs: null,
    displayName: displayName ?? metadata.displayName,
    username: username ?? metadata.username,
    lastUnlockedAt: now(),
  };
  await saveMetadata(nextMeta);
  setUnlockedTokens(tokens);
}

export async function unlockWithPin(pin: string): Promise<UnlockResult> {
  const [meta, pinRecord, sessionRecord] = await Promise.all([
    loadMetadata(),
    fetchPinRecord(),
    fetchSessionRecord(),
  ]);

  if (!meta || !pinRecord || !sessionRecord) {
    throw new PinSessionError('NO_SESSION', 'لا يوجد جلسة مخزنة لهذا الجهاز');
  }

  const lockUntil = meta.lockUntilTs ?? null;
  if (lockUntil && lockUntil > now()) {
    throw new PinSessionError('LOCKED', 'تم قفل المحاولة مؤقتًا', lockUntil - now());
  }

  const computedHash = deriveKey(pin, pinRecord.salt, pinRecord.iterations).toString();
  if (computedHash !== pinRecord.hash) {
    const updatedMeta = await recordFailedAttempt(meta);
    const remaining = updatedMeta.lockUntilTs && updatedMeta.lockUntilTs > now()
      ? updatedMeta.lockUntilTs - now()
      : undefined;
    throw new PinSessionError('INVALID_PIN', 'رمز PIN غير صحيح', remaining);
  }

  const key = deriveKey(pin, sessionRecord.salt, sessionRecord.iterations);
  const decrypted = CryptoJS.AES.decrypt(sessionRecord.cipher, key, {
    iv: CryptoJS.enc.Hex.parse(sessionRecord.iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);

  if (!decrypted) {
    throw new PinSessionError('NO_SESSION', 'تعذر فك تشفير الجلسة');
  }

  let tokens: AuthTokens;
  try {
    tokens = JSON.parse(decrypted) as AuthTokens;
  } catch (error) {
    console.warn('[Mutabaka] Failed to parse decrypted session', error);
    throw new PinSessionError('NO_SESSION', 'بيانات الجلسة تالفة');
  }

  const sanitizedTokens: AuthTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };

  const resetMeta = await resetAttempts(meta);
  setUnlockedTokens(sanitizedTokens);

  return { tokens: sanitizedTokens, metadata: resetMeta };
}

export async function wipeIfServerDisabled(status: PinStatusPayload): Promise<void> {
  if (!status.pin_enabled) {
    await clearAll();
  }
}

export async function wipeIfEpochChanged(status: PinStatusPayload): Promise<boolean> {
  const meta = await loadMetadata();
  if (!meta) {
    return false;
  }
  if (meta.pinEpochLocal !== Number(status.pin_epoch || 0)) {
    await clearAll();
    return true;
  }
  return false;
}

export async function clearAttempts(): Promise<void> {
  const meta = await loadMetadata();
  if (!meta) {
    return;
  }
  await saveMetadata({ ...meta, attemptCount: 0, lockUntilTs: null, lastAttemptTs: now(), lastUnlockedAt: meta.lastUnlockedAt ?? null });
}

export async function getLockState(): Promise<{ locked: boolean; remainingMs: number } | null> {
  const meta = await loadMetadata();
  if (!meta) {
    return null;
  }
  const lockUntil = meta.lockUntilTs ?? null;
  if (!lockUntil) {
    return { locked: false, remainingMs: 0 };
  }
  const remaining = lockUntil - now();
  if (remaining <= 0) {
    return { locked: false, remainingMs: 0 };
  }
  return { locked: true, remainingMs: remaining };
}

export async function hasStoredSession(): Promise<boolean> {
  const state = await inspectState();
  return state.hasSecureSession;
}

export async function getPinMetadata(): Promise<PinMetadata | null> {
  return loadMetadata();
}
