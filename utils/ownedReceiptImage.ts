import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuid } from 'uuid';

export const OWNED_RECEIPT_PREFIX = 'peachspend-receipt-';
export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

export function isOwnedReceiptImage(uri: string): boolean {
  return Boolean(FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory) && uri.includes(OWNED_RECEIPT_PREFIX));
}

export async function copyReceiptImageToAppCache(uri: string, mimeType: string, declaredSize?: number): Promise<string> {
  const scheme = uri.slice(0, uri.indexOf(':')).toLowerCase();
  if (!uri || !['file', 'content'].includes(scheme)) throw new Error('unsupported_image_uri');
  const type = mimeType.toLowerCase();
  if (!type || !MIME_TYPES.has(type)) throw new Error('unsupported_image_type');
  if (declaredSize !== undefined && (!Number.isFinite(declaredSize) || declaredSize > MAX_RECEIPT_IMAGE_BYTES)) throw new Error('image_too_large');
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || (info.size ?? 0) > MAX_RECEIPT_IMAGE_BYTES) throw new Error('image_too_large');
  if (!FileSystem.cacheDirectory) throw new Error('image_cache_unavailable');
  const extension = type.split('/')[1].replace('jpeg', 'jpg');
  const destination = `${FileSystem.cacheDirectory}${OWNED_RECEIPT_PREFIX}${uuid()}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

export async function deleteOwnedReceiptImage(uri?: string): Promise<void> {
  if (uri && isOwnedReceiptImage(uri)) await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function cleanupOwnedImage(uri?: string): Promise<void> {
  await deleteOwnedReceiptImage(uri);
}

export async function readOwnedReceiptImageAsBase64(uri: string): Promise<string> {
  if (!isOwnedReceiptImage(uri)) throw new Error('unowned_image_uri');
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || (info.size ?? 0) > MAX_RECEIPT_IMAGE_BYTES) throw new Error('image_too_large');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
