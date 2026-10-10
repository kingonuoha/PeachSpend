import { deleteAsync, documentDirectory, readDirectoryAsync } from 'expo-file-system/legacy';

// Avatar files are stored as an owned filename in the app document directory, the
// same place the onboarding and SH-05c flows write them. Kept in one module so the
// Profile hero and the edit sheet cannot drift on the storage path.
export const PROFILE_AVATAR_DIR = (documentDirectory || '') + 'profile_pics/';
const OWNED_AVATAR_PATTERN = /^avatar_\d+\.[a-z0-9]+$/i;

export function resolveAvatarUri(file: string | null | undefined): string | null {
  return file && file.trim() ? PROFILE_AVATAR_DIR + file : null;
}

// S-06R-03 / D9: the app writes avatars as `avatar_<digits>.<ext>`. The name shape
// is the ownership guard, so a replace, remove, or Reset sweep never deletes a
// file the app did not write into the avatar directory.
export function isOwnedAvatarFile(file: string): boolean {
  return OWNED_AVATAR_PATTERN.test(file);
}

// D9 / S-06R-01: removes every owned avatar for Reset App and returns the real
// count. Guards on documentDirectory so an unavailable storage root is a no-op,
// never a delete.
export async function sweepOwnedProfileAvatars(): Promise<number> {
  if (!documentDirectory) return 0;
  const names = await readDirectoryAsync(PROFILE_AVATAR_DIR);
  const owned = names.filter(isOwnedAvatarFile);
  await Promise.all(owned.map(name => deleteAsync(PROFILE_AVATAR_DIR + name, { idempotent: true })));
  return owned.length;
}
