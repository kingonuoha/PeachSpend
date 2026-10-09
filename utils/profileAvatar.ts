import { documentDirectory } from 'expo-file-system/legacy';

// Avatar files are stored as an owned filename in the app document directory, the
// same place the onboarding and SH-05c flows write them. Kept in one module so the
// Profile hero and the edit sheet cannot drift on the storage path.
export const PROFILE_AVATAR_DIR = (documentDirectory || '') + 'profile_pics/';

export function resolveAvatarUri(file: string | null | undefined): string | null {
  return file && file.trim() ? PROFILE_AVATAR_DIR + file : null;
}
