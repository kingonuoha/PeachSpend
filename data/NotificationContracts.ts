import type { Notification as StoredNotification } from '../types/database';

export type NotificationKind = 'recap' | 'transaction' | 'recurring' | 'system';

// FR-14.3 destinations. The ready target is derived from the stored type and
// payload only, never invented: a notification with no matching type maps to no
// destination instead of a fabricated route.
export type NotificationDestination =
  | { screen: 'S-23' }
  | { screen: 'S-08'; transactionId: string | null }
  | { screen: 'S-15' }
  | { screen: null };

export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  read: boolean;
  createdAt: number;
  destination: NotificationDestination;
  data: Record<string, string | null>;
}

export type NotificationListState =
  | { status: 'ready'; notifications: NotificationRecord[] }
  | { status: 'empty' };

export type NotificationDeleteResult = { status: 'deleted'; id: string };
export type NotificationClearResult = { status: 'cleared' };

export interface NotificationDataSource {
  getNotifications(): Promise<StoredNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  deleteNotification(id: string): Promise<void>;
  clearAllNotifications(): Promise<void>;
  getUnreadNotificationCount(): Promise<number>;
}
