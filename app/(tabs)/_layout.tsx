import { Slot, useRouter, usePathname } from 'expo-router';
import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { Colors } from '../../constants/tokens';
import { Home, BarChart2, Scan, User, Settings } from 'lucide-react-native';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  runOnJS,
  SlideInRight,
  SlideOutLeft,
  SlideInLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';

const TABS = [
  { name: 'Home', route: '/', icon: Home, id: 'index' },
  { name: 'Insights', route: '/analytics', icon: BarChart2, id: 'analytics' },
  { name: 'Scan', route: '/scan', icon: Scan, id: 'scan' },
  { name: 'Profile', route: '/profile', icon: User, id: 'profile' },
  { name: 'Settings', route: '/settings', icon: Settings, id: 'settings' },
];

const SCAN_INDEX = 2;

function TabIcon({ icon: Icon, isActive, isScan }: { icon: any; isActive: boolean; isScan: boolean }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      scale.value = withSpring(1.15, { damping: 8, stiffness: 150 });
      translateY.value = withSpring(isScan ? -4 : -2, { damping: 10, stiffness: 120 });
    } else {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
      translateY.value = withSpring(0, { damping: 12, stiffness: 200 });
    }
  }, [isActive]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <Animated.View style={animStyle}>
      <Icon
        size={isScan ? 28 : 22}
        color={isActive ? colors.primary : colors.textTertiary}
      />
    </Animated.View>
  );
}

function TabBar() {
  const { isDark } = useTheme();
  const ts = useThemeStyles();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const currentPath = pathname === '/index' ? '/' : pathname;
  const currentIndex = TABS.findIndex(tab => tab.route === currentPath);

  const navigateToTab = (index: number) => {
    if (index === currentIndex) return;
    const route = TABS[index].route === '/' ? '/(tabs)' : `/(tabs)${TABS[index].route}`;
    router.push(route as any);
  };

  const barBg = isDark
    ? 'rgba(30,30,30,0.92)'
    : 'rgba(248,244,242,0.95)';

  return (
    <View
      style={{
        position: 'absolute',
        bottom: insets.bottom + 8,
        left: 16,
        right: 16,
        borderRadius: 32,
        backgroundColor: barBg,
        paddingVertical: 6,
        paddingHorizontal: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: isDark ? 0.5 : 0.12,
        shadowRadius: 24,
        elevation: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderWidth: 1,
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      }}
    >
      {TABS.map((tab, index) => {
        const isActive = index === currentIndex;
        const isScan = index === SCAN_INDEX;
        const Icon = tab.icon;

        if (isScan) {
          return (
            <View key={tab.id} style={{ flex: 1, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => navigateToTab(index)}
                activeOpacity={0.8}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: Colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: -28,
                  shadowColor: Colors.primary,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.5,
                  shadowRadius: 16,
                  elevation: 10,
                }}
              >
                <TabIcon icon={Icon} isActive={isActive} isScan />
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={tab.id}
            onPress={() => navigateToTab(index)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}
            activeOpacity={0.7}
          >
            <TabIcon icon={Icon} isActive={isActive} isScan={false} />
            <Text
              style={{
                fontSize: 9,
                fontFamily: 'Manrope_600SemiBold',
                marginTop: 3,
                color: isActive ? Colors.primary : ts.text.onSurfaceVariant,
                opacity: isActive ? 1 : 0.6,
              }}
            >
              {tab.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { isDark } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname === '/index' ? '/' : pathname;
  const currentIndex = TABS.findIndex(tab => tab.route === currentPath);
  const [prevIndex, setPrevIndex] = useState(currentIndex);
  const [direction, setDirection] = useState<'right' | 'left'>('right');

  useEffect(() => {
    if (currentIndex !== prevIndex) {
      setDirection(currentIndex > prevIndex ? 'right' : 'left');
      setPrevIndex(currentIndex);
    }
  }, [currentIndex]);

  const handleSwipe = (swipeDir: 'to-left' | 'to-right') => {
    let nextIndex = currentIndex;
    if (swipeDir === 'to-left' && currentIndex < TABS.length - 1) {
      nextIndex = currentIndex + 1;
    } else if (swipeDir === 'to-right' && currentIndex > 0) {
      nextIndex = currentIndex - 1;
    }

    if (nextIndex !== currentIndex) {
      const route = TABS[nextIndex].route === '/' ? '/(tabs)' : `/(tabs)${TABS[nextIndex].route}`;
      setDirection(nextIndex > currentIndex ? 'right' : 'left');
      router.push(route as any);
    }
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onEnd((e) => {
      if (Math.abs(e.velocityX) > 500) {
        if (e.velocityX < 0) {
          runOnJS(handleSwipe)('to-left');
        } else {
          runOnJS(handleSwipe)('to-right');
        }
      }
    });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: isDark ? '#131313' : '#FCF8F6' }}>
        <GestureDetector gesture={panGesture}>
          <View style={{ flex: 1 }}>
            <Animated.View
              key={currentPath}
              entering={direction === 'right' ? SlideInRight.duration(400) : SlideInLeft.duration(400)}
              exiting={direction === 'right' ? SlideOutLeft.duration(400) : SlideOutRight.duration(400)}
              style={{ flex: 1 }}
            >
              <Slot />
            </Animated.View>
          </View>
        </GestureDetector>

        <TabBar />
      </View>
    </GestureHandlerRootView>
  );
}
