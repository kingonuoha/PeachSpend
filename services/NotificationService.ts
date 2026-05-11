import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { logger } from '../utils/logger';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

let Notifications: any = null;
if (!isExpoGo) {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

class NotificationService {
  private notificationQueue: { merchant: string; amount: string }[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW = 3000;
  private readonly GROUP_ID = 'expense-group';

  async requestPermissions(): Promise<boolean> {
    if (isExpoGo || !Notifications) return true;
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
    } catch (error) {
      logger.error('Failed to request notification permissions', error);
      return false;
    }
  }

  scheduleExpenseNotification(merchant: string, amount: string): void {
    this.notificationQueue.push({ merchant, amount });
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

  private async flushBatch(): Promise<void> {
    if (isExpoGo || !Notifications) return;
    const batch = [...this.notificationQueue];
    this.notificationQueue = [];
    this.batchTimer = null;

    if (batch.length === 0) return;

    try {
      let title: string;
      let body: string;

      if (batch.length === 1) {
        const item = batch[0];
        title = 'Expense Recorded';
        body = `${item.merchant} — ${item.amount}`;
      } else {
        const total = batch.reduce((sum, item) => {
          const num = parseFloat(item.amount.replace(/[^0-9.-]/g, ''));
          return sum + (isNaN(num) ? 0 : num);
        }, 0);
        title = `${batch.length} Expenses Recorded`;
        body = batch.map(i => `${i.merchant} — ${i.amount}`).join('\n');
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
    } catch (error) {
      logger.error('Failed to schedule notification', error);
    }
  }
}

export const notificationService = new NotificationService();
