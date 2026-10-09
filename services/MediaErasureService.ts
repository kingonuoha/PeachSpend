import { deleteOwnedReceiptImage, isOwnedReceiptImage, sweepOwnedReceiptImages } from '../utils/ownedReceiptImage';
import { sweepOwnedProfileAvatars } from '../utils/profileAvatar';
import { sweepOwnedExportFiles } from './CleanupService';
import {
  eraseOwnedMedia,
  type MediaErasureOutcome,
  type MediaErasurePort,
  type MediaErasureScope,
} from '../data/MediaErasure';

// D9 / S-06R-01, S-06R-02: the single filesystem-backed implementation of the
// media erasure port. Every method reaches an existing owned-file guard, so the
// boundary can only ever remove media the app wrote.
export const ownedMediaErasurePort: MediaErasurePort = {
  async deleteReceiptImage(uri: string): Promise<boolean> {
    if (!isOwnedReceiptImage(uri)) return false;
    await deleteOwnedReceiptImage(uri);
    return true;
  },
  sweepReceiptImages: sweepOwnedReceiptImages,
  sweepProfileAvatars: sweepOwnedProfileAvatars,
  sweepExportFiles: sweepOwnedExportFiles,
};

// One call shape for the destructive actions. DatabaseService owns the SQL clear;
// this owns the on-disk delete for that clear's scope. A screen reads the scope
// facts in MEDIA_ERASURE_SCOPES and never calls this.
export function eraseOwnedMediaForScope(
  scope: MediaErasureScope,
  receiptImageUris: readonly string[] = [],
): Promise<MediaErasureOutcome> {
  return eraseOwnedMedia(ownedMediaErasurePort, scope, receiptImageUris);
}
