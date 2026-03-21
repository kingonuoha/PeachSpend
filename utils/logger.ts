const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  log: (...args: any[]) => {
    if (!isProduction) {
      // In a real app, you might want to use a more sophisticated logger
      // but the guardrail says "No console.log in production code. Use the internal logger.ts."
      console.log('[LOG]:', ...args);
    }
  },
  error: (...args: any[]) => {
    console.error('[ERROR]:', ...args);
  },
  warn: (...args: any[]) => {
    console.warn('[WARN]:', ...args);
  },
  info: (...args: any[]) => {
    if (!isProduction) {
      console.info('[INFO]:', ...args);
    }
  },
};
