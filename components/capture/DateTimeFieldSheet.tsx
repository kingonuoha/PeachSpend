import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { PeachButton } from '../ui/PeachButton';
import { ScalePressable } from '../ui/ScalePressable';
import type { DateTimeFieldMode } from '../../utils/dateTimeField';

// Phase 11 B2-2 and B2-3. The one date and time sheet both entry screens mount.
//
// It exists because the iOS wheels used to render inside the form scroll body, which
// pushed the form by hundreds of points when opened (audit Flaw 2.4). The sheet owns
// only presentation: which half of the value is being edited is decided by
// `utils/dateTimeField.ts`, and the value itself by the screen. Android never mounts
// this; it keeps the system dialogs it already had.

const MODE_OPTIONS: readonly { value: DateTimeFieldMode; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
];

export interface DateTimeFieldSheetProps {
  visible: boolean;
  value: Date;
  mode: DateTimeFieldMode;
  onValueChange: (event: DateTimePickerChangeEvent, date: Date) => void;
  onDismiss: () => void;
  onSwitchMode: (mode: DateTimeFieldMode) => void;
  onDone: () => void;
}

export function DateTimeFieldSheet({
  visible,
  value,
  mode,
  onValueChange,
  onDismiss,
  onSwitchMode,
  onDone,
}: DateTimeFieldSheetProps) {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: ts.bg.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss date and time picker" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: ts.raw.surface, borderColor: ts.border.card, paddingBottom: Math.max(Spacing.s4, insets.bottom) },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: ts.raw.outline }]} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]}>Date &amp; Time</Text>
            <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Close date and time picker" hitSlop={8} style={styles.close}>
              <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Close</Text>
            </Pressable>
          </View>
          <View accessibilityRole="radiogroup" style={styles.modeRow}>
            {MODE_OPTIONS.map((option) => {
              const selected = mode === option.value;
              return (
                <ScalePressable
                  key={option.value}
                  haptic={false}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label} picker`}
                  onPress={() => onSwitchMode(option.value)}
                  style={[styles.modeButton, { backgroundColor: selected ? ts.bg.primary : ts.bg.low }]}
                >
                  <Text style={[Typography.labelBold, { color: selected ? ts.text.white : ts.text.onSurfaceVariant }]}>
                    {option.label}
                  </Text>
                </ScalePressable>
              );
            })}
          </View>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            is24Hour={false}
            themeVariant={ts.isDark ? 'dark' : 'light'}
            onValueChange={onValueChange}
            onDismiss={onDismiss}
          />
          <PeachButton
            title="Done"
            variant="primary"
            size="lg"
            fullWidth
            accessibilityLabel="Done, close date and time picker"
            onPress={() => { void Haptics.selectionAsync(); onDone(); }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    borderTopWidth: 1,
    paddingTop: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    gap: Spacing.s3,
  },
  handle: { width: 40, height: 6, borderRadius: Radii.full, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3 },
  close: { minHeight: 44, justifyContent: 'center' },
  modeRow: { flexDirection: 'row', gap: Spacing.s2 },
  modeButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.sm },
});
