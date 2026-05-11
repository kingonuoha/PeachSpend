import 'react-native-get-random-values';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity } from 'react-native';
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
import "../global.css";

import { ToastProvider } from '../components/ui/ToastProvider';
import { ThemeProvider } from '../components/ui/ThemeProvider';
import { SettingsProvider } from '../components/ui/SettingsProvider';
import { useSettings } from '../components/ui/SettingsProvider';
import AnimatedSplashScreen from '../components/ui/AnimatedSplashScreen';
import { notificationService } from '../services/NotificationService';

SplashScreen.preventAutoHideAsync();

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

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'NotoSerif_400Regular': NotoSerif_400Regular,
    'NotoSerif_700Bold': NotoSerif_700Bold,
    'Manrope_400Regular': Manrope_400Regular,
    'Manrope_500Medium': Manrope_500Medium,
    'Manrope_600SemiBold': Manrope_600SemiBold,
  });
  const [showSplash, setShowSplash] = React.useState(true);

  // @ts-ignore - Property 'useEffect' exists but may not be recognized by current IDE typing environment
  React.useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  React.useEffect(() => {
    notificationService.requestPermissions().catch(() => {});
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <SettingsProvider>
      <ThemeProvider>
        <ToastProvider>
          <View style={{ flex: 1, backgroundColor: Colors.background }}>
            {showSplash && (
              <AnimatedSplashScreen onFinish={() => setShowSplash(false)} />
            )}
            {!showSplash && (
              <BiometricGate>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: Colors.background },
                    animation: 'fade',
                  }}
                >
                  <Stack.Screen name="(onboarding)/index" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="expense/manual" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="expense-review" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="expense/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="privacy-policy" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="support-center" options={{ animation: 'slide_from_right' }} />
                </Stack>
              </BiometricGate>
            )}
            <StatusBar style={showSplash ? 'dark' : 'light'} />
          </View>
        </ToastProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
