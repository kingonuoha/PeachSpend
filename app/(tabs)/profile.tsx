import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import {
  AlertCircle,
  Camera,
  Check,
  ChevronRight,
  Flame,
  Pencil,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { BadgeGlyph } from '../../components/ui/BadgeGlyph';
import { BadgeDetailModal } from '../../components/ui/BadgeDetailModal';
import AchievementCelebration from '../../components/ui/AchievementCelebration';
import { EditProfileSheet } from '../../components/profile/EditProfileSheet';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency } from '../../utils/currency';
import { resolveAvatarUri } from '../../utils/profileAvatar';
import { profileDataService, settingsPort } from '../../services/DataServices';
import { setThemeMode, setThemePack } from '../../data/ThemePackContracts';
import type { AchievementState, ProfileSnapshot } from '../../data/ProfileContracts';

// S-05 Profile. Rebuilt as a replacement for the legacy screen: identity and
// progress read from the typed ProfileSnapshot, the edit affordance opens the one
// shared SH-05c sheet, and the theme-pack and light/dark axes swap tokens through
// the typed contracts. No screen SQL and no hardcoded financial or badge values.

function formatJoinDate(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatEarnedDate(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProfileScreen() {
  const ts = useThemeStyles();
  const router = useRouter();
  const { refreshSettings } = useSettings();

  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [reloading, setReloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<AchievementState | null>(null);
  const [celebrating, setCelebrating] = useState<AchievementState | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await profileDataService.getSnapshot();
    setSnapshot(next);
  }, []);

  useEffect(() => {
    let active = true;
    void profileDataService.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const retry = async () => {
    setReloading(true);
    await load();
    setReloading(false);
  };

  const handleSaved = async (result: { name: string; avatarFile: string | null }) => {
    setEditing(false);
    setSnapshot((prev) => (prev ? { ...prev, displayName: result.name, avatarFile: result.avatarFile } : prev));
    // Home and Chat read profile_name from settings; refresh the read model so the
    // saved name is consistent everywhere without a second writer.
    await refreshSettings();
  };

  const applyThemePack = async (id: string) => {
    if (themeBusy || !snapshot || snapshot.themePack.activePackId === id) return;
    setThemeBusy(true);
    try {
      const result = await setThemePack(settingsPort, id);
      if (result.status === 'saved') {
        setSnapshot((prev) => (prev ? { ...prev, themePack: result.state } : prev));
        await refreshSettings();
      }
    } finally {
      setThemeBusy(false);
    }
  };

  const applyThemeMode = async (mode: 'light' | 'dark') => {
    if (themeBusy) return;
    setThemeBusy(true);
    try {
      const state = await setThemeMode(settingsPort, mode);
      setSnapshot((prev) => (prev ? { ...prev, themePack: state } : prev));
      await refreshSettings();
    } finally {
      setThemeBusy(false);
    }
  };

  if (!snapshot) {
    return (
      <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={ts.raw.primary} />
          <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s3 }]}>
            Loading your profile
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const achievements = snapshot.achievements;
  const earnedCount = achievements.filter((badge) => badge.earned).length;
  const newestEarned = achievements
    .filter((badge) => badge.earned && badge.earnedAt !== null)
    .sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0))[0] ?? null;

  const avatarUri = resolveAvatarUri(snapshot.avatarFile);
  const initial = snapshot.displayName.trim() ? snapshot.displayName.trim().charAt(0).toUpperCase() : null;
  const joinLabel = formatJoinDate(snapshot.joinDate);
  const activePack = snapshot.themePack.packs.find((pack) => pack.id === snapshot.themePack.activePackId);
  const appVersion = Constants.expoConfig?.version;

  const statCards: { label: string; value: string }[] = [
    { label: 'Total Logged', value: String(snapshot.stats.transactionCount) },
    {
      label: 'Total Spend',
      value: snapshot.pricesVisible ? formatCurrency(snapshot.stats.totalExpenses, snapshot.stats.currency) : '••••',
    },
    { label: 'Receipts Scanned', value: String(snapshot.stats.scansCount) },
  ];

  if (snapshot.state === 'failure') {
    return (
      <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.s6 }}>
          <AlertCircle size={40} color={ts.raw.danger} />
          <Text style={[Typography.headlineMd, { color: ts.raw.onSurface, marginTop: Spacing.s4, textAlign: 'center' }]}>
            Could not load your profile
          </Text>
          <Text style={[Typography.bodyRegular, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s2, textAlign: 'center' }]}>
            Your data is on this device only. Try again.
          </Text>
          <View style={{ marginTop: Spacing.s5 }}>
            <PeachButton
              title="Retry"
              variant="primary"
              size="md"
              icon={<RefreshCw size={16} color="#FFFFFF" />}
              isLoading={reloading}
              onPress={retry}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Spacing.s8 }}
      >
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: Spacing.s5 }}>
          {/* Top bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.s4, paddingBottom: Spacing.s2 }}>
            <Text style={[Typography.headlineLg, { color: ts.raw.onSurface }]} accessibilityRole="header">
              Profile
            </Text>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={() => router.push('/settings')}
              hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
              style={{
                width: 40,
                height: 40,
                borderRadius: Radii.full,
                backgroundColor: ts.raw.surface,
                borderWidth: 1,
                borderColor: ts.raw.outline,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={20} color={ts.raw.onSurface} />
            </ScalePressable>
          </View>

          {/* Identity hero */}
          <View style={{ marginTop: Spacing.s2 }}>
            <LinearGradient
              colors={ts.isDark ? Gradients.dark : Gradients.light}
              locations={[0, 0.45, 1]}
              start={{ x: 0.33, y: 0 }}
              end={{ x: 0.67, y: 1 }}
              style={{ borderRadius: Radii.xl, padding: Spacing.s5, overflow: 'hidden' }}
            >
              <View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                style={{ position: 'absolute', right: -40, bottom: -40, width: 176, height: 176, borderRadius: 88, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
              />
              <View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                style={{ position: 'absolute', right: -16, bottom: -16, width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s4 }}>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile photo and name"
                  onPress={() => setEditing(true)}
                  style={{ position: 'relative' }}
                >
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: Radii.full,
                      overflow: 'hidden',
                      borderWidth: 4,
                      borderColor: 'rgba(255,255,255,0.30)',
                      backgroundColor: 'rgba(76,29,149,0.40)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : initial ? (
                      <Text style={[Typography.displayMd, { color: '#FFFFFF' }]}>{initial}</Text>
                    ) : (
                      <Camera size={28} color="rgba(255,255,255,0.85)" />
                    )}
                  </View>
                  <View
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 24,
                      height: 24,
                      borderRadius: Radii.full,
                      backgroundColor: '#FFFFFF',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    <Camera size={13} color="#17162A" />
                  </View>
                </ScalePressable>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s1 }}>
                    <Text
                      numberOfLines={1}
                      style={[Typography.headlineMd, { color: '#FFFFFF', flexShrink: 1 }]}
                    >
                      {snapshot.displayName || 'Add your name'}
                    </Text>
                    <ScalePressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit profile"
                      onPress={() => setEditing(true)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: Spacing.s1,
                        paddingHorizontal: Spacing.s2,
                        paddingVertical: 4,
                        borderRadius: Radii.full,
                        backgroundColor: 'rgba(255,255,255,0.20)',
                      }}
                    >
                      <Text style={[Typography.micro, { color: '#FFFFFF', fontFamily: 'Manrope_600SemiBold' }]}>Edit</Text>
                      <Pencil size={12} color="#FFFFFF" />
                    </ScalePressable>
                  </View>
                  {joinLabel ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, marginTop: Spacing.s2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full, backgroundColor: 'rgba(0,0,0,0.20)' }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#34D399' }} />
                        <Text style={[Typography.micro, { color: 'rgba(255,255,255,0.9)' }]}>
                          Member since {joinLabel}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Streak ribbon */}
              <View style={{ marginTop: Spacing.s4, paddingTop: Spacing.s3, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel={newestEarned ? 'View achievement celebration' : 'Streak progress'}
                  disabled={!newestEarned}
                  onPress={() => setCelebrating(newestEarned)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flex: 1, minWidth: 0 }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: Radii.full, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' }}>
                    <Flame size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Typography.labelBold, { color: '#FFFFFF' }]} numberOfLines={1}>
                      {snapshot.stats.streak > 0 ? `${snapshot.stats.streak} Day Streak` : 'Start a streak'}
                    </Text>
                    <Text style={[Typography.micro, { color: 'rgba(255,255,255,0.70)' }]} numberOfLines={1}>
                      {snapshot.stats.streak > 0
                        ? `Logged expenses ${snapshot.stats.streak} consecutive days`
                        : 'Log an expense to begin your streak'}
                    </Text>
                  </View>
                </ScalePressable>
                {newestEarned ? (
                  <ScalePressable
                    accessibilityRole="button"
                    accessibilityLabel="View achievement"
                    onPress={() => setCelebrating(newestEarned)}
                    style={{ paddingHorizontal: Spacing.s2, paddingVertical: 4 }}
                  >
                    <Text style={[Typography.micro, { color: '#FFFFFF', fontFamily: 'Manrope_600SemiBold', textDecorationLine: 'underline' }]}>
                      View
                    </Text>
                  </ScalePressable>
                ) : null}
              </View>
            </LinearGradient>
          </View>

          {/* Real aggregate stats */}
          <View style={{ marginTop: Spacing.s4 }}>
            <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
              {statCards.map((stat) => (
                <LuminousCard
                  key={stat.label}
                  variant="high"
                  style={{ flex: 1, minWidth: 0, paddingVertical: Spacing.s4, paddingHorizontal: Spacing.s2, alignItems: 'center' }}
                >
                  <Text
                    numberOfLines={2}
                    style={[Typography.micro, { color: ts.raw.onSurfaceVariant, fontFamily: 'Manrope_700Bold', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }]}
                  >
                    {stat.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    style={[Typography.headlineMd, { color: ts.raw.onSurface, marginTop: Spacing.s1 }]}
                  >
                    {stat.value}
                  </Text>
                </LuminousCard>
              ))}
            </View>
          </View>

          {/* Spending recap entry (S-23) */}
          <View style={{ marginTop: Spacing.s4 }}>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Open weekly and monthly recap"
              onPress={() => router.push({ pathname: '/spending-recap', params: { origin: 'profile' } } as never)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderRadius: Radii.lg,
                borderWidth: 1,
                borderColor: ts.raw.primary + '44',
                backgroundColor: ts.raw.primary + '14',
                padding: Spacing.s4,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 }}>
                <View style={{ width: 36, height: 36, borderRadius: Radii.sm, backgroundColor: ts.raw.primary + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={18} color={ts.raw.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]} numberOfLines={1}>
                    Weekly &amp; Monthly Recap
                  </Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                    Read narrative insights and budget breakdown
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color={ts.raw.primary} />
            </ScalePressable>
          </View>

          {/* Badges and milestones (SH-05a) */}
          <View style={{ marginTop: Spacing.s5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 }}>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Badges &amp; Milestones</Text>
                <View style={{ paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full, backgroundColor: ts.raw.primary + '18', borderWidth: 1, borderColor: ts.raw.primary + '33' }}>
                  <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_700Bold' }]}>
                    {earnedCount} / {achievements.length} Unlocked
                  </Text>
                </View>
              </View>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Tap badge for detail</Text>
            </View>

            {achievements.length === 0 ? (
              <LuminousCard variant="high" style={{ alignItems: 'center', paddingVertical: Spacing.s6 }}>
                <Text style={[Typography.bodyRegular, { color: ts.raw.onSurfaceVariant, textAlign: 'center' }]}>
                  No badges available yet.
                </Text>
              </LuminousCard>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2 }}>
                {achievements.map((badge) => {
                  const earnedLabel = formatEarnedDate(badge.earnedAt);
                  // The canonical pair rings the most recently earned badge with
                  // amber-400/40 (HTML line 358) to flag the newest milestone.
                  const isNewest = badge.id === newestEarned?.id;
                  return (
                    <ScalePressable
                      key={badge.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${badge.label}, ${badge.earned ? 'earned' : `progress ${badge.progress.current} of ${badge.progress.target}`}`}
                      onPress={() => setSelectedBadge(badge)}
                      style={{
                        flexBasis: '30%',
                        flexGrow: 1,
                        minWidth: 84,
                        borderRadius: Radii.lg,
                        borderWidth: 1,
                        borderStyle: badge.earned ? 'solid' : 'dashed',
                        borderColor: isNewest ? ts.raw.warning + '66' : ts.raw.outline,
                        backgroundColor: badge.earned ? ts.raw.surface : 'transparent',
                        padding: Spacing.s3,
                        alignItems: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: Radii.full,
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: Spacing.s2,
                          backgroundColor: badge.earned ? ts.raw.primary + '22' : ts.bg.low,
                        }}
                      >
                        <View style={{ opacity: badge.earned ? 1 : 0.4 }}>
                          <BadgeGlyph name={badge.icon} size={22} color={badge.earned ? ts.raw.primary : ts.raw.onSurfaceVariant} />
                        </View>
                      </View>
                      <Text
                        numberOfLines={2}
                        style={[Typography.micro, { color: ts.raw.onSurface, fontFamily: 'Manrope_700Bold', textAlign: 'center' }]}
                      >
                        {badge.label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[Typography.micro, { color: badge.earned ? ts.raw.successText : ts.raw.onSurfaceVariant, marginTop: 2, textAlign: 'center' }]}
                      >
                        {badge.earned ? (earnedLabel ? `Earned ${earnedLabel}` : 'Earned') : `${badge.progress.current} / ${badge.progress.target}`}
                      </Text>
                    </ScalePressable>
                  );
                })}
              </View>
            )}
            {earnedCount === 0 && achievements.length > 0 ? (
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s3 }]}>
                No badges earned yet. Log an expense to start unlocking milestones.
              </Text>
            ) : null}
          </View>

          {/* Theme pack switcher (FR-05.5) */}
          <View style={{ marginTop: Spacing.s5 }}>
            <LuminousCard variant="high">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
                  <Sparkles size={16} color={ts.raw.primary} />
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>App Theme Pack</Text>
                </View>
                <Text style={[Typography.labelMd, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]} numberOfLines={1}>
                  {activePack?.label ?? snapshot.themePack.activePackId}
                  {activePack?.isDefault ? ' (Default)' : ''}
                </Text>
              </View>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginBottom: Spacing.s3 }]}>
                Swapping packs instantly switches token colors without changing your Light or Dark Mode choice.
              </Text>

              <View accessibilityRole="radiogroup" accessibilityLabel="App theme pack" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2 }}>
                {snapshot.themePack.packs.map((pack) => {
                  const selected = pack.id === snapshot.themePack.activePackId;
                  return (
                    <ScalePressable
                      key={pack.id}
                      accessibilityRole="radio"
                      accessibilityLabel={pack.label}
                      accessibilityState={{ selected }}
                      disabled={themeBusy}
                      onPress={() => applyThemePack(pack.id)}
                      style={{
                        flexBasis: '22%',
                        flexGrow: 1,
                        minWidth: 64,
                        borderRadius: Radii.sm,
                        borderWidth: 2,
                        borderColor: selected ? ts.raw.primary : ts.raw.outline,
                        backgroundColor: ts.bg.low,
                        paddingVertical: Spacing.s2,
                        alignItems: 'center',
                        gap: Spacing.s1,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: Radii.full,
                          backgroundColor: selected ? snapshot.themePack.palette.primary : ts.raw.surfaceContainerHighest,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {selected ? <Check size={14} color="#FFFFFF" /> : null}
                      </View>
                      <Text style={[Typography.micro, { color: ts.raw.onSurface, fontFamily: 'Manrope_700Bold' }]} numberOfLines={1}>
                        {pack.label}
                      </Text>
                    </ScalePressable>
                  );
                })}
              </View>

              <View style={{ marginTop: Spacing.s4, paddingTop: Spacing.s3, borderTopWidth: 1, borderTopColor: ts.raw.outline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
                  <Text style={[Typography.labelMd, { color: ts.raw.onSurface, fontFamily: 'Manrope_600SemiBold' }]}>Appearance Mode</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>(Independent)</Text>
                </View>
                <View accessibilityRole="radiogroup" accessibilityLabel="Appearance mode" style={{ flexDirection: 'row', backgroundColor: ts.bg.low, borderWidth: 1, borderColor: ts.raw.outline, borderRadius: Radii.sm, padding: 2 }}>
                  {(['light', 'dark'] as const).map((mode) => {
                    const selected = snapshot.themePack.mode === mode;
                    return (
                      <ScalePressable
                        key={mode}
                        accessibilityRole="button"
                        accessibilityLabel={mode === 'light' ? 'Light mode' : 'Dark mode'}
                        accessibilityState={{ selected }}
                        disabled={themeBusy}
                        onPress={() => applyThemeMode(mode)}
                        hitSlop={{ top: 6, bottom: 6 }}
                        style={{
                          paddingHorizontal: Spacing.s3,
                          paddingVertical: Spacing.s1,
                          borderRadius: Radii.sm,
                          backgroundColor: selected ? ts.raw.surface : 'transparent',
                        }}
                      >
                        <Text
                          style={[
                            Typography.micro,
                            {
                              color: selected ? ts.raw.onSurface : ts.raw.onSurfaceVariant,
                              fontFamily: selected ? 'Manrope_700Bold' : 'Manrope_500Medium',
                            },
                          ]}
                        >
                          {mode === 'light' ? 'Light' : 'Dark'}
                        </Text>
                      </ScalePressable>
                    );
                  })}
                </View>
              </View>
            </LuminousCard>
          </View>

          {/* Settings route (S-06) */}
          <View style={{ marginTop: Spacing.s4 }}>
            <LuminousCard variant="high" style={{ padding: 0 }}>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="App Settings"
                onPress={() => router.push('/settings')}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.s4 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 }}>
                  <View style={{ width: 32, height: 32, borderRadius: Radii.sm, backgroundColor: ts.raw.primary + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Settings size={16} color={ts.raw.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>App Settings</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                      Budget, AI providers, categories and stewardship (S-06)
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color={ts.raw.onSurfaceVariant} />
              </ScalePressable>
              <View style={{ height: 1, backgroundColor: ts.raw.outline }} />
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Security and Privacy"
                onPress={() => router.push('/privacy-policy')}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.s4 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 }}>
                  <View style={{ width: 32, height: 32, borderRadius: Radii.sm, backgroundColor: ts.raw.successText + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <ShieldCheck size={16} color={ts.raw.successText} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Security &amp; Biometrics</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                      Face ID lock, local ledger and zero cloud telemetry
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color={ts.raw.onSurfaceVariant} />
              </ScalePressable>
            </LuminousCard>
          </View>

          {/* Version footer */}
          <View style={{ marginTop: Spacing.s5, alignItems: 'center' }}>
            {appVersion ? (
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>PeachSpend v{appVersion}</Text>
            ) : null}
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: 2, textAlign: 'center' }]}>
              Your financial data stays on device
            </Text>
          </View>
        </View>
      </ScrollView>

      {editing ? (
        <EditProfileSheet
          initialName={snapshot.displayName}
          initialAvatarFile={snapshot.avatarFile}
          initialAvatarUri={avatarUri}
          memberSince={snapshot.joinDate}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
        />
      ) : null}
      <BadgeDetailModal
        visible={selectedBadge !== null}
        badge={selectedBadge}
        currentStreak={snapshot.stats.streak}
        onClose={() => setSelectedBadge(null)}
      />

      {celebrating ? (
        <AchievementCelebration
          key={celebrating.id}
          achievement={celebrating}
          currentStreak={snapshot.stats.streak}
          onDismiss={() => setCelebrating(null)}
          onViewDetails={(badge) => {
            setCelebrating(null);
            setSelectedBadge(badge);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
