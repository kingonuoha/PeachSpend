import { describe, expect, it } from 'vitest';
import {
  assertChatRetentionDays, ChatRetentionError, chatRetentionCutoff, CHAT_RETENTION_OPTIONS,
  parseChatRetentionDays, type ChatRetentionDays,
} from './ChatRetention';

const DAY_MS = 86_400_000;

describe('chat retention setting values', () => {
  it('offers keep forever, seven days and thirty days only', () => {
    expect(CHAT_RETENTION_OPTIONS).toEqual([0, 7, 30]);
  });

  it('resolves a missing or unreadable value to keep forever', () => {
    expect(parseChatRetentionDays(null)).toBe(0);
    expect(parseChatRetentionDays(undefined)).toBe(0);
    expect(parseChatRetentionDays('')).toBe(0);
    expect(parseChatRetentionDays('   ')).toBe(0);
    expect(parseChatRetentionDays('seven')).toBe(0);
    expect(parseChatRetentionDays('7.5')).toBe(0);
  });

  it('resolves a number the product never offered to keep forever, never to a deleting mode', () => {
    expect(parseChatRetentionDays('1')).toBe(0);
    expect(parseChatRetentionDays('14')).toBe(0);
    expect(parseChatRetentionDays('-7')).toBe(0);
    expect(parseChatRetentionDays('365')).toBe(0);
  });

  it('reads the three supported windows back unchanged', () => {
    expect(parseChatRetentionDays('0')).toBe(0);
    expect(parseChatRetentionDays('7')).toBe(7);
    expect(parseChatRetentionDays(' 30 ')).toBe(30);
  });

  it('refuses a setter value the interface cannot offer', () => {
    expect(assertChatRetentionDays(0)).toBe(0);
    expect(assertChatRetentionDays(7)).toBe(7);
    expect(assertChatRetentionDays(30)).toBe(30);
    for (const days of [14, -1, 1, Number.NaN, 7.5]) {
      expect(() => assertChatRetentionDays(days)).toThrow(ChatRetentionError);
    }
  });
});

describe('chat retention cutoff', () => {
  const now = 1_800_000_000_000;

  it('deletes nothing while retention is keep forever', () => {
    expect(chatRetentionCutoff(0, now)).toBeNull();
  });

  it('cuts at the start of the selected window', () => {
    expect(chatRetentionCutoff(7, now)).toBe(now - 7 * DAY_MS);
    expect(chatRetentionCutoff(30, now)).toBe(now - 30 * DAY_MS);
    const windows: ChatRetentionDays[] = [7, 30];
    expect(windows.map(days => chatRetentionCutoff(days, now))).not.toContain(null);
  });
});
