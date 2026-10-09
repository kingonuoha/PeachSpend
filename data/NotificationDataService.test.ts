import { describe, expect, it, vi } from 'vitest';
import type { Notification as StoredNotification } from '../types/database';
import type { NotificationDataSource } from './NotificationContracts';
import {
  NotificationDataService, buildNotificationList, countUnread, mapNotificationKind,
  parseNotificationData, resolveNotificationDestination, toNotificationRecord,
} from './NotificationDataService';

const notification = (overrides: Partial<StoredNotification> = {}): StoredNotification => ({
  id: 'n1', title: 'Title', body: 'Body', type: 'expense', data: null, read: 0, created_at: 10, ...overrides,
});

function source(rows: StoredNotification[]): NotificationDataSource {
  return {
    getNotifications: vi.fn().mockResolvedValue(rows),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
    deleteNotification: vi.fn().mockResolvedValue(undefined),
    clearAllNotifications: vi.fn().mockResolvedValue(undefined),
    getUnreadNotificationCount: vi.fn().mockResolvedValue(rows.filter(row => row.read === 0).length),
  };
}

describe('notification list state', () => {
  it('is empty rather than fabricating a notification', () => {
    expect(buildNotificationList([])).toEqual({ status: 'empty' });
  });

  it('maps unread and read state from real rows', () => {
    const list = buildNotificationList([notification({ read: 1 }), notification({ id: 'n2' })]);
    expect(list.status).toBe('ready');
    if (list.status === 'ready') {
      expect(list.notifications.map(item => item.read)).toEqual([true, false]);
    }
  });

  it('counts unread from the rows', () => {
    expect(countUnread([notification({ read: 1 }), notification({ id: 'n2' })])).toBe(1);
  });
});

describe('notification destinations (FR-14.3)', () => {
  it('routes recap to S-23, recurring to S-15, and a transaction to S-08', () => {
    expect(resolveNotificationDestination('recap', {})).toEqual({ screen: 'S-23' });
    expect(resolveNotificationDestination('recurring', {})).toEqual({ screen: 'S-15' });
    expect(resolveNotificationDestination('transaction', { transactionId: 'exp-1' })).toEqual({ screen: 'S-08', transactionId: 'exp-1' });
    expect(resolveNotificationDestination('transaction', {})).toEqual({ screen: 'S-08', transactionId: null });
  });

  it('maps known types and leaves an unknown type unrouted', () => {
    expect(mapNotificationKind('recap')).toBe('recap');
    expect(mapNotificationKind('recurring')).toBe('recurring');
    expect(mapNotificationKind('expense')).toBe('transaction');
    expect(mapNotificationKind('mystery')).toBe('system');
    expect(resolveNotificationDestination('system', {})).toEqual({ screen: null });
  });

  it('reads a transaction id from stored data without inventing one', () => {
    const record = toNotificationRecord(notification({ type: 'expense', data: JSON.stringify({ count: 2, transactionId: 'exp-9' }) }));
    expect(record.destination).toEqual({ screen: 'S-08', transactionId: 'exp-9' });
    expect(parseNotificationData('not json')).toEqual({});
  });
});

describe('notification delete boundaries', () => {
  it('deletes one and clears all through the data source', async () => {
    const port = source([notification()]);
    const service = new NotificationDataService(port);

    await expect(service.delete('n1')).resolves.toEqual({ status: 'deleted', id: 'n1' });
    expect(port.deleteNotification).toHaveBeenCalledWith('n1');

    await expect(service.clearAll()).resolves.toEqual({ status: 'cleared' });
    expect(port.clearAllNotifications).toHaveBeenCalledOnce();
  });

  it('marks read and reports the unread count from the source', async () => {
    const port = source([notification()]);
    const service = new NotificationDataService(port);
    await service.markRead('n1');
    await service.markAllRead();
    expect(port.markNotificationRead).toHaveBeenCalledWith('n1');
    expect(port.markAllNotificationsRead).toHaveBeenCalledOnce();
    await expect(service.unreadCount()).resolves.toBe(1);
  });
});
