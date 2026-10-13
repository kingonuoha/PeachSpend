import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { ArrowDownLeft, BarChart2, Edit3, Home, MessageCircle, Scan, User } from 'lucide-react-native';
import { PeachTabBar, type PeachTabAction, type PeachTabItem } from '../../components/navigation/PeachTabBar';
import { TAB_ROUTES, resolveActiveTabIndex } from '../../components/navigation/tabRoutes';
import { useThemeStyles } from '../../hooks/useThemeStyles';

type TabIcon = PeachTabItem['icon'];

const TAB_ICONS: Record<string, TabIcon> = {
  '/(tabs)': Home,
  '/(tabs)/analytics': BarChart2,
  '/(tabs)/chat': MessageCircle,
  '/(tabs)/profile': User,
};

// key carries the navigation href so onSelect can push it directly.
const TABS: PeachTabItem[] = TAB_ROUTES.map(route => ({ key: route.href, label: route.label, icon: TAB_ICONS[route.href] }));

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const theme = useThemeStyles();
  const [fabOpen, setFabOpen] = useState(false);
  // Expo Router strips the `(tabs)` group from usePathname(), so the active tab
  // is resolved from the normalized path (see tabRoutes.ts) rather than the href.
  const currentIndex = resolveActiveTabIndex(pathname);
  // Capture surfaces (S-04 scan) are full-screen camera flows with no tab chrome,
  // matching their canonical pairs. Everything else keeps the persistent tab bar.
  const isFullScreenCapture = pathname === '/scan';
  // The switch itself does not slide: tabs are peers, so the pan only decides
  // whether to change tab, then hands off to a normal push.
  const commitTabSwitch = React.useCallback((nextIndex: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(TABS[nextIndex].key as never);
  }, [router]);
  // Horizontal axis declared (activeOffsetX) so the pan never steals vertical
  // scroll; failOffsetY cancels it when the finger moves vertically first.
  // Commit at 60px, clamped at the ends. onEnd runs as a worklet, so the
  // RN-runtime work is scheduled back with scheduleOnRN (not the deprecated
  // runOnJS).
  const tabPan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-15, 15])
    .onEnd((event) => {
      if (Math.abs(event.translationX) < 60) return;
      const next = event.translationX < 0 ? currentIndex + 1 : currentIndex - 1;
      if (next < 0 || next >= TABS.length) return;
      scheduleOnRN(commitTabSwitch, next);
    }), [currentIndex, commitTabSwitch]);

  const navigate = (href: string) => {
    // Tapping the tab you are already on must not push a duplicate route.
    if (href === TABS[currentIndex].key) return;
    router.push(href as never);
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

  return <GestureDetector gesture={tabPan}>
    <View style={{ flex: 1, backgroundColor: theme.bg.screen }}><Slot />
      {!isFullScreenCapture && fabOpen && <Pressable accessibilityRole="button" accessibilityLabel="Close log transaction menu" onPress={() => setFabOpen(false)} style={{ position: 'absolute', inset: 0, backgroundColor: theme.bg.overlay }} />}
      {!isFullScreenCapture && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <PeachTabBar
            tabs={TABS}
            activeKey={TABS[currentIndex].key}
            onSelect={navigate}
            onFabPress={toggleFab}
            fabOpen={fabOpen}
            actions={actions}
            bottomInset={insets.bottom}
          />
        </View>
      )}
    </View>
  </GestureDetector>;
}
