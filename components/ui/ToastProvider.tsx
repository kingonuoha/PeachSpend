import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS } from 'react-native-reanimated';
import { useThemeStyles } from '../../hooks/useThemeStyles';

type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const TOAST_HEIGHT = 80;
const { width } = Dimensions.get('window');

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ts = useThemeStyles();
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const translateY = useSharedValue(-TOAST_HEIGHT - 100);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    translateY.value = withTiming(-TOAST_HEIGHT - 100, { duration: 300 });
    opacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished) {
        runOnJS(setToast)(null);
      }
    });
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    setToast({ message, type });
    
    translateY.value = withSpring(60, { damping: 15, stiffness: 150 });
    opacity.value = withTiming(1, { duration: 200 });

    timerRef.current = setTimeout(hideToast, 4000);
  }, [hideToast]);

  const getIcon = () => {
    switch (toast?.type) {
      case 'success': return <CheckCircle2 color="#4ADE80" size={20} />;
      case 'error': return <AlertCircle color="#F87171" size={20} />;
      default: return <Info color="#60A5FA" size={20} />;
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            { transform: [{ translateY }], opacity, backgroundColor: ts.bg.surfaceContainerHighest, borderColor: ts.border.card, borderWidth: 1 }
          ]}
        >
          <View className="flex-row items-center px-4 py-3">
            <View className="mr-3">{getIcon()}</View>
            <Text style={{ color: ts.text.onSurface }} className="font-manrope-medium flex-1 text-sm">
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 16,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
});
