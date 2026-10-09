import { databaseService } from './DatabaseService';
import { notificationService } from './NotificationService';
import { logger } from '../utils/logger';
import { formatCurrency } from '../utils/currency';

const RECURRING_TASK_NAME = 'peachspend-recurring-check';
const MAX_CATCHUP = 12;

class RecurringService {
  private checked = false;

  resetCheck() {
    this.checked = false;
  }

  async checkDueRecurring(): Promise<number> {
    if (this.checked) return 0;
    this.checked = true;

    try {
      const templates = await databaseService.getDueRecurringTemplates();
      if (templates.length === 0) return 0;

      let totalCreated = 0;
      for (const t of templates) {
        try {
          const now = Date.now();
          let dueDate = t.next_due_date;
          let itemCount = 0;
          let counter = 0;

          // Catch-up: keep generating for each missed period until
          // we catch up to the present, or hit the safety cap.
          while (dueDate <= now && counter < MAX_CATCHUP) {
            const newId = `${t.id}_${dueDate}_${counter}`;
            const isIncome = t.type === 'income';

            if (isIncome) {
              await databaseService.insertIncome({
                id: newId,
                source: t.merchant,
                amount: t.amount,
                currency: t.currency,
                category: t.category,
                note: t.note || '',
                is_recurring: 1,
                recurrence_interval: t.interval,
                next_due_date: dueDate,
                date: dueDate,
                created_at: now,
              });
            } else {
              await databaseService.addExpense({
                id: newId,
                merchant: t.merchant,
                amount: t.amount,
                currency: t.currency,
                category: t.category,
                note: t.note || '',
                scanned: 0,
                is_recurring: 1,
                recurrence_parent_id: t.id,
                date: dueDate,
                created_at: now,
              });
            }

            // Compute next date from the current due date, not from today
            const nextDue = await databaseService.getNextDueDate(t.interval, t.recurrence_days, dueDate);

            if (nextDue <= dueDate) {
              // Safety: if getNextDueDate didn't advance, push +1 day
              dueDate = dueDate + 86400000;
            } else {
              dueDate = nextDue;
            }

            itemCount++;
            counter++;
          }

          // Persist the new anchor date so we don't re-process these periods
          await databaseService.updateRecurringNextDue(t.id, dueDate);

          if (itemCount > 0) {
            notificationService.scheduleExpenseNotification(
              t.merchant,
              `${formatCurrency(t.amount, t.currency)} (${itemCount} recurring item${itemCount > 1 ? 's' : ''})`
            );
            // Persisted recurring reminder the S-14 list routes to S-15 (FR-14.3).
            // The body carries no amount, so a hidden-prices setting cannot leak.
            try {
              await databaseService.insertNotification({
                id: `notif_recurring_${t.id}_${dueDate}`,
                title: 'Recurring Payment Due',
                body: `${t.merchant} (${itemCount} recurring item${itemCount > 1 ? 's' : ''})`,
                type: 'recurring',
                data: JSON.stringify({ templateId: t.id, count: itemCount }),
              });
            } catch {
              logger.warn('Failed to persist recurring notification', 'recurring_notification_failed');
            }
            totalCreated += itemCount;
          }
        } catch {
          logger.error(`RecurringService: failed to process template ${t.id}`, 'recurring_item_failed');
        }
      }

      if (totalCreated > 0) {
        logger.info(`RecurringService: auto-created ${totalCreated} recurring item(s)`);
      }

      return totalCreated;
    } catch {
      logger.error('RecurringService.checkDueRecurring failed', 'recurring_check_failed');
      return 0;
    }
  }
}

export const recurringService = new RecurringService();
export { RECURRING_TASK_NAME };
