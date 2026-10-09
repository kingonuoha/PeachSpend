import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, registerSensitiveValue } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logger redaction', () => {
  it('redacts a registered profile name and financial value while keeping the diagnostic', () => {
    registerSensitiveValue('Ada Lovelace');
    registerSensitiveValue('1200.50');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('settings_write_failed', 'profile Ada Lovelace monthly_budget 1200.50');

    expect(error).toHaveBeenCalledWith(
      '[ERROR]:',
      'settings_write_failed',
      'profile [REDACTED] monthly_budget [REDACTED]'
    );
  });

  it('keeps registered values shorter than the minimum length out of the redaction set', () => {
    registerSensitiveValue('a');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logger.info('a diagnostic message');

    expect(info).toHaveBeenCalledWith('[INFO]:', 'a diagnostic message');
  });

  it('redacts provider key shapes without registration', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('request failed with x-goog-api-key: AIzaSySuperSecretValue');

    const logged = error.mock.calls[0]?.[1] as string;
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('AIzaSySuperSecretValue');
  });

  it('emits error outside production', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('boom');

    expect(error).toHaveBeenCalledWith('[ERROR]:', 'boom');
  });

  it('emits warn outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    logger.warn('careful');

    expect(warn).toHaveBeenCalledWith('[WARN]:', 'careful');
  });

  it('silences warn in production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger: productionLogger } = await import('./logger');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    productionLogger.warn('careful');

    expect(warn).not.toHaveBeenCalled();
  });

  it('silences error in production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger: productionLogger } = await import('./logger');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    productionLogger.error('boom');

    expect(error).not.toHaveBeenCalled();
  });
});
