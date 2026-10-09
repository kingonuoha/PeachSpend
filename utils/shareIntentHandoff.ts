import { v4 as uuid } from 'uuid';

const HANDOFF_TTL_MS = 60_000;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

export interface ShareIntentFileRecord {
  uri: string;
  mimeType: string;
  fileSize?: number;
}

const handoffs = new Map<string, { record: ShareIntentFileRecord; expiresAt: number }>();

function removeExpiredHandoffs(): void {
  const now = Date.now();
  for (const [token, handoff] of handoffs) {
    if (handoff.expiresAt <= now) handoffs.delete(token);
  }
}

export function createShareIntentHandoff(record: ShareIntentFileRecord): string | null {
  removeExpiredHandoffs();
  const scheme = record.uri.slice(0, record.uri.indexOf(':')).toLowerCase();
  const mimeType = record.mimeType.toLowerCase();
  if (!['file', 'content'].includes(scheme) || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  if (record.fileSize !== undefined && (!Number.isFinite(record.fileSize) || record.fileSize > 10 * 1024 * 1024)) return null;
  const token = uuid();
  handoffs.set(token, { record: { ...record, mimeType }, expiresAt: Date.now() + HANDOFF_TTL_MS });
  return token;
}

export function consumeShareIntentHandoff(token: string): ShareIntentFileRecord | null {
  removeExpiredHandoffs();
  const handoff = handoffs.get(token);
  if (!handoff) return null;
  handoffs.delete(token);
  return handoff.record;
}
