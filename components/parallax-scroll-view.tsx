import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';

// Boilerplate component - not used in PeachSpend (reanimated dependency removed)
type Props = PropsWithChildren<{
  headerImage: ReactElement;
  headerBackgroundColor: { dark: string; light: string };
}>;

export default function ParallaxScrollView({ children, headerImage }: Props) {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>{headerImage}</View>
      <View style={styles.content}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 250, overflow: 'hidden' },
  content: { flex: 1, padding: 32, gap: 16, overflow: 'hidden' },
});
