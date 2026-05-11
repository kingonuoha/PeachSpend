import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { X, Zap, Camera, WifiOff, Edit3, Image as ImageIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/ui/ThemeProvider';
import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { geminiService } from '../../services/GeminiService';
import { useSettings } from '../../components/ui/SettingsProvider';
import { logger } from '../../utils/logger';

import { VerificationSheet } from '../../components/expense/VerificationSheet';
import { databaseService } from '../../services/DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { useToast } from '../../components/ui/ToastProvider';
import { notificationService } from '../../services/NotificationService';

export default function ScanScreen() {
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const { colors } = useTheme();
  const { settings } = useSettings();
  const [isScanning, setIsScanning] = useState(false);
  const [legibleModalVisible, setLegibleModalVisible] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [scanMode, setScanMode] = useState<'receipt' | 'product'>('receipt');

  const [scanResult, setScanResult] = useState<unknown>(null);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);

  const scanLineY = useSharedValue(0);

  useEffect(() => {
    // Check for API key on mount to warn user early
    const checkApiKey = async () => {
      const apiKey = await databaseService.getSetting('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API Key missing. Please add it in Settings.', 'error');
      }
    };
    checkApiKey();

    scanLineY.value = withRepeat(
      withSequence(
        withTiming(384, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2500, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    );
  }, []);

  const scanLineStyle = useAnimatedStyle(() => ({
    height: 2,
    width: '100%',
    backgroundColor: Colors.primary,
    transform: [{ translateY: scanLineY.value }],
  }));

  const handleConfirm = async (finalData: any) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const now = Date.now();
      
      // Handle multiple items or single item
      const expenses = Array.isArray(finalData) ? finalData : [finalData];
      
      for (const item of expenses) {
        if (!item) continue;
        notificationService.scheduleExpenseNotification(
          item.merchant || 'Unknown',
          `${item.currency || 'USD'} ${typeof item.amount === 'number' ? item.amount.toFixed(2) : item.amount}`
        );
        
        // Ensure a valid ID on both native and web
        const expenseId = Platform.OS === 'web' ? Math.random().toString(36).substring(2, 11) : uuidv4();
        
        await databaseService.addExpense({
          id: expenseId,
          merchant: item.merchant || 'Unknown',
          amount: typeof item.amount === 'number' ? item.amount : (parseFloat(item.amount) || 0),
          currency: item.currency || 'USD',
          category: item.category || 'other',
          note: item.note || '',
          scanned: 1,
          date: now,
          created_at: now,
          image_uri: capturedImageUri || undefined
        } as any);
      }
      
      setIsSheetVisible(false);
      setCapturedImageUri(null);
      showToast(`Successfully saved ${expenses.length} expense${expenses.length > 1 ? 's' : ''}`, 'success');
      router.replace('/(tabs)');
    } catch (error) {
      logger.error('Failed to save scanned expense', error);
      showToast('Failed to save expenses', 'error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (!permission) {
    return <View className="flex-1 bg-black" />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-black items-center justify-center p-6">
        <Text className="text-white text-center font-manrope-medium mb-6">
          {Strings.scan.camera_permission}
        </Text>
        <TouchableOpacity
          onPress={requestPermission}
          className="bg-primary px-8 py-3 rounded-full"
        >
          <Text className="text-black font-manrope-bold">{Strings.scan.grant_permission}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleGalleryPick = async () => {
    try {
      const apiKey = await databaseService.getSetting('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API Key missing. Check Settings.', 'error');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.5,
      });

      if (result.canceled || !result.assets[0]?.base64) return;

      setCapturedImageUri(result.assets[0].uri || null);
      setIsScanning(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const rawItems = await geminiService.scanReceipt(result.assets[0].base64, scanMode);

      const convertedItems = rawItems.map(item => {
        if (item.currency === settings.currency) return item;
        const rates = settings.conversionRates as any;
        const rateToUsd = rates[item.currency] || 1;
        const rateFromUsd = rates[settings.currency] || 1;
        return {
          ...item,
          amount: item.amount * rateToUsd / rateFromUsd,
          currency: settings.currency
        };
      });

      setScanResult(convertedItems);
      setIsSheetVisible(true);
    } catch (error: any) {
      logger.error('Failed to scan gallery image', error);

      if (error.message === 'IMAGE_NOT_LEGIBLE') {
        setLegibleModalVisible(true);
      } else if (error.message === 'NO_ITEMS_FOUND') {
        showToast('No items detected. Try another image.', 'error');
      } else {
        showToast(error.message || 'Failed to process image', 'error');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCapture = async () => {
    if (isScanning || !cameraRef.current) return;

    try {
      const apiKey = await databaseService.getSetting('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API Key missing. Check Settings.', 'error');
        return;
      }

      setIsScanning(true);
      setFlash('off');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      setCameraActive(false);

      if (photo?.base64) {
        setCapturedImageUri(photo.uri || null);
        // Pass scanMode to service
        const rawItems = await geminiService.scanReceipt(photo.base64, scanMode);
        
        const convertedItems = rawItems.map(item => {
          if (item.currency === settings.currency) return item;
          const rates = settings.conversionRates as any;
          const rateToUsd = rates[item.currency] || 1;
          const rateFromUsd = rates[settings.currency] || 1;
          return {
            ...item,
            amount: item.amount * rateToUsd / rateFromUsd,
            currency: settings.currency
          };
        });

        setScanResult(convertedItems);
        setIsSheetVisible(true);
      } else {
        setCameraActive(true);
      }
    } catch (error: any) {
      logger.error('Failed to capture or scan receipt', error);
      
      if (error.message === 'IMAGE_NOT_LEGIBLE') {
        setLegibleModalVisible(true);
      } else if (error.message === 'NO_ITEMS_FOUND') {
        showToast('No items detected. Try another angle.', 'error');
        setCameraActive(true);
      } else {
        showToast(error.message || 'Failed to process image', 'error');
        setCameraActive(true);
      }
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <View className="flex-1 bg-black">
      {isOffline ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="bg-white/5 p-6 rounded-[40px] mb-6">
            <WifiOff size={48} color={Colors.primary} />
          </View>
          <Text className="text-white font-noto-serif-bold text-2xl text-center mb-3">You're Offline</Text>
          <Text className="text-onSurfaceVariant font-manrope-medium text-center leading-6 mb-10">
            Cannot scan while offline. Please connect to the internet.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/expense/manual')}
            className="bg-primary px-8 py-4 rounded-full flex-row items-center"
          >
            <Edit3 size={20} color="black" />
            <Text className="text-black font-manrope-bold ml-3 text-base">Manual Entry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {cameraActive && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={flash === 'on'}
            />
          )}
          
          {/* UI Overlay - Positioned Absolutely */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Top Bar */}
            <SafeAreaView className="flex-row justify-between items-center px-6 pt-4">
              <TouchableOpacity
                onPress={() => router.back()}
                className="bg-black/40 p-2 rounded-full"
              >
                <X color="#FFF" size={24} />
              </TouchableOpacity>

              {/* Mode Toggle */}
              <View className="flex-row bg-black/40 rounded-full p-1 border border-white/10">
                <TouchableOpacity 
                  onPress={() => setScanMode('receipt')}
                  className={`px-4 py-1.5 rounded-full ${scanMode === 'receipt' ? 'bg-primary' : ''}`}
                >
                  <Text className={`text-xs font-manrope-bold ${scanMode === 'receipt' ? 'text-black' : 'text-white'}`}>Receipt</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => setScanMode('product')}
                  className={`px-4 py-1.5 rounded-full ${scanMode === 'product' ? 'bg-primary' : ''}`}
                >
                  <Text className={`text-xs font-manrope-bold ${scanMode === 'product' ? 'text-black' : 'text-white'}`}>Product</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setFlash(flash === 'on' ? 'off' : 'on')}
                className="bg-black/40 p-2 rounded-full"
              >
                <Zap color={flash === 'on' ? Colors.primary : '#FFF'} size={24} />
              </TouchableOpacity>
            </SafeAreaView>

            {/* Scanner Overlay */}
            <View className="flex-1 items-center justify-center">
              <View className="w-72 h-96 border-2 border-white/30 rounded-3xl overflow-hidden">
                <Animated.View style={scanLineStyle} />
              </View>
              <Text className="text-white font-manrope-medium mt-8 bg-black/40 px-4 py-2 rounded-full">
                {scanMode === 'receipt' ? 'Align receipt within the frame' : 'Align product label within the frame'}
              </Text>
            </View>

        {/* Bottom Bar */}
        <View className="absolute bottom-24 w-full flex-row items-center justify-center px-10">
          <TouchableOpacity
            onPress={handleGalleryPick}
            disabled={isScanning}
            className="bg-black/40 p-4 rounded-full mr-auto border border-white/10"
          >
            <ImageIcon color="#FFF" size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCapture}
            disabled={isScanning}
            className={`w-20 h-20 rounded-full border-4 border-white items-center justify-center ${isScanning ? 'opacity-50' : ''}`}
            activeOpacity={0.8}
          >
            <View className="w-16 h-16 rounded-full bg-peach-50" />
          </TouchableOpacity>
          <View className="ml-auto w-12" />
        </View>
          </View>
        </>
      )}

      <VerificationSheet
        isVisible={isSheetVisible}
        data={scanResult as any}
        onConfirm={handleConfirm}
        onCancel={() => {
          setIsSheetVisible(false);
          setCameraActive(true);
        }}
      />

      {/* Legibility Error Modal */}
      <Modal
        visible={legibleModalVisible}
        transparent
        animationType="fade"
      >
        <View className="flex-1 items-center justify-center px-8 bg-black/60">
          <View className="bg-zinc-900 p-8 rounded-[40px] border border-white/10 w-full items-center">
            <View className="w-20 h-20 bg-primary/10 rounded-[30px] items-center justify-center mb-6">
              <Camera size={40} color={Colors.primary} />
            </View>
            <Text className="text-white text-2xl font-noto-serif-bold text-center mb-3">Blurry Vision?</Text>
            <Text className="text-white/60 font-manrope-medium text-center mb-8 leading-6">
              Gemini couldn't quite read that. Make sure the receipt is flat, well-lit, and fits completely in the frame.
            </Text>
            
            <TouchableOpacity 
              onPress={() => {
                setLegibleModalVisible(false);
                setCapturedImage(null);
                setCameraActive(true);
              }}
              className="bg-primary py-4 rounded-2xl w-full items-center mb-3"
            >
              <Text className="text-black font-manrope-bold text-base">Try Again</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={() => {
                setLegibleModalVisible(false);
                setCameraActive(true);
              }}
              className="py-3"
            >
              <Text className="text-white/60 font-manrope-bold text-sm">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Loading Overlay */}
      {isScanning && (
        <View style={StyleSheet.absoluteFill} className="bg-black/80 items-center justify-center z-50">
          <View className="items-center">
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text className="text-primary font-noto-serif-bold text-2xl mt-8">Neural Processing...</Text>
            <Text className="text-white/40 font-manrope-medium text-sm mt-3 tracking-[2px] uppercase">
              Extracting line items
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
