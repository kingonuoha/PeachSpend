// Phase 11 D4, DEC-11-03. Chat history retention.
//
// The product decision: keep forever is the default and the only behaviour for a
// fresh install, because switching real retention on must never delete history a
// user never agreed to lose. Seven and thirty days are explicit opt in and must
// genuinely delete.
//
// The deletion rule is age based: a message older than the window is removed. It is
// deliberately not an inactivity sweep. An inactivity sweep clears a whole
// conversation after a quiet week, which is the behaviour the old interface copy
// promised and which keep forever must not do.

export const CHAT_RETENTION_KEEP_FOREVER = 0;

export const CHAT_RETENTION_OPTIONS = [0, 7, 30] as const;

export type ChatRetentionDays = 0 | 7 | 30;

export const CHAT_RETENTION_KEY = 'chat_retention_days';

const DAY_MS = 86_400_000;

export class ChatRetentionError extends Error {
  readonly code = 'chat_retention_invalid';
  constructor(readonly days: number) {
    super(`Chat retention must be one of ${CHAT_RETENTION_OPTIONS.join(', ')} days`);
    this.name = 'ChatRetentionError';
  }
}

// A missing key, an unparsable value, or any number the product did not offer
// resolves to keep forever. This is the one direction the fallback is allowed to
// fail in: never towards a mode that deletes.
export function parseChatRetentionDays(raw: string | null | undefined): ChatRetentionDays {
  if (raw === null || raw === undefined) return CHAT_RETENTION_KEEP_FOREVER;
  const trimmed = raw.trim();
  if (!trimmed) return CHAT_RETENTION_KEEP_FOREVER;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return CHAT_RETENTION_KEEP_FOREVER;
  return CHAT_RETENTION_OPTIONS.includes(parsed as ChatRetentionDays)
    ? (parsed as ChatRetentionDays)
    : CHAT_RETENTION_KEEP_FOREVER;
}

// The setter refuses a value the interface cannot offer rather than silently
// storing it and reading it back as keep forever, so a caller bug surfaces at the
// write instead of as history that quietly never clears.
export function assertChatRetentionDays(days: number): ChatRetentionDays {
  if (!Number.isInteger(days) || !CHAT_RETENTION_OPTIONS.includes(days as ChatRetentionDays)) throw new ChatRetentionError(days);
  return days as ChatRetentionDays;
}

// The oldest timestamp that survives the sweep, or null when nothing is deleted.
export function chatRetentionCutoff(days: ChatRetentionDays, now: number): number | null {
  if (days === CHAT_RETENTION_KEEP_FOREVER) return null;
  return now - days * DAY_MS;
}
