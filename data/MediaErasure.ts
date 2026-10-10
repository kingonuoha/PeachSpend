// D9 / S-06R-01 and S-06R-02: the one typed app-owned media erasure boundary.
// Clear All Data and Reset App both run through here so no action can claim a
// wider or narrower on-disk erase than it performs. The boundary only ever hands
// the port paths the app wrote: receipt images under the owned cache prefix,
// profile avatars under the owned avatar directory, and the app's own export
// CSVs. A screen reads MEDIA_ERASURE_SCOPES for honest copy and never deletes.

export type MediaErasureScope = 'receipt_images' | 'all_app_media';

// The factual media footprint of each destructive action. This is the source a
// screen reads so the Reset copy cannot drift from the deletion again.
export interface MediaErasureScopeSpec {
  readonly receiptImages: boolean;
  readonly profileAvatars: boolean;
  readonly exportFiles: boolean;
}

export const MEDIA_ERASURE_SCOPES: Readonly<Record<MediaErasureScope, MediaErasureScopeSpec>> = {
  // Clear All Data keeps identity, categories, settings, keys, and avatars. It
  // only owes the receipt images attached to the financial records it removes.
  receipt_images: { receiptImages: true, profileAvatars: false, exportFiles: false },
  // Reset App is the widest boundary and owes every media file the app wrote.
  all_app_media: { receiptImages: true, profileAvatars: true, exportFiles: true },
};

export const CLEAR_ALL_DATA_MEDIA_SCOPE: MediaErasureScope = 'receipt_images';
export const RESET_APP_MEDIA_SCOPE: MediaErasureScope = 'all_app_media';

export interface MediaErasureCounts {
  receiptImages: number;
  profileAvatars: number;
  exportFiles: number;
}

export interface MediaErasureOutcome {
  scope: MediaErasureScope;
  counts: MediaErasureCounts;
  // Number of owned files the boundary could not remove. Reported, never hidden:
  // the actions still complete so a stuck file cannot block a destructive clear.
  failed: number;
}

export interface MediaErasurePort {
  // Deletes one owned receipt image. Must be a no-op, never a delete, for a path
  // the app does not own, so a stored row can never point the boundary at a
  // foreign file. Returns true when an owned file was removed.
  deleteReceiptImage(uri: string): Promise<boolean>;
  // Sweeps every owned receipt image the app wrote to its cache. Returns the count.
  sweepReceiptImages(): Promise<number>;
  // Sweeps every owned profile avatar. Returns the count.
  sweepProfileAvatars(): Promise<number>;
  // Sweeps every owned export CSV. Returns the count.
  sweepExportFiles(): Promise<number>;
}

type AttemptResult = { count: number; failed: number };

async function attemptCount(run: () => Promise<number>): Promise<AttemptResult> {
  try {
    return { count: await run(), failed: 0 };
  } catch {
    return { count: 0, failed: 1 };
  }
}

async function attemptDelete(port: MediaErasurePort, uri: string): Promise<AttemptResult> {
  try {
    return { count: (await port.deleteReceiptImage(uri)) ? 1 : 0, failed: 0 };
  } catch {
    return { count: 0, failed: 1 };
  }
}

// Receipt images are the one kind whose clear scope is row-driven: Clear All Data
// only owes the receipt images its removed rows pointed at, while Reset App
// sweeps every owned receipt image in the cache.
async function eraseReceiptImages(
  port: MediaErasurePort,
  scope: MediaErasureScope,
  receiptImageUris: readonly string[],
): Promise<AttemptResult> {
  if (scope === 'all_app_media') return attemptCount(() => port.sweepReceiptImages());
  let count = 0;
  let failed = 0;
  for (const uri of receiptImageUris) {
    const result = await attemptDelete(port, uri);
    count += result.count;
    failed += result.failed;
  }
  return { count, failed };
}

export async function eraseOwnedMedia(
  port: MediaErasurePort,
  scope: MediaErasureScope,
  receiptImageUris: readonly string[] = [],
): Promise<MediaErasureOutcome> {
  const spec = MEDIA_ERASURE_SCOPES[scope];
  const counts: MediaErasureCounts = { receiptImages: 0, profileAvatars: 0, exportFiles: 0 };
  let failed = 0;

  if (spec.receiptImages) {
    const receipts = await eraseReceiptImages(port, scope, receiptImageUris);
    counts.receiptImages = receipts.count;
    failed += receipts.failed;
  }
  if (spec.profileAvatars) {
    const avatars = await attemptCount(() => port.sweepProfileAvatars());
    counts.profileAvatars = avatars.count;
    failed += avatars.failed;
  }
  if (spec.exportFiles) {
    const exports = await attemptCount(() => port.sweepExportFiles());
    counts.exportFiles = exports.count;
    failed += exports.failed;
  }

  return { scope, counts, failed };
}
