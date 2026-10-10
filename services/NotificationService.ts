import { Platform } from 'react-native';
import { databaseService } from './DatabaseService';
import { buildExpenseNotificationBody, resolveAmountVisibility } from './notificationContent';
import { logger } from '../utils/logger';
import { canUseNativeRuntime, isExpoGoRuntime } from '../utils/runtimeEnvironment';

let Notifications: typeof import('expo-notifications') | null = null;
if (!isExpoGoRuntime()) {
  // Keep native module lazy, Expo Go cannot load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loadedNotifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications = loadedNotifications;
  loadedNotifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

class NotificationService {
  private notificationQueue: { merchant: string; amount: string; transactionId?: string }[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW = 3000;
  private readonly GROUP_ID = 'expense-group';

  async requestPermissions(): Promise<boolean> {
    if (!canUseNativeRuntime('expo-notifications') || !Notifications) return false;
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        logger.warn('Notification permission not granted');
        return false;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('expenses', {
          name: 'Expense Alerts',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 100],
          lightColor: '#FFD2C4',
        });
      }

      return true;
    } catch {
      logger.error('Failed to request notification permissions', 'notification_permission_failed');
      return false;
    }
  }

  scheduleExpenseNotification(merchant: string, amount: string, transactionId?: string): void {
    if (!canUseNativeRuntime('expo-notifications')) return;
    this.notificationQueue.push({ merchant, amount, transactionId });
    this.scheduleBatch();
  }

  private scheduleBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flushBatch();
    }, this.BATCH_WINDOW);
  }

  // Central visibility gate for every expense notification surface. Callers
  // pass the formatted amount, but only this boundary decides whether it is
  // allowed into an OS notification or the persisted notifications row. This
  // keeps the prices_visible rule in one place instead of one copy per caller.
  private areAmountsVisible(): Promise<boolean> {
    return resolveAmountVisibility(() => databaseService.getSetting('prices_visible'));
  }

  private async flushBatch(): Promise<void> {
    if (!Notifications) return;
    const batch = [...this.notificationQueue];
    this.notificationQueue = [];
    this.batchTimer = null;

    if (batch.length === 0) return;

    try {
      const amountsVisible = await this.areAmountsVisible();
      const title = batch.length === 1 ? 'Expense Recorded' : `${batch.length} Expenses Recorded`;
      const body = buildExpenseNotificationBody(batch, amountsVisible);

      // Persist to database
      try {
        await databaseService.insertNotification({
          id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          title,
          body,
          type: 'expense',
          data: JSON.stringify({ count: batch.length, transactionId: batch[0]?.transactionId ?? null }),
        });
      } catch {
        logger.warn('Failed to persist notification', 'notification_persist_failed');
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          ...(batch.length > 1 ? { categoryIdentifier: this.GROUP_ID } : {}),
          data: { grouped: batch.length > 1, count: batch.length },
          ...(Platform.OS === 'android' ? { channelId: 'expenses' } : {}),
        },
        trigger: null,
      });
    } catch {
      logger.error('Failed to schedule notification', 'notification_schedule_failed');
    }
  }
}

export const notificationService = new NotificationService();
