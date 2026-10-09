import React, { useMemo, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ArrowDownLeft, BarChart2, Edit3, Home, MessageCircle, Scan, User } from 'lucide-react-native';
import { PeachTabBar, type PeachTabAction } from '../../components/navigation/PeachTabBar';
import { useThemeStyles } from '../../hooks/useThemeStyles';

const TABS = [
  { key: '/(tabs)', route: '/(tabs)', icon: Home, label: 'Home' },
  { key: '/(tabs)/analytics', route: '/(tabs)/analytics', icon: BarChart2, label: 'Insights' },
  { key: '/(tabs)/chat', route: '/(tabs)/chat', icon: MessageCircle, label: 'AI Chat' },
  { key: '/(tabs)/profile', route: '/(tabs)/profile', icon: User, label: 'Profile' },
] as const;

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const theme = useThemeStyles();
  const [fabOpen, setFabOpen] = useState(false);
  const currentIndex = Math.max(0, TABS.findIndex(tab => pathname === tab.route || (tab.route === '/(tabs)' && pathname === '/(tabs)/')));
  // Capture surfaces (S-04 scan) are full-screen camera flows with no tab chrome,
  // matching their canonical pairs. Everything else keeps the persistent tab bar.
  const isFullScreenCapture = pathname === '/scan';
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) < 60) return;
      const next = gesture.dx < 0 ? currentIndex + 1 : currentIndex - 1;
      if (next < 0 || next >= TABS.length) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(TABS[next].route as never);
    },
  }), [currentIndex, router]);

  const navigate = (route: (typeof TABS)[number]['route']) => {
    router.push(route as never);
  };
  const toggleFab = () => setFabOpen(value => !value);
  const openCapture = (route: '/expense/manual' | '/income/manual' | '/scan') => {
    setFabOpen(false);
    // Carry the real originating tab so the capture screens can show their origin
    // label instead of inventing one. The route back still returns to this screen.
    router.push({ pathname: route, params: { origin: TABS[currentIndex].label } } as never);
  };

  const actions: PeachTabAction[] = [
    { key: 'scan', label: 'Scan', icon: <Scan color={theme.text.onSurface} size={20} />, color: theme.raw.primary, onPress: () => openCapture('/scan') },
    { key: 'income', label: 'Income', icon: <ArrowDownLeft color={theme.text.onSurface} size={20} />, color: theme.raw.success, onPress: () => openCapture('/income/manual') },
    { key: 'expense', label: 'Expense', icon: <Edit3 color={theme.text.onSurface} size={20} />, color: theme.raw.primary, onPress: () => openCapture('/expense/manual') },
  ];

  return <GestureHandlerRootView style={{ flex: 1 }} {...panResponder.panHandlers}>
    <View style={{ flex: 1, backgroundColor: theme.bg.screen }}><Slot />
      {!isFullScreenCapture && fabOpen && <Pressable accessibilityRole="button" accessibilityLabel="Close log transaction menu" onPress={() => setFabOpen(false)} style={{ position: 'absolute', inset: 0, backgroundColor: theme.bg.overlay }} />}
      {!isFullScreenCapture && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <PeachTabBar
            tabs={TABS.map(tab => ({ key: tab.key, label: tab.label, icon: tab.icon }))}
            activeKey={TABS[currentIndex].key}
            onSelect={key => navigate(key as (typeof TABS)[number]['route'])}
            onFabPress={toggleFab}
            fabOpen={fabOpen}
            actions={actions}
            bottomInset={insets.bottom}
          />
        </View>
      )}
    </View>
  </GestureHandlerRootView>;
}
