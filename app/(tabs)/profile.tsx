import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { documentDirectory, makeDirectoryAsync, copyAsync, getInfoAsync } from 'expo-file-system/legacy';
import { useExpenses } from '../../hooks/useExpenses';
import { Colors } from '../../constants/tokens';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { User, ShieldCheck, LogOut, Settings, Bell, HelpCircle, ChevronRight, Camera, Check, X, Pencil } from 'lucide-react-native';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { databaseService } from '../../services/DatabaseService';
import { BadgeDetailModal } from '../../components/ui/BadgeDetailModal';

const PROFILE_DIR = (documentDirectory || '') + 'profile_pics/';

export default function ProfileScreen() {
  const { expenses } = useExpenses();
  const { settings, getCurrencySymbol, convertAmount, updateSetting } = useSettings();
  const { colors } = useTheme();
  const styles = useThemeStyles();
  const pricesVisible = settings.prices_visible !== 'false';
  const router = useRouter();

  const [editingField, setEditingField] = useState<'name' | 'username' | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);

  const displayName = settings.profile_name || 'Peach User';
  const displayUsername = settings.profile_username || '';

  useEffect(() => {
    const pic = settings.profile_picture;
    if (pic) {
      const path = PROFILE_DIR + pic;
      getInfoAsync(path).then((info) => {
        if (info.exists) setProfileImageUri(path);
      }).catch(() => {});
    }
  }, [settings.profile_picture]);

  const [badgeProgress, setBadgeProgress] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const streakScale = useSharedValue(0);
  const [selectedBadge, setSelectedBadge] = useState<any>(null);
  const [showBadgeModal, setShowBadgeModal] = useState(false);

  useEffect(() => {
    const loadBadges = async () => {
      const [progress, streakCount] = await Promise.all([
        databaseService.getBadgeProgress(),
        databaseService.getStreak(),
      ]);
      setBadgeProgress(progress);
      setStreak(streakCount);
      streakScale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    };
    loadBadges();
  }, []);

  const badgeMeta: Record<string, { label: string; description: string; icon: string }> = {
    first_step: { label: 'First Step', description: 'First expense logged', icon: '🌱' },
    eagle_eye: { label: 'Eagle Eye', description: 'First receipt scanned', icon: '📸' },
    on_repeat: { label: 'On Repeat', description: 'First recurring expense', icon: '🔁' },
    week_warrior: { label: 'Week Warrior', description: '7-day streak', icon: '🔥' },
    month_master: { label: 'Month Master', description: '30-day streak', icon: '💎' },
    paper_trail: { label: 'Paper Trail', description: 'First CSV export', icon: '📤' },
    detail_devil: { label: 'Detail Devil', description: 'First note or tag', icon: '🏷️' },
    'getting-started': { label: 'Getting Started', description: '5 expenses logged', icon: '🚀' },
    regular: { label: 'Regular', description: '25 expenses logged', icon: '📊' },
    century: { label: 'Century', description: '100 expenses logged', icon: '💯' },
    'sneak-peek': { label: 'Sneak Peek', description: '3 receipts scanned', icon: '👀' },
    shutterbug: { label: 'Shutterbug', description: '15 receipts scanned', icon: '📷' },
    'scanner-king': { label: 'Scanner King', description: '50 receipts scanned', icon: '👑' },
    fortnight: { label: 'Fortnight', description: '14-day streak', icon: '🌙' },
    season: { label: 'Season', description: '60-day streak', icon: '🍂' },
    'half-year-hero': { label: 'Half-Year Hero', description: '180-day streak', icon: '⚡' },
    variety: { label: 'Variety', description: '3 categories used', icon: '🎨' },
    explorer: { label: 'Explorer', description: '5 categories used', icon: '🗺️' },
    completionist: { label: 'Completionist', description: 'All 8 categories used', icon: '🏆' },
    saver: { label: 'Saver', description: 'Single expense ≤ $3', icon: '🐷' },
    shopper: { label: 'Shopper', description: '$1,000 total spent', icon: '🛍️' },
    'big-league': { label: 'Big League', description: '$10,000 total spent', icon: '💰' },
    habit: { label: 'Habit', description: '2 recurring expenses', icon: '♻️' },
    loyalist: { label: 'Loyalist', description: '5 recurring expenses', icon: '🏅' },
    novelist: { label: 'Novelist', description: '5 expenses with notes', icon: '📝' },
    'on-track': { label: 'On Track', description: '7-day budget streak', icon: '📈' },
    disciplined: { label: 'Disciplined', description: '30-day budget streak', icon: '🧘' },
  };

  const badgePrerequisites: Record<string, string | null> = {
    first_step: null, eagle_eye: null, on_repeat: null, paper_trail: null, detail_devil: null,
    week_warrior: null, month_master: null,
    'getting-started': 'first_step', regular: 'getting-started', century: 'regular',
    'sneak-peek': 'eagle_eye', shutterbug: 'sneak-peek', 'scanner-king': 'shutterbug',
    fortnight: 'week_warrior', season: 'fortnight', 'half-year-hero': 'season',
    variety: 'first_step', explorer: 'variety', completionist: 'explorer',
    saver: 'first_step', shopper: 'first_step', 'big-league': 'shopper',
    habit: 'on_repeat', loyalist: 'habit', novelist: 'detail_devil',
    'on-track': 'first_step', disciplined: 'on-track',
  };

  const handleBadgePress = (badge: any) => {
    setSelectedBadge(badge);
    setShowBadgeModal(true);
  };

  const totalSpent = expenses.reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
  const scannedCount = expenses.filter(e => e.scanned).length;

  const handlePickImage = async () => {
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
      await makeDirectoryAsync(PROFILE_DIR, { intermediates: true });
      await copyAsync({ from: uri, to: PROFILE_DIR + filename });
      await updateSetting('profile_picture', filename);
      setProfileImageUri(PROFILE_DIR + filename);
    } catch (err) {
      Alert.alert('Error', 'Failed to save profile picture');
    }
  };

  const saveName = async () => {
    if (nameDraft.trim()) {
      await updateSetting('profile_name', nameDraft.trim());
    }
    setEditingField(null);
  };

  const saveUsername = async () => {
    if (usernameDraft.trim()) {
      await updateSetting('profile_username', usernameDraft.trim());
    }
    setEditingField(null);
  };

  const startEditName = () => {
    setNameDraft(displayName);
    setEditingField('name');
  };

  const startEditUsername = () => {
    setUsernameDraft(displayUsername);
    setEditingField('username');
  };

  return (
    <SafeAreaView style={{ backgroundColor: styles.bg.screen, flex: 1 }} edges={['top', 'bottom']}>
      <Animated.ScrollView
        entering={FadeIn.duration(600)}
        className="flex-1"
        showsVerticalScrollIndicator={false}
      >
        <View className="px-6 pt-10 pb-12 items-center">
          {/* Profile Picture */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(800).springify()}
          >
            <TouchableOpacity onPress={handlePickImage} activeOpacity={0.8}>
              <View
                style={{ borderColor: styles.border.primary20 }}
                className="w-28 h-28 rounded-[40px] bg-primary/10 items-center justify-center mb-6 overflow-hidden"
              >
                {profileImageUri ? (
                  <Image source={{ uri: profileImageUri }} className="w-full h-full" resizeMode="cover" />
                ) : (
                  <User size={56} color={Colors.primary} />
                )}
                <View className="absolute inset-0 bg-black/30 items-center justify-center opacity-0 active:opacity-100">
                  <Camera size={24} color="white" />
                </View>
              </View>
              <View
                style={{ backgroundColor: styles.bg.screen, borderColor: styles.border.card }}
                className="absolute -bottom-1 right-1 w-8 h-8 rounded-full border-2 items-center justify-center"
              >
                <Camera size={14} color={Colors.primary} />
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Name */}
          <Animated.View entering={FadeInDown.delay(300).duration(800).springify()} className="items-center mb-1">
            {editingField === 'name' ? (
              <View className="flex-row items-center">
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  style={{ color: styles.text.onSurface, borderBottomColor: styles.border.card, borderBottomWidth: 1 }}
                  className="text-3xl font-noto-serif-bold tracking-tight text-center"
                />
                <TouchableOpacity onPress={saveName} className="ml-2 p-1">
                  <Check size={20} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditingField(null)} className="ml-1 p-1">
                  <X size={20} color={styles.icon.muted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={startEditName} className="flex-row items-center">
                <Text style={{ color: styles.text.onSurface }} className="text-3xl font-noto-serif-bold tracking-tight">
                  {displayName}
                </Text>
                <Pencil size={16} color={styles.icon.muted} style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            )}
          </Animated.View>

          {/* Username */}
          <Animated.View entering={FadeInDown.delay(350).duration(800).springify()}>
            {editingField === 'username' ? (
              <View className="flex-row items-center mt-2">
                <TextInput
                  value={usernameDraft}
                  onChangeText={setUsernameDraft}
                  autoFocus
                  style={{ color: styles.text.onSurfaceVariant60, borderBottomColor: styles.border.card, borderBottomWidth: 1 }}
                  className="font-manrope-medium text-sm text-center"
                  placeholder="@username"
                  placeholderTextColor={styles.text.onSurfaceVariant40}
                />
                <TouchableOpacity onPress={saveUsername} className="ml-2 p-1">
                  <Check size={16} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditingField(null)} className="ml-1 p-1">
                  <X size={16} color={styles.icon.muted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={startEditUsername} className="flex-row items-center mt-2">
                <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.card }} className="px-3 py-1 rounded-full border flex-row items-center">
                  <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-xs">
                    {displayUsername || '@add_username'}
                  </Text>
                  <Pencil size={12} color={styles.icon.muted} style={{ marginLeft: 6 }} />
                </View>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>

        {/* Stats Grid */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(800).springify()}
          className="flex-row px-6 mb-12"
        >
          <LuminousCard className="flex-1 mr-3 p-6 items-center" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
            <Text className="text-onSurfaceVariant text-[10px] uppercase tracking-[2px] font-manrope-bold mb-3">Total Flow</Text>
            <View className="flex-row items-baseline">
              {pricesVisible && <Text className="text-primary font-noto-serif-bold text-sm mr-1">{getCurrencySymbol()}</Text>}
              <Text style={{ color: styles.text.onSurface }} className="text-2xl font-noto-serif-bold tracking-tighter">
                {pricesVisible ? totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '••••'}
              </Text>
            </View>
          </LuminousCard>
          <LuminousCard className="flex-1 ml-3 p-6 items-center" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
            <Text className="text-onSurfaceVariant text-[10px] uppercase tracking-[2px] font-manrope-bold mb-3">Neural Scans</Text>
            <Text style={{ color: styles.text.onSurface }} className="text-2xl font-noto-serif-bold tracking-tighter">{scannedCount}</Text>
          </LuminousCard>
        </Animated.View>

        {/* Achievements & Streak */}
        <Animated.View entering={FadeInDown.delay(500).duration(800).springify()} className="px-6 mb-8">
          <View className="flex-row items-center mb-5">
            {streak > 0 && (
              <Animated.View style={[{ transform: [{ scale: streakScale }] }, { backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '30', borderWidth: 1 }]} className="flex-row items-center px-4 py-2 rounded-full mr-3">
                <Image source={require('../../assets/images/flameheart-emoji.gif')} style={{ width: 18, height: 18 }} resizeMode="contain" />
                <Text style={{ color: Colors.primary }} className="font-manrope-bold text-sm ml-1.5">{streak} day streak</Text>
              </Animated.View>
            )}
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[2px]">Achievements</Text>
          </View>

          <View className="flex-row flex-wrap">
            {(() => {
              const earnedIds = new Set(badgeProgress.filter(b => b.earned_at).map(b => b.id));
              const visible = badgeProgress.filter(badge => {
                const prereq = badgePrerequisites[badge.id];
                if (!prereq) return true;
                return earnedIds.has(prereq) || badge.earned_at !== null;
              });
              return visible.map((badge) => {
                const meta = badgeMeta[badge.id];
                if (!meta) return null;
                const earned = badge.earned_at !== null;
                return (
                  <TouchableOpacity key={badge.id} className="w-1/4 items-center mb-4" activeOpacity={0.6} onPress={() => handleBadgePress(badge)}>
                    <View
                      style={{
                        backgroundColor: earned ? Colors.primary + '20' : 'rgba(255,255,255,0.03)',
                        borderColor: earned ? Colors.primary + '30' : 'rgba(255,255,255,0.06)',
                        borderWidth: 1,
                        width: 56,
                        height: 56,
                        borderRadius: 20,
                      }}
                      className="items-center justify-center mb-1"
                    >
                      <Text style={{ fontSize: 24, opacity: earned ? 1 : 0.3 }}>{meta.icon}</Text>
                    </View>
                    <Text
                      style={{ color: earned ? Colors.primary : styles.text.onSurfaceVariant60 }}
                      className="font-manrope-bold text-[9px] text-center uppercase tracking-wider"
                      numberOfLines={1}
                    >
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                );
              });
            })()}
          </View>
        </Animated.View>

        {/* Menu Sections */}
        <View className="px-6 pb-20">
          <SectionHeader title="Preferences" />
          <MenuItem
            icon={<Settings size={20} color={styles.icon.default} />}
            label="App Settings"
            onPress={() => router.push('/settings')}
          />
          <MenuItem
            icon={<Bell size={20} color={styles.icon.default} />}
            label="Notifications"
          />

          <View className="mt-8">
            <SectionHeader title="Security & Help" />
            <MenuItem
              icon={<ShieldCheck size={20} color={styles.icon.default} />}
              label="Privacy Policy"
              onPress={() => router.push('/privacy-policy')}
            />
            <MenuItem
              icon={<HelpCircle size={20} color={styles.icon.default} />}
              label="Support Center"
              onPress={() => router.push('/support-center')}
            />
          </View>

          <TouchableOpacity style={{ backgroundColor: styles.bg.error5, borderColor: styles.border.error20, borderWidth: 1 }} className="mt-12 py-5 rounded-[24px] flex-row items-center justify-center">
            <LogOut color={styles.icon.error} size={20} />
            <Text style={{ color: styles.text.error }} className="font-manrope-bold ml-3 text-base">Sign Out</Text>
          </TouchableOpacity>
        </View>
      </Animated.ScrollView>
      <BadgeDetailModal
        visible={showBadgeModal}
        badge={selectedBadge}
        onClose={() => setShowBadgeModal(false)}
      />
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  const styles = useThemeStyles();
  return (
    <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-[2px] mb-4 mt-2 px-1">
      {title}
    </Text>
  );
}

function MenuItem({ icon, label, onPress }: { icon: any, label: string, onPress?: () => void }) {
  const styles = useThemeStyles();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{ borderBottomColor: styles.border.subtle, borderBottomWidth: 1 }}
      className="flex-row items-center justify-between py-4"
    >
      <View className="flex-row items-center">
        <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="p-2.5 rounded-xl mr-4">
          {icon}
        </View>
        <Text style={{ color: styles.text.onSurface }} className="font-manrope-semibold text-base">{label}</Text>
      </View>
      <ChevronRight size={18} color={styles.icon.muted} />
    </TouchableOpacity>
  );
}
