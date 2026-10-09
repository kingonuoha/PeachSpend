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

export function toNotificationRecord(row: StoredNotification): NotificationRecord {
  const data = parseNotificationData(row.data);
  const kind = mapNotificationKind(row.type);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind,
    read: row.read === 1,
    createdAt: row.created_at,
    destination: resolveNotificationDestination(kind, data),
    data,
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
    await this.source.markNotificationRead(id);
  }

  async markAllRead(): Promise<void> {
    await this.source.markAllNotificationsRead();
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
