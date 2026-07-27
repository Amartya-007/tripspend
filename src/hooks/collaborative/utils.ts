import { Timestamp } from 'firebase/firestore';

export type FirestoreRecord = Record<string, unknown>;

export const ACTIVE_SHARED_TRIP_KEY = 'tripspend_active_shared_trip';
export const PRESETS_KEY = 'tripspend_presets';
export const ACTIVE_TRIP_PRESERVE_MS = 6000;

export const isPermissionDeniedError = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message?.toLowerCase() || '';
  return code === 'permission-denied' || message.includes('insufficient permissions');
};

export const nowIso = () => new Date().toISOString();

export const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
};

export const toIso = (value: unknown): string => {
  if (!value) return nowIso();
  if (typeof value === 'string') return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return nowIso();
};

export const generateShortCode = (): string => {
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint8Array(6);
    crypto.getRandomValues(values);
    for (let i = 0; i < 6; i++) {
      result += String(values[i] % 10);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      result += Math.floor(Math.random() * 10).toString();
    }
  }
  return result;
};
