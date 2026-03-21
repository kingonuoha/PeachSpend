import 'react-native-get-random-values';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
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
import { Colors } from '../constants/tokens';
import "../global.css";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'NotoSerif_400Regular': NotoSerif_400Regular,
    'NotoSerif_700Bold': NotoSerif_700Bold,
    'Manrope_400Regular': Manrope_400Regular,
    'Manrope_500Medium': Manrope_500Medium,
    'Manrope_600SemiBold': Manrope_600SemiBold,
  });

  // @ts-ignore - Property 'useEffect' exists but may not be recognized by current IDE typing environment
  React.useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(onboarding)/index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="expense-review" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="light" />
    </View>
  );
}
