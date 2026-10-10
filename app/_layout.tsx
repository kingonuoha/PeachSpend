import 'react-native-get-random-values';
import { HrefInputParams, Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, AppState } from 'react-native';
import * as React from 'react';
import { 
  useFonts,
  NotoSerif_400Regular,
  NotoSerif_700Bold 
} from '@expo-google-fonts/noto-serif';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold
} from '@expo-google-fonts/manrope';
import * as SplashScreen from 'expo-splash-screen';
import * as LocalAuthentication from 'expo-local-authentication';
import { Colors } from '../constants/tokens';
import { Fingerprint, Lock } from 'lucide-react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import "../global.css";

import { ToastProvider } from '../components/ui/ToastProvider';
import { ThemeProvider } from '../components/ui/ThemeProvider';
import { SettingsProvider, useSettings } from '../components/ui/SettingsProvider';
import ContinuityGate from '../components/ui/ContinuityGate';
import AnimatedSplashScreen from '../components/ui/AnimatedSplashScreen';
import StreakGate from '../components/ui/StreakGate';
import { AchievementProvider } from '../components/ui/AchievementProvider';
import { notificationService } from '../services/NotificationService';
import { useShareIntent } from 'expo-share-intent';
import { logger } from '../utils/logger';
import { recurringService, RECURRING_TASK_NAME } from '../services/RecurringService';
import { cleanupService } from '../services/CleanupService';
import { aiChatService } from '../services/AIChatService';
import AutoCaptureConfirmHost from '../components/ui/AutoCaptureConfirmHost';
import { canUseNativeRuntime } from '../utils/runtimeEnvironment';
import { createShareIntentHandoff } from '../utils/shareIntentHandoff';

SplashScreen.preventAutoHideAsync();

type ShareReceiveRoute = HrefInputParams & {
  pathname: '/(share)/receive';
  params: { handoffToken: string };
};

function BiometricGate({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [biometricPassed, setBiometricPassed] = React.useState(false);
  const [authFailed, setAuthFailed] = React.useState(false);

  React.useEffect(() => {
    const checkBiometric = async () => {
      const enabled = settings.biometric_enabled === 'true';
      if (!enabled) {
        setBiometricPassed(true);
        return;
      }

      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) {
        setBiometricPassed(true);
        return;
      }

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        setBiometricPassed(true);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock PeachSpend',
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        setBiometricPassed(true);
      } else {
        setAuthFailed(true);
      }
    };

    checkBiometric();
  }, [settings.biometric_enabled]);

  if (biometricPassed) return <>{children}</>;

  return (
    <View className="flex-1 bg-black items-center justify-center px-8">
      <View className="bg-white/5 p-6 rounded-[40px] mb-8">
        <Lock size={48} color={Colors.primary} />
      </View>
      <Text className="text-white font-noto-serif-bold text-3xl mb-3 text-center">Locked</Text>
      <Text className="text-onSurfaceVariant font-manrope-medium text-center mb-10 leading-6">
        PeachSpend is secured. Authenticate to continue.
      </Text>
      {authFailed && (
        <Text className="text-red-400 font-manrope-medium text-sm mb-6">
          Authentication failed. Try again.
        </Text>
      )}
      <TouchableOpacity
        onPress={async () => {
          setAuthFailed(false);
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Unlock PeachSpend',
            fallbackLabel: 'Use passcode',
            cancelLabel: 'Cancel',
          });
          if (result.success) {
            setBiometricPassed(true);
          } else {
            setAuthFailed(true);
          }
        }}
        className="bg-primary px-10 py-4 rounded-full flex-row items-center"
      >
        <Fingerprint size={22} color="black" />
        <Text className="text-black font-manrope-bold ml-3 text-base">Authenticate</Text>
      </TouchableOpacity>
    </View>
  );
}

function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const router = useRouter();
  const segments = useSegments();
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current || !hasShareIntent) return;
    const files = shareIntent?.files ?? [];
    const file = files.length === 1 ? files[0] : undefined;
    const uri = file?.path;
    const mimeType = file?.mimeType;
    if (!uri || !mimeType) {
      handled.current = true;
      resetShareIntent();
      return;
    }

    handled.current = true;
    resetShareIntent();

    const isOnShareRoute = segments.length > 0 && segments[0] === '(share)';
    if (isOnShareRoute) return;

    const handoffToken = createShareIntentHandoff({ uri, mimeType });
    if (!handoffToken) return;

    setTimeout(() => {
      const shareRoute: ShareReceiveRoute = {
        pathname: '/(share)/receive',
         params: { handoffToken },
      };
      router.replace(shareRoute);
    }, 800);
  }, [hasShareIntent, shareIntent, segments, resetShareIntent, router]);

  return null;
}

function NotificationPermissionGate() {
  const { isLoading, settings } = useSettings();

  React.useEffect(() => {
    if (isLoading || settings.notifications_enabled !== 'true') return;
    void notificationService.requestPermissions();
  }, [isLoading, settings.notifications_enabled]);

  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'NotoSerif_400Regular': NotoSerif_400Regular,
    'NotoSerif_700Bold': NotoSerif_700Bold,
    'Manrope_400Regular': Manrope_400Regular,
    'Manrope_500Medium': Manrope_500Medium,
    'Manrope_600SemiBold': Manrope_600SemiBold,
  });
  const [showSplash, setShowSplash] = React.useState(true);
  const handleSplashFinish = React.useCallback(() => setShowSplash(false), []);

  // @ts-ignore - Property 'useEffect' exists but may not be recognized by current IDE typing environment
  React.useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  React.useEffect(() => {
    void cleanupService.performRoutineCleanup();
  }, []);

  // S-05R-04: the stated 7-day chat retention must hold even if the user never
  // opens S-07, so the expiry check runs at app init as well as on chat mount.
  React.useEffect(() => {
    void aiChatService.checkAutoExpiry().catch(() => undefined);
  }, []);

  // Run recurring check on launch + foreground
  React.useEffect(() => {
    const check = async () => {
      await recurringService.checkDueRecurring();
    };

    check();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        recurringService.resetCheck();
        check();
      }
    });

    return () => sub.remove();
  }, []);

  // Register background task for recurring checks
  React.useEffect(() => {
    if (!canUseNativeRuntime('expo-background-task')) return;

    TaskManager.defineTask(RECURRING_TASK_NAME, async () => {
      try {
        await recurringService.checkDueRecurring();
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });

    const registerBg = async () => {
      try {
        const status = await BackgroundTask.getStatusAsync();
        if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

        await BackgroundTask.registerTaskAsync(RECURRING_TASK_NAME, {
          minimumInterval: 60, // 1 hour
        });
      } catch {
        logger.warn('Background task registration skipped (expected in Expo Go)', 'background_task_registration_failed');
      }
    };
    registerBg();
  }, []);

  return (
      <SettingsProvider>
        <NotificationPermissionGate />
        <ContinuityGate />
        <ThemeProvider>
          <ToastProvider>
            <AchievementProvider>
            <View style={{ flex: 1, backgroundColor: Colors.background }}>
              <BiometricGate>
                  <StreakGate>
                    {canUseNativeRuntime('expo-share-intent') && <ShareIntentHandler />}
                   <AutoCaptureConfirmHost />
                   <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: Colors.background },
                    animation: 'fade',
                  }}
                >
                  <Stack.Screen name="(onboarding)/index" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(share)/receive" options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="expense/manual" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="expense-review" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="expense/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="privacy-policy" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="support-center" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="settings/categories" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="recurring/index" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="income/manual" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
                   <Stack.Screen name="settings/chat" options={{ animation: 'slide_from_right' }} />
                   <Stack.Screen name="auto-capture-settings" options={{ animation: 'slide_from_right' }} />
                   <Stack.Screen name="spending-recap" options={{ animation: 'slide_from_right' }} />
                </Stack>
                </StreakGate>
              </BiometricGate>
            {showSplash && <AnimatedSplashScreen onFinish={handleSplashFinish} />}
            <StatusBar style={showSplash ? 'dark' : 'light'} />
          </View>
            </AchievementProvider>
        </ToastProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
