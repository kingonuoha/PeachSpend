import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring, Easing, runOnJS } from 'react-native-reanimated';
import { Check, Sparkles } from 'lucide-react-native';
import { Colors } from '../../constants/tokens';

const { width, height } = Dimensions.get('window');

const CONFETTI_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6B9D', '#C084FC', '#FB923C', '#22D3EE'];
const PARTICLE_COUNT = 40;

interface Particle {
  x: number;
  y: number;
  rotate: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
}

function ConfettiParticle({ particle }: { particle: Particle }) {
  const anim = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    anim.value = withDelay(
      particle.delay,
      withTiming(1, { duration: particle.duration, easing: Easing.out(Easing.cubic) })
    );
    opacity.value = withDelay(
      particle.delay + particle.duration - 300,
      withTiming(0, { duration: 300 })
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: particle.x + anim.value * (particle.x > width / 2 ? 80 : -80) },
      { translateY: particle.y + anim.value * 300 },
      { rotate: `${particle.rotate + anim.value * 360}deg` },
      { scale: 1 - anim.value * 0.5 },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: particle.size,
          height: particle.size * 0.6,
          backgroundColor: particle.color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
}

interface SummaryBadge {
  id: string;
  label: string;
  icon: string;
}

interface AchievementCelebrationProps {
  badgeId?: string;
  badgeLabel?: string;
  badgeIcon?: string;
  summaryBadges?: SummaryBadge[];
  onDismiss: () => void;
  duration?: number;
}

export default function AchievementCelebration({ badgeId, badgeLabel, badgeIcon, summaryBadges, onDismiss, duration = 3500 }: AchievementCelebrationProps) {
  const overlayOpacity = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const badgeScale = useSharedValue(0);
  const badgeRotate = useSharedValue(-0.1);
  const textOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0);

  const isSummary = !!summaryBadges && summaryBadges.length > 0;

  const particles: Particle[] = isSummary ? [] : Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: height * 0.5 + (Math.random() - 0.5) * 200,
    rotate: Math.random() * 360,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 6 + Math.random() * 10,
    delay: Math.random() * 400,
    duration: 1200 + Math.random() * 800,
  }));

  useEffect(() => {
    overlayOpacity.value = withTiming(1, { duration: 300 });

    if (isSummary) {
      contentOpacity.value = withDelay(200, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    } else {
      badgeScale.value = withDelay(200, withSpring(1, { damping: 10, stiffness: 100 }));
      badgeRotate.value = withDelay(200, withSpring(0, { damping: 12 }));
      checkScale.value = withDelay(400, withSpring(1, { damping: 8, stiffness: 80 }));
      textOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));
    }

    const timer = setTimeout(() => {
      overlayOpacity.value = withTiming(0, { duration: 400 }, () => {
        runOnJS(onDismiss)();
      });
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }, { rotate: `${badgeRotate.value}rad` }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: withTiming(textOpacity.value * 0, { duration: 400 }) }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const summaryContentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ scale: contentOpacity.value }],
  }));

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        {
          position: 'absolute',
          width,
          height,
          backgroundColor: 'rgba(0,0,0,0.85)',
          zIndex: 9999,
          justifyContent: 'center',
          alignItems: 'center',
        },
        overlayStyle,
      ]}
    >
      <TouchableOpacity
        onPress={onDismiss}
        style={{ position: 'absolute', width, height }}
        activeOpacity={1}
      />

      {isSummary ? (
        <Animated.View style={[{ alignItems: 'center', paddingHorizontal: 32 }, summaryContentStyle]}>
          <Sparkles size={36} color={Colors.primary} style={{ marginBottom: 16 }} />
          <Text style={{ color: Colors.primary, fontSize: 14, fontFamily: 'Manrope_700Bold', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 8 }}>
            Congratulations!
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontFamily: 'Manrope_500Medium', marginBottom: 32, textAlign: 'center' }}>
            You unlocked {summaryBadges!.length} {summaryBadges!.length === 1 ? 'achievement' : 'achievements'}!
          </Text>
          <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'center' }}>
            {summaryBadges!.map((badge, index) => (
              <View key={badge.id} style={{ alignItems: 'center' }}>
                <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 36 }}>{badge.icon}</Text>
                </View>
                <Text style={{ color: 'white', fontSize: 12, fontFamily: 'Manrope_700Bold', textAlign: 'center' }}>{badge.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : (
        <>
          {particles.map((p, i) => (
            <ConfettiParticle key={i} particle={p} />
          ))}

          <Animated.View style={[{ alignItems: 'center' }, badgeStyle]}>
            <Text style={{ fontSize: 100, marginBottom: 16 }}>{badgeIcon}</Text>
          </Animated.View>

          <Animated.View style={[{ alignItems: 'center', marginTop: 8 }, checkStyle]}>
            <View style={{ backgroundColor: '#4ADE80', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Check size={22} color="black" />
            </View>
          </Animated.View>

          <Animated.View style={[{ alignItems: 'center' }, textStyle]}>
            <Text style={{ color: Colors.primary, fontSize: 14, fontFamily: 'Manrope_700Bold', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 4 }}>
              Achievement Unlocked
            </Text>
            <Text style={{ color: 'white', fontSize: 28, fontFamily: 'NotoSerif_700Bold', textAlign: 'center' }}>
              {badgeLabel}
            </Text>
          </Animated.View>
        </>
      )}
    </Animated.View>
  );
}
