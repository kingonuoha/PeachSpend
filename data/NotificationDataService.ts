import type { Notification as StoredNotification } from '../types/database';
import type {
  NotificationClearResult, NotificationDataSource, NotificationDeleteResult, NotificationDestination,
  NotificationKind, NotificationListState, NotificationRecord,
} from './NotificationContracts';

export function parseNotificationData(data: string | null): Record<string, string | null> {
  if (!data) return {};
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = typeof value === 'string' ? value : value == null ? null : String(value);
    }
    return result;
  } catch {
    return {};
  }
}

export function mapNotificationKind(type: string | null | undefined): NotificationKind {
  if (type === 'recap') return 'recap';
  if (type === 'recurring') return 'recurring';
  if (type === 'expense' || type === 'transaction') return 'transaction';
  return 'system';
}

export function resolveNotificationDestination(
  kind: NotificationKind,
  data: Record<string, string | null>,
): NotificationDestination {
  if (kind === 'recap') return { screen: 'S-23' };
  if (kind === 'recurring') return { screen: 'S-15' };
  if (kind === 'transaction') return { screen: 'S-08', transactionId: data.transactionId ?? null };
  return { screen: null };
}

// The inbox link a detection inbox row carries in its data payload. Set once
// at creation by the detection alert path; read here by the S-14 path and
// written nowhere else in the data layer.
export function getDraftNotificationLink(data: Record<string, string | null>): string | null {
  return typeof data.draftId === 'string' && data.draftId ? data.draftId : null;
}

// Mark all read targets: every accounted row. Draft linked rows that are not
// yet accounted are skipped, so they stay unread until confirmed, discarded,
// or filed. All other rows behave as today.
export function selectMarkAllReadTargets(records: NotificationRecord[]): string[] {
  return records.filter(record => record.accounted).map(record => record.id);
}

export function toNotificationRecord(row: StoredNotification & { accounted?: number | null }): NotificationRecord {
  const data = parseNotificationData(row.data);
  const kind = mapNotificationKind(row.type);
  const draftId = getDraftNotificationLink(data);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind,
    read: row.read === 1,
    createdAt: row.created_at,
    destination: resolveNotificationDestination(kind, data),
    data,
    draftId,
    // A row with no draft link is always accounted, so non draft rows behave
    // as today. A draft linked row is accounted only once a resolve operation
    // (confirm, discard, file) sets the stored flag; nothing else writes it.
    accounted: draftId === null ? true : row.accounted === 1,
  };
}

export function buildNotificationList(rows: StoredNotification[]): NotificationListState {
  return rows.length > 0
    ? { status: 'ready', notifications: rows.map(toNotificationRecord) }
    : { status: 'empty' };
}

export function countUnread(rows: StoredNotification[]): number {
  return rows.filter(row => row.read !== 1).length;
}

export class NotificationDataService {
  constructor(private readonly source: NotificationDataSource) {}

  async list(): Promise<NotificationListState> {
    return buildNotificationList(await this.source.getNotifications());
  }

  async unreadCount(): Promise<number> {
    return this.source.getUnreadNotificationCount();
  }

  async markRead(id: string): Promise<void> {
    // A draft linked row that is not yet accounted stays unread until it is
    // confirmed, discarded, or filed, so an explicit mark read skips it the
    // same way mark all read does. Everything else behaves as today.
    const records = (await this.source.getNotifications()).map(toNotificationRecord);
    const target = records.find(record => record.id === id);
    if (!target || !target.accounted) return;
    await this.source.markNotificationRead(id);
  }

  async markAllRead(): Promise<void> {
    // The existing mark all read path keys on the accounted flag: draft
    // linked rows that are not yet accounted are skipped, all other rows are
    // marked through the same per row write as before.
    const records = (await this.source.getNotifications()).map(toNotificationRecord);
    for (const id of selectMarkAllReadTargets(records)) {
      await this.source.markNotificationRead(id);
    }
  }

  async delete(id: string): Promise<NotificationDeleteResult> {
    await this.source.deleteNotification(id);
    return { status: 'deleted', id };
  }

  async clearAll(): Promise<NotificationClearResult> {
    await this.source.clearAllNotifications();
    return { status: 'cleared' };
  }
}
