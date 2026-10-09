const isProduction = process.env.NODE_ENV === 'production';

type LogValue = unknown;
const SECRET_PATTERN = /(gemini|openrouter)[^\s:=]*[\s:=]+[^\s,;]+/gi;
const BEARER_PATTERN = /(Bearer\s+)[^\s,;]+/gi;
const HEADER_PATTERN = /((?:x-goog-api-key|authorization|api[-_]?key)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi;
// Values shorter than this are not redacted: replacing a one or two character
// value everywhere would shred unrelated diagnostics for no real secrecy gain.
// Provider keys, profile names, and budget strings are longer than this.
const MIN_REDACTED_LENGTH = 3;
const sensitiveValues = new Set<string>();

export function registerSensitiveValue(value: string | null | undefined): void {
  if (!value) return;
  if (value.trim().length < MIN_REDACTED_LENGTH) return;
  sensitiveValues.add(value);
}

function redactText(value: string): string {
  let result = value.replace(SECRET_PATTERN, '$1 [REDACTED]').replace(BEARER_PATTERN, '$1[REDACTED]').replace(HEADER_PATTERN, '$1[REDACTED]');
  for (const secret of sensitiveValues) result = result.split(secret).join('[REDACTED]');
  return result;
}

const redact = (value: LogValue): LogValue => {
  if (value instanceof Error) {
    const safe = new Error(redactText(value.message));
    safe.name = value.name;
    return safe;
  }
  if (typeof value === 'string') return redactText(value);
  if (value && typeof value === 'object') return '[REDACTED_OBJECT]';
  return value;
};
const safeArgs = (args: LogValue[]) => args.map(redact);

export const logger = {
  log: (...args: LogValue[]) => {
    if (!isProduction) {
      // In a real app, you might want to use a more sophisticated logger
      // but the guardrail says "No console.log in production code. Use the internal logger.ts."
      console.log('[LOG]:', ...safeArgs(args));
    }
  },
  error: (...args: LogValue[]) => {
    if (!isProduction) {
      console.error('[ERROR]:', ...safeArgs(args));
    }
  },
  warn: (...args: LogValue[]) => {
    if (!isProduction) {
      console.warn('[WARN]:', ...safeArgs(args));
    }
  },
  info: (...args: LogValue[]) => {
    if (!isProduction) {
      console.info('[INFO]:', ...safeArgs(args));
    }
  },
};
