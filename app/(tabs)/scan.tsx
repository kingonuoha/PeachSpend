import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { X, Zap } from 'lucide-react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming,
  Easing
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { geminiService } from '../../services/GeminiService';
import { logger } from '../../utils/logger';

export default function ScanScreen() {
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [flash, setFlash] = useState<'on' | 'off'>('off');

  const scanLineY = useSharedValue(0);

  useEffect(() => {
    scanLineY.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [scanLineY]);

  const animatedLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanLineY.value * 384 }] // 384 is h-96 in pixels
  }));

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
          className="bg-peach-500 px-8 py-3 rounded-full"
        >
          <Text className="text-black font-manrope-bold">{Strings.scan.grant_permission}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleCapture = async () => {
    if (isProcessing || !cameraRef.current) return;
    
    try {
      setIsProcessing(true);
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      
      if (photo?.base64) {
        const result = await geminiService.scanReceipt(photo.base64);
        router.push({
          pathname: '/expense-review',
          params: { data: JSON.stringify(result) }
        });
      }
    } catch (error) {
      logger.error('Failed to capture or scan receipt', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View className="flex-1 bg-black">
      <CameraView 
        ref={cameraRef}
        style={StyleSheet.absoluteFill} 
        facing="back"
        enableTorch={flash === 'on'}
      >
        <View className="flex-1">
          {/* Top Bar */}
          <SafeAreaView className="flex-row justify-between items-center px-6 pt-4">
            <TouchableOpacity 
              onPress={() => router.back()}
              className="bg-black/40 p-2 rounded-full"
            >
              <X color="#FFF" size={24} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={() => setFlash(flash === 'on' ? 'off' : 'on')}
              className="bg-black/40 p-2 rounded-full"
            >
              <Zap color={flash === 'on' ? Colors.primary : "#FFF"} size={24} />
            </TouchableOpacity>
          </SafeAreaView>

          {/* Scanner Overlay */}
          <View className="flex-1 items-center justify-center">
            <View className="w-72 h-96 border-2 border-white/30 rounded-3xl overflow-hidden">
              <Animated.View 
                style={[
                  { height: 2, width: '100%', backgroundColor: Colors.primary },
                  animatedLineStyle
                ]} 
              />
            </View>
            <Text className="text-white font-manrope-medium mt-8 bg-black/40 px-4 py-2 rounded-full">
              Align receipt within the frame
            </Text>
          </View>

          {/* Shutter Bar */}
          <View className="absolute bottom-12 w-full items-center">
            <TouchableOpacity
              onPress={handleCapture}
              disabled={isProcessing}
              className={`w-20 h-20 rounded-full border-4 border-white items-center justify-center ${isProcessing ? 'opacity-50' : ''}`}
              activeOpacity={0.8}
            >
              <View className="w-16 h-16 rounded-full bg-peach-50" />
            </TouchableOpacity>
            
            {isProcessing && (
              <Text className="text-white font-manrope-semibold mt-4">
                {Strings.scan.processing}
              </Text>
            )}
          </View>
        </View>
      </CameraView>
    </View>
  );
}
