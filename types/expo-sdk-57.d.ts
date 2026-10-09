declare module 'react-native-safe-area-context' {
  import type { ComponentType } from 'react';
  import type { ViewProps } from 'react-native';

  export type Edge = 'top' | 'right' | 'bottom' | 'left';

  export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }

  export interface SafeAreaViewProps extends ViewProps {
    edges?: Edge[];
  }

  export const SafeAreaView: ComponentType<SafeAreaViewProps>;
  export function useSafeAreaInsets(): EdgeInsets;
}

declare module 'expo-sharing' {
  export interface SharingOptions {
    dialogTitle?: string;
    mimeType?: string;
    UTI?: string;
  }

  export function isAvailableAsync(): Promise<boolean>;
  export function shareAsync(url: string, options?: SharingOptions): Promise<void>;
}
