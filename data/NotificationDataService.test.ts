import { describe, expect, it, vi } from 'vitest';
import type { Notification as StoredNotification } from '../types/database';
import type { NotificationDataSource } from './NotificationContracts';
import {
  NotificationDataService, buildNotificationList, countUnread, getDraftNotificationLink, mapNotificationKind,
  parseNotificationData, resolveNotificationDestination, selectMarkAllReadTargets, toNotificationRecord,
} from './NotificationDataService';

const notification = (overrides: Partial<StoredNotification> & { accounted?: number } = {}): StoredNotification & { accounted?: number } => ({
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
    expect(port.markNotificationRead).toHaveBeenCalledTimes(2);
    expect(port.markAllNotificationsRead).not.toHaveBeenCalled();
    await expect(service.unreadCount()).resolves.toBe(1);
  });
});

describe('draft linked unread until accounted for (Phase 14 D1)', () => {
  const draftRow = (id: string, accounted?: number) => notification({ id, data: JSON.stringify({ draftId: 'draft-1' }), accounted });

  it('exposes the draft link and the accounted flag on the record', () => {
    expect(toNotificationRecord(notification())).toMatchObject({ draftId: null, accounted: true });
    expect(toNotificationRecord(draftRow('n2'))).toMatchObject({ draftId: 'draft-1', accounted: false });
    expect(toNotificationRecord(draftRow('n3', 1))).toMatchObject({ draftId: 'draft-1', accounted: true });
  });

  it('reads the draft link from data without inventing one', () => {
    expect(getDraftNotificationLink({})).toBeNull();
    expect(getDraftNotificationLink({ draftId: null })).toBeNull();
    expect(getDraftNotificationLink({ draftId: '' })).toBeNull();
    expect(getDraftNotificationLink({ draftId: 'draft-9' })).toBe('draft-9');
  });

  it('selects only accounted rows for mark all read', () => {
    const records = [notification(), draftRow('n2'), draftRow('n3', 1)].map(toNotificationRecord);
    expect(selectMarkAllReadTargets(records)).toEqual(['n1', 'n3']);
  });

  it('skips unaccounted draft rows on mark all read and on mark read', async () => {
    const port = source([notification(), draftRow('n2'), draftRow('n3', 1)]);
    const service = new NotificationDataService(port);

    await service.markAllRead();

    expect(port.markNotificationRead).toHaveBeenCalledWith('n1');
    expect(port.markNotificationRead).toHaveBeenCalledWith('n3');
    expect(port.markNotificationRead).not.toHaveBeenCalledWith('n2');
    expect(port.markNotificationRead).toHaveBeenCalledTimes(2);

    await service.markRead('n2');
    expect(port.markNotificationRead).toHaveBeenCalledTimes(2);
    await service.markRead('n3');
    expect(port.markNotificationRead).toHaveBeenCalledTimes(3);
    expect(port.markNotificationRead).toHaveBeenLastCalledWith('n3');
  });

  it('leaves a missing row unread rather than writing blindly', async () => {
    const port = source([notification()]);
    const service = new NotificationDataService(port);

    await service.markRead('gone');

    expect(port.markNotificationRead).not.toHaveBeenCalled();
  });
});
