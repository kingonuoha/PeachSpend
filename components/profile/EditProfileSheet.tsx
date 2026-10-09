import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { makeDirectoryAsync, copyAsync } from 'expo-file-system/legacy';
import { AlertCircle, Calendar, Camera, Trash2, User, X } from 'lucide-react-native';

import { PeachButton } from '../ui/PeachButton';
import { ScalePressable } from '../ui/ScalePressable';
import { LuminousCard } from '../ui/LuminousCard';
import { useToast } from '../ui/ToastProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { PROFILE_AVATAR_DIR } from '../../utils/profileAvatar';
import { settingsPort, saveProfileEdit } from '../../services/DataServices';
import type { ProfileEditDraft } from '../../services/DataServices';
import { PROFILE_NAME_MAX_LENGTH } from '../../data/ProfileContracts';

// Canonical SH-05c Edit Profile sheet (FR-05.4, FR-06.3). This is the single
// profile-identity editor: Profile and Settings both mount this exact component
// and it saves through the typed boundary, never SQL. Rebuilt as a replacement
// for the E1 stub so it matches the locked pair: header with subtitle, camera
// badge and monogram fallback, counter and inline validation, keyboard-safe
// scroll body, member-since reference, and the two 48pt actions.
export interface EditProfileSheetProps {
  initialName: string;
  initialAvatarFile: string | null;
  initialAvatarUri: string | null;
  // Real join date from the caller's ProfileSnapshot. The reference row renders
  // only when a timestamp exists, so no member-since value is ever fabricated.
  memberSince?: number | null;
  onClose: () => void;
  onSaved: (result: { name: string; avatarFile: string | null }) => void;
}

// Canonical counter and input cap (code.html line 221 maxlength="32", counter
// line 218). The data boundary independently enforces PROFILE_NAME_MAX_LENGTH;
// the UI cap is the stricter of the two so the visible counter can never exceed
// the locked sheet.
const CANONICAL_NAME_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = Math.min(PROFILE_NAME_MAX_LENGTH, CANONICAL_NAME_MAX_LENGTH);

const AVATAR_SIZE = 88;
const CAMERA_BADGE_SIZE = 32; // html 192-195 visual size; hitSlop reaches 44pt
const CLOSE_SIZE = 32; // html 176 visual size; hitSlop reaches 44pt
const HANDLE_WIDTH = Spacing.s9; // html 169 w-12
const HANDLE_HEIGHT = 6; // html 169 h-1.5, no spacing token at 6
const INPUT_HEIGHT = 48; // html 221 h-12

type SaveState = 'idle' | 'saving';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '';
}

function errorCopy(reason: 'empty' | 'too_long'): string {
  return reason === 'too_long'
    ? `Display name must be ${NAME_MAX_LENGTH} characters or fewer.`
    : 'Display name cannot be empty.';
}

export function EditProfileSheet({
  initialName,
  initialAvatarFile,
  initialAvatarUri,
  memberSince,
  onClose,
  onSaved,
}: EditProfileSheetProps) {
  const ts = useThemeStyles();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // The parent mounts this sheet only while it is open, so the props are the
  // fresh draft for that opening. No resync effect is needed.
  const [name, setName] = useState(initialName);
  const [avatarFile, setAvatarFile] = useState<string | null>(initialAvatarFile);
  const [avatarUri, setAvatarUri] = useState<string | null>(initialAvatarUri);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const saving = saveState === 'saving';
  const initials = initialsOf(name);
  const memberSinceLabel = memberSince
    ? new Date(memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  const handleNameChange = (text: string) => {
    setName(text);
    const trimmed = text.trim();
    if (!trimmed) setError(errorCopy('empty'));
    else if (trimmed.length > NAME_MAX_LENGTH) setError(errorCopy('too_long'));
    else setError(null);
  };

  const pickPhoto = async () => {
    if (saving) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is off. Enable it in system settings to use a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const uri = result.assets[0].uri;
    const ext = uri.split('.').pop() || 'jpg';
    const filename = `avatar_${Date.now()}.${ext}`;
    try {
      await makeDirectoryAsync(PROFILE_AVATAR_DIR, { intermediates: true });
      await copyAsync({ from: uri, to: PROFILE_AVATAR_DIR + filename });
      setAvatarFile(filename);
      setAvatarUri(PROFILE_AVATAR_DIR + filename);
      setError(null);
    } catch {
      setError('Could not save that photo. Try another image.');
    }
  };

  const removePhoto = () => {
    if (saving) return;
    setAvatarFile(null);
    setAvatarUri(null);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(errorCopy('empty'));
      return;
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      setError(errorCopy('too_long'));
      return;
    }

    setSaveState('saving');
    setError(null);
    const draft: ProfileEditDraft = { name: trimmed, avatarFile };
    try {
      const result = await saveProfileEdit(settingsPort, draft);
      if (result.status === 'invalid') {
        setSaveState('idle');
        setError(errorCopy(result.reason));
        return;
      }
      setSaveState('idle');
      showToast('Profile updated', 'success');
      onSaved({
        name: result.name,
        avatarFile: result.avatarFile && result.avatarFile.trim() ? result.avatarFile : null,
      });
    } catch {
      setSaveState('idle');
      setError('Could not save your profile. Please try again.');
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close edit profile"
          onPress={() => {
            if (!saving) onClose();
          }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: ts.bg.overlay }}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
              maxHeight: Math.min(height * 0.9, 760),
              backgroundColor: ts.raw.surface,
              borderTopLeftRadius: Radii.xxl,
              borderTopRightRadius: Radii.xxl,
              borderTopWidth: 1,
              borderColor: ts.raw.outline,
              paddingTop: Spacing.s5,
              paddingBottom: Math.max(insets.bottom, Spacing.s3) + Spacing.s5,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: 0.5,
              shadowRadius: 24,
              elevation: 24,
              overflow: 'hidden',
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: Spacing.s5, paddingBottom: Spacing.s2 }}
            >
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: HANDLE_WIDTH,
                  height: HANDLE_HEIGHT,
                  borderRadius: Radii.full,
                  backgroundColor: ts.raw.onSurfaceVariant + '66',
                  alignSelf: 'center',
                  marginBottom: Spacing.s4,
                }}
              />

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: Spacing.s3,
                  marginBottom: Spacing.s4,
                  borderBottomWidth: 1,
                  borderBottomColor: ts.raw.outline,
                }}
              >
                <View style={{ flex: 1, minWidth: 0, paddingRight: Spacing.s3 }}>
                  <Text
                    accessibilityRole="header"
                    numberOfLines={1}
                    style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
                  >
                    Edit Profile
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: 2 }]}
                  >
                    Update your avatar and display name
                  </Text>
                </View>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="Close edit profile"
                  haptic={false}
                  disabled={saving}
                  onPress={onClose}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={{
                    width: CLOSE_SIZE,
                    height: CLOSE_SIZE,
                    borderRadius: Radii.full,
                    backgroundColor: ts.bg.card,
                    borderWidth: 1,
                    borderColor: ts.raw.outline,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={16} color={ts.raw.onSurfaceVariant} />
                </ScalePressable>
              </View>

              {/* Avatar: photo, monogram fallback, or empty-identity icon */}
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
                  <View
                    style={{
                      width: AVATAR_SIZE,
                      height: AVATAR_SIZE,
                      borderRadius: Radii.full,
                      overflow: 'hidden',
                      borderWidth: 2,
                      borderColor: ts.raw.primary + '99',
                      backgroundColor: ts.bg.low,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: ts.raw.primary,
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 12,
                      elevation: 4,
                    }}
                  >
                    {avatarUri ? (
                      <Image
                        source={{ uri: avatarUri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                        accessibilityIgnoresInvertColors
                      />
                    ) : initials ? (
                      <LinearGradient
                        colors={ts.isDark ? Gradients.dark : Gradients.light}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                          style={[Typography.displayMd, { color: '#FFFFFF', letterSpacing: 1 }]}
                        >
                          {initials}
                        </Text>
                      </LinearGradient>
                    ) : (
                      <User size={36} color={ts.raw.primary} />
                    )}
                  </View>
                  <ScalePressable
                    accessibilityRole="button"
                    accessibilityLabel="Change profile photo"
                    disabled={saving}
                    onPress={pickPhoto}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: CAMERA_BADGE_SIZE,
                      height: CAMERA_BADGE_SIZE,
                      borderRadius: Radii.full,
                      backgroundColor: ts.raw.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: ts.raw.surface,
                    }}
                  >
                    <Camera size={15} color="#FFFFFF" />
                  </ScalePressable>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    gap: Spacing.s2,
                    marginTop: Spacing.s3,
                  }}
                >
                  <PeachButton
                    title="Choose photo"
                    variant="secondary"
                    size="xs"
                    icon={<Camera size={14} color={ts.raw.primary} />}
                    disabled={saving}
                    onPress={pickPhoto}
                  />
                  {avatarUri ? (
                    <PeachButton
                      title="Remove"
                      variant="destructive"
                      size="xs"
                      icon={<Trash2 size={14} color={ts.raw.danger} />}
                      disabled={saving}
                      onPress={removePhoto}
                    />
                  ) : null}
                </View>
              </View>

              {/* Display name field */}
              <View style={{ marginTop: Spacing.s4 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: Spacing.s2,
                  }}
                >
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Display Name</Text>
                  <Text
                    style={[
                      Typography.micro,
                      { color: ts.raw.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold' },
                    ]}
                  >
                    {name.length} / {NAME_MAX_LENGTH}
                  </Text>
                </View>
                <View style={{ position: 'relative', justifyContent: 'center' }}>
                  <TextInput
                    value={name}
                    onChangeText={handleNameChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onSubmitEditing={save}
                    returnKeyType="done"
                    maxLength={NAME_MAX_LENGTH}
                    autoCapitalize="words"
                    editable={!saving}
                    accessibilityLabel="Display name"
                    placeholder="e.g. Ariana Marnisa"
                    placeholderTextColor={ts.text.onSurfaceVariant60}
                    style={[
                      Typography.bodyMd,
                      {
                        height: INPUT_HEIGHT,
                        color: ts.raw.onSurface,
                        backgroundColor: ts.bg.card,
                        borderColor: error ? ts.raw.danger : focused ? ts.raw.primary : ts.raw.outline,
                        borderWidth: focused || error ? 1.5 : 1,
                        borderRadius: Radii.md,
                        paddingLeft: Spacing.s4,
                        paddingRight: name.length > 0 ? Spacing.s9 : Spacing.s4,
                      },
                    ]}
                  />
                  {name.length > 0 ? (
                    <ScalePressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear display name"
                      haptic={false}
                      disabled={saving}
                      onPress={() => handleNameChange('')}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      style={{
                        position: 'absolute',
                        top: 14,
                        right: Spacing.s3,
                        width: 20,
                        height: 20,
                        borderRadius: Radii.full,
                        backgroundColor: ts.raw.onSurfaceVariant + '4D',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={12} color="#FFFFFF" />
                    </ScalePressable>
                  ) : null}
                </View>
                {error ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, marginTop: Spacing.s2 }}
                  >
                    <AlertCircle size={14} color={ts.raw.danger} />
                    <Text style={[Typography.labelMd, { color: ts.raw.danger, flexShrink: 1 }]}>{error}</Text>
                  </View>
                ) : null}
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s2 }]}>
                  This name will appear on your monthly receipts, insights recaps, and AI financial summaries.
                </Text>
              </View>

              {/* Read-only join-date reference, rendered only for a real date. */}
              {memberSinceLabel ? (
                <LuminousCard
                  variant="high"
                  style={{
                    marginTop: Spacing.s4,
                    padding: Spacing.s3,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.s2,
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: Radii.sm,
                      backgroundColor: ts.bg.primary10,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Calendar size={13} color={ts.raw.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Member Since</Text>
                    <Text
                      numberOfLines={1}
                      style={[Typography.labelBold, { color: ts.raw.onSurface }]}
                    >
                      {memberSinceLabel}
                    </Text>
                  </View>
                </LuminousCard>
              ) : null}

              {/* Actions: Cancel + Save Changes, 48pt-class targets */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, marginTop: Spacing.s6 }}>
                <View style={{ flex: 1 }}>
                  <PeachButton
                    title="Cancel"
                    variant="quiet"
                    size="lg"
                    fullWidth
                    disabled={saving}
                    onPress={onClose}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PeachButton
                    title={saving ? 'Saving...' : 'Save Changes'}
                    variant="primary"
                    size="lg"
                    fullWidth
                    isLoading={saving}
                    onPress={save}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
