import type { CaptureRepository, QueuedCapture } from './contracts';

export type QueueProcessor = (item: QueuedCapture) => Promise<void>;

export async function processAutoCaptureQueue(repository: CaptureRepository, processor: QueueProcessor, now = Date.now()): Promise<{ processed: number; deferred: number }> {
  const items = await repository.claimQueuedAutoCaptures(now);
  let processed = 0;
  let deferred = 0;
  for (const item of items) {
    try {
      await processor(item);
      await repository.completeQueuedAutoCapture(item.id);
      processed += 1;
    } catch {
      deferred += 1;
      const backoff = Math.min(60 * 60 * 1000, 2 ** Math.min(item.attempts, 8) * 1000);
      await repository.failQueuedAutoCapture(item.id, 'provider', now + backoff);
    }
  }
  return { processed, deferred };
}
