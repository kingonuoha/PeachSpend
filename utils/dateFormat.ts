import { format, differenceInMinutes, differenceInHours, differenceInDays, isSameDay, isSameWeek } from 'date-fns';

export function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const mins = differenceInMinutes(now, date);
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  if (hours < 24 && isSameDay(date, now)) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  if (days === 1 || (hours >= 24 && hours < 48 && !isSameDay(date, now))) return 'Yesterday';
  if (isSameWeek(date, now, { weekStartsOn: 1 })) return format(date, 'EEEE');
  return format(date, 'MMM dd');
}

export function formatRelativeDateWithTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const mins = differenceInMinutes(now, date);
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  if (hours < 24 && isSameDay(date, now)) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  if (days === 1 || (hours >= 24 && hours < 48 && !isSameDay(date, now))) return 'Yesterday';
  if (isSameWeek(date, now, { weekStartsOn: 1 })) return format(date, 'EEEE');
  return format(date, 'MMM dd, HH:mm');
}
