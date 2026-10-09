import { describe, expect, it, vi } from 'vitest';
import {
  CLEAR_ALL_DATA_MEDIA_SCOPE,
  MEDIA_ERASURE_SCOPES,
  RESET_APP_MEDIA_SCOPE,
  eraseOwnedMedia,
  type MediaErasurePort,
} from './MediaErasure';

function fakePort(overrides: Partial<MediaErasurePort> = {}): MediaErasurePort {
  return {
    deleteReceiptImage: vi.fn().mockResolvedValue(true),
    sweepReceiptImages: vi.fn().mockResolvedValue(0),
    sweepProfileAvatars: vi.fn().mockResolvedValue(0),
    sweepExportFiles: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('media erasure scope facts', () => {
  it('scopes Clear All Data to the receipt images of the cleared rows', () => {
    expect(MEDIA_ERASURE_SCOPES[CLEAR_ALL_DATA_MEDIA_SCOPE]).toEqual({
      receiptImages: true,
      profileAvatars: false,
      exportFiles: false,
    });
  });

  it('scopes Reset App to every media kind the app writes', () => {
    expect(MEDIA_ERASURE_SCOPES[RESET_APP_MEDIA_SCOPE]).toEqual({
      receiptImages: true,
      profileAvatars: true,
      exportFiles: true,
    });
  });
});

describe('eraseOwnedMedia', () => {
  it('Clear All Data deletes only the receipt images its rows referenced', async () => {
    const port = fakePort();

    const outcome = await eraseOwnedMedia(port, CLEAR_ALL_DATA_MEDIA_SCOPE, ['cache/a.jpg', 'cache/b.jpg']);

    expect(port.deleteReceiptImage).toHaveBeenCalledTimes(2);
    expect(port.deleteReceiptImage).toHaveBeenNthCalledWith(1, 'cache/a.jpg');
    expect(port.deleteReceiptImage).toHaveBeenNthCalledWith(2, 'cache/b.jpg');
    expect(port.sweepReceiptImages).not.toHaveBeenCalled();
    expect(port.sweepProfileAvatars).not.toHaveBeenCalled();
    expect(port.sweepExportFiles).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      scope: 'receipt_images',
      counts: { receiptImages: 2, profileAvatars: 0, exportFiles: 0 },
      failed: 0,
    });
  });

  it('Clear All Data touches no file when no row held a receipt image', async () => {
    const port = fakePort();

    const outcome = await eraseOwnedMedia(port, CLEAR_ALL_DATA_MEDIA_SCOPE);

    expect(port.deleteReceiptImage).not.toHaveBeenCalled();
    expect(outcome.counts.receiptImages).toBe(0);
  });

  it('Reset App sweeps receipts, avatars, and exports', async () => {
    const port = fakePort({
      sweepReceiptImages: vi.fn().mockResolvedValue(3),
      sweepProfileAvatars: vi.fn().mockResolvedValue(2),
      sweepExportFiles: vi.fn().mockResolvedValue(1),
    });

    const outcome = await eraseOwnedMedia(port, RESET_APP_MEDIA_SCOPE);

    expect(port.deleteReceiptImage).not.toHaveBeenCalled();
    expect(port.sweepReceiptImages).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      scope: 'all_app_media',
      counts: { receiptImages: 3, profileAvatars: 2, exportFiles: 1 },
      failed: 0,
    });
  });

  it('counts a failed file delete instead of throwing', async () => {
    const port = fakePort({ deleteReceiptImage: vi.fn().mockRejectedValue(new Error('disk busy')) });

    const outcome = await eraseOwnedMedia(port, CLEAR_ALL_DATA_MEDIA_SCOPE, ['cache/a.jpg']);

    expect(outcome.failed).toBe(1);
    expect(outcome.counts.receiptImages).toBe(0);
  });

  it('counts a failed Reset sweep as partial without aborting the other kinds', async () => {
    const port = fakePort({
      sweepReceiptImages: vi.fn().mockRejectedValue(new Error('cache unreadable')),
      sweepProfileAvatars: vi.fn().mockResolvedValue(1),
      sweepExportFiles: vi.fn().mockResolvedValue(2),
    });

    const outcome = await eraseOwnedMedia(port, RESET_APP_MEDIA_SCOPE);

    expect(outcome.failed).toBe(1);
    expect(outcome.counts).toEqual({ receiptImages: 0, profileAvatars: 1, exportFiles: 2 });
  });

  it('does not count a foreign uri the guarded port refused', async () => {
    const port = fakePort({ deleteReceiptImage: vi.fn().mockResolvedValue(false) });

    const outcome = await eraseOwnedMedia(port, CLEAR_ALL_DATA_MEDIA_SCOPE, ['/sdcard/photo.jpg']);

    expect(outcome.counts.receiptImages).toBe(0);
    expect(outcome.failed).toBe(0);
  });
});
