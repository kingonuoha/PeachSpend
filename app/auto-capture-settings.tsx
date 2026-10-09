import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CircleAlert,
  ClipboardList,
  ExternalLink,
  PauseCircle,
  Search,
  Zap,
} from 'lucide-react-native';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { CategoryTints, Radii, Spacing, Typography } from '../constants/tokens';
import { createNativeAutoCaptureAdapter } from '../data/NativeAutoCaptureAdapter';
import { buildDiagnosticActivity, type AutoCapturePermissionState, type AutoCaptureSourceDescriptor, type CaptureEventStatus, type DiagnosticActivityState } from '../data/contracts';
import { databaseService } from '../services/DatabaseService';
import { PeachButton } from '../components/ui/PeachButton';
import { useSettings } from '../components/ui/SettingsProvider';
import { formatCurrency } from '../utils/currency';
import { formatRelativeDateWithTime } from '../utils/dateFormat';

// Tablet ceiling for the settings column. Upper bound only, never a device width.
const MAX_CONTENT_WIDTH = 640;
// Fitts's Law floor from the locked pair (code.html lines 1390-1393): every
// interactive row and control stays at or above 44pt at every width.
const MIN_TOUCH_TARGET = 44;

// Human labels for the capture_events source column. Unknown values fall through
// to the raw code rather than a fabricated friendly name.
const CAPTURE_SOURCE_LABELS: Record<string, string> = {
  ocr: 'Receipt scan',
  share: 'Share sheet',
  manual: 'Manual entry',
  chat: 'Chat',
  import: 'Import',
  auto_capture: 'Auto-capture',
};

function describeSource(source: string): string {
  return CAPTURE_SOURCE_LABELS[source] ?? source;
}

function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function AutoCaptureSettingsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const { settings, updateSetting } = useSettings();
  const [permission, setPermission] = useState<AutoCapturePermissionState | null>(null);
  const [sources, setSources] = useState<AutoCaptureSourceDescriptor[]>([]);
  const [activity, setActivity] = useState<DiagnosticActivityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const adapter = useMemo(() => createNativeAutoCaptureAdapter(), []);

  const refresh = useCallback(async () => {
    try {
      const [nextPermission, nextSources] = await Promise.all([
        adapter.getPermissionState(),
        adapter.getSupportedSources(),
      ]);
      setPermission(nextPermission);
      setSources(nextSources);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // Diagnostic Activity reads real capture_events through the data layer. On a
    // platform without the native listener there is nothing to read, so the card
    // keeps an honest unsupported message instead of a fixture log.
    if (adapter.capability === 'available') {
      try {
        const repository = await databaseService.getCaptureRepository();
        setActivity(buildDiagnosticActivity(await repository.listEvents()));
      } catch {
        setActivity({ status: 'unavailable', errorCode: 'activity_read_failed' });
      }
    } else {
      setActivity(null);
    }
    setLoading(false);
  }, [adapter]);

  // Initial read on mount. The 0ms timer keeps the async read out of the render
  // body, matching the provider pattern used elsewhere in the app.
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // FR-22.1 / Peak-End rule: returning from the OS settings surface re-reads the
  // real permission state instead of showing a cached assumption.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const isAvailable = adapter.capability === 'available';
  const isUnsupported = adapter.capability === 'unsupported';
  const isGranted = permission?.status === 'granted';
  const masterEnabled = settings.auto_capture_enabled === 'true';
  // The pill reads Active only when the listener can actually run: master on and
  // OS access granted. Otherwise it reads Paused, so a retained grant behind an
  // un-granted permission never claims to be active.
  const listenerActive = masterEnabled && isGranted;
  const activeSourceCount = sources.filter(source => source.status === 'active').length;
  const successTint = ts.isDark ? CategoryTints.groceries.dark : CategoryTints.groceries.light;
  const neutralTint = ts.isDark ? CategoryTints.other.dark : CategoryTints.other.light;

  const activityTag = (status: CaptureEventStatus): { label: string; background: string; color: string } => {
    switch (status) {
      case 'confirmed':
        return { label: 'Confirmed', background: ts.raw.statusSuccessContainer, color: ts.raw.statusSuccessText };
      case 'discarded':
        return { label: 'Discarded', background: ts.raw.dangerSoft, color: ts.raw.dangerContainerText };
      case 'duplicate_skipped':
        return { label: 'Duplicate', background: ts.raw.warningContainer, color: ts.raw.warningContainerText };
      default:
        return { label: humanizeStatus(status), background: neutralTint[0], color: neutralTint[1] };
    }
  };

  const permissionBadge = isGranted
    ? { label: 'Granted', background: ts.raw.statusSuccessContainer, color: ts.raw.statusSuccessText }
    : !isAvailable
      ? { label: isUnsupported ? 'Unsupported' : 'Unavailable', background: ts.bg.card, color: ts.text.onSurfaceVariant }
      : { label: 'Not granted', background: ts.raw.dangerSoft, color: ts.raw.dangerContainerText };

  const permissionIcon = isGranted
    ? { background: successTint[0], color: successTint[1], glyph: <Bell color={successTint[1]} size={18} /> }
    : !isAvailable
      ? { background: ts.bg.card, color: ts.text.onSurfaceVariant, glyph: <BellOff color={ts.text.onSurfaceVariant} size={18} /> }
      : { background: ts.raw.dangerSoft, color: ts.raw.danger, glyph: <BellOff color={ts.raw.danger} size={18} /> };

  const permissionName = isUnsupported ? 'Notification Listener' : 'Android Notification Listener';
  const permissionSub = isGranted
    ? 'System-level access granted.'
    : isUnsupported
      ? 'Auto-capture is supported on Android only.'
      : !isAvailable
        ? 'Not present in this build. Safely inactive.'
        : 'Notification listener access required.';

  const masterSub = !isAvailable
    ? adapter.platform === 'ios'
      ? 'Available on Android only.'
      : 'Not available in this build.'
    : listenerActive
      ? 'Background parser enabled. Drafts queue for review.'
      : masterEnabled
        ? 'Waiting for notification access before drafts can queue.'
        : 'Listener suspended. Notification drafts paused.';

  const toggleMaster = async () => {
    if (!isAvailable) return;
    void Haptics.selectionAsync();
    setToggleError(false);
    try {
      await updateSetting('auto_capture_enabled', masterEnabled ? 'false' : 'true');
    } catch {
      setToggleError(true);
    }
  };

  const openSystemSettings = () => {
    void Haptics.selectionAsync();
    void adapter.openSystemSettings();
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: ts.bg.screen }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={styles.navHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Settings"
              onPress={() => { void Haptics.selectionAsync(); router.back(); }}
              style={[styles.backButton, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
            >
              <ArrowLeft color={ts.icon.default} size={18} />
            </Pressable>
            <Text
              accessibilityRole="header"
              style={[Typography.headlineMd, { color: ts.text.onSurface }]}
              numberOfLines={1}
            >
              Auto-Capture
            </Text>
            <View style={styles.spacer} />
          </View>

          <View
            accessibilityLabel="Auto-capture privacy information"
            style={[styles.heroCard, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}
          >
            <View style={styles.heroHeader}>
              <View style={[styles.heroIconPill, { backgroundColor: ts.bg.primary }]}>
                <Zap color={ts.text.white} size={18} />
              </View>
              <View style={styles.flex}>
                <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>Private & Controlled</Text>
                <Text style={[Typography.micro, { color: ts.text.primary, marginTop: Spacing.s1 }]}>
                  On-Device Transaction Detection
                </Text>
              </View>
            </View>
            <Text style={[Typography.bodyRegular, { color: ts.text.onSurfaceVariant, marginBottom: Spacing.s3 }]}>
              PeachSpend listens for incoming financial push notifications from your installed banking apps to draft expenses in seconds.
            </Text>
            <View style={{ gap: Spacing.s2 }}>
              {[
                { lead: '100% On-Device Parsing:', rest: ' Notification text never leaves this phone.' },
                { lead: 'Mandatory Confirmation:', rest: ' Nothing is logged without your approval.' },
                { lead: 'Instant Kill-Switch:', rest: ' Pause or revoke access at any time.' },
              ].map(item => (
                <View key={item.lead} style={styles.bulletRow}>
                  <Check color={ts.raw.success} size={14} />
                  <Text style={[Typography.labelMd, { color: ts.text.onSurface, flex: 1 }]}>
                    <Text style={Typography.bodyBold}>{item.lead}</Text>
                    {item.rest}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View
            accessibilityLabel="Auto-capture master controls"
            style={[styles.card, styles.masterCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
          >
            <View style={styles.masterInfo}>
              <View style={styles.masterTitleRow}>
                <Text style={[Typography.bodyBold, { color: ts.text.onSurface, flexShrink: 1 }]}>Auto-Capture Master</Text>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: listenerActive ? ts.raw.statusSuccessContainer : ts.raw.dangerSoft,
                    },
                  ]}
                >
                  <Text style={[Typography.micro, { color: listenerActive ? ts.raw.statusSuccessText : ts.raw.dangerContainerText, fontFamily: 'Manrope_700Bold' }]}>
                    {listenerActive ? 'Active' : 'Paused'}
                  </Text>
                </View>
              </View>
              <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, marginTop: Spacing.s1 }]}>
                {masterSub}
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Auto-capture master switch"
              accessibilityHint="Pauses or resumes background notification parsing"
              accessibilityState={{ checked: masterEnabled, disabled: !isAvailable }}
              disabled={!isAvailable}
              onPress={() => { void toggleMaster(); }}
              style={styles.switchHit}
            >
              <View
                style={[
                  styles.switchTrack,
                  {
                    backgroundColor: masterEnabled ? ts.bg.primary : ts.raw.disabledBg,
                    justifyContent: masterEnabled ? 'flex-end' : 'flex-start',
                    opacity: isAvailable ? 1 : 0.5,
                  },
                ]}
              >
                <View style={[styles.switchKnob, { backgroundColor: ts.raw.white }]} />
              </View>
            </Pressable>
          </View>

          {loadError && (
            <View
              accessibilityRole="alert"
              style={[styles.errorBanner, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}
            >
              <CircleAlert color={ts.icon.error} size={20} />
              <Text style={[Typography.labelMd, { color: ts.text.error, flex: 1 }]}>
                Auto-capture status could not be refreshed. Check device access, then retry.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry auto-capture status"
                onPress={() => { void refresh(); }}
                style={styles.retryHit}
              >
                <Text style={[Typography.labelLg, { color: ts.text.error }]}>Retry</Text>
              </Pressable>
            </View>
          )}

          {toggleError && (
            <View
              accessibilityRole="alert"
              style={[styles.errorBanner, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}
            >
              <CircleAlert color={ts.icon.error} size={20} />
              <Text style={[Typography.labelMd, { color: ts.text.error, flex: 1 }]}>
                The master switch could not be saved. Try again.
              </Text>
            </View>
          )}

          <View
            accessibilityLabel="Notification access status"
            style={[styles.card, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
          >
            {loading && permission === null ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={ts.icon.primary} />
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Checking notification access...</Text>
              </View>
            ) : (
              <>
                <View style={styles.permissionTop}>
                  <View style={styles.permissionLabelGroup}>
                    <View style={[styles.permissionIcon, { backgroundColor: permissionIcon.background }]}>
                      {permissionIcon.glyph}
                    </View>
                    <View style={styles.flex}>
                      <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>{permissionName}</Text>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: Spacing.s1 }]}>
                        {permissionSub}
                      </Text>
                    </View>
                  </View>
                  <View
                    accessibilityLabel={`Permission status: ${permissionBadge.label}`}
                    style={[styles.pill, { backgroundColor: permissionBadge.background }]}
                  >
                    <Text style={[Typography.micro, { color: permissionBadge.color, fontFamily: 'Manrope_700Bold' }]}>
                      {permissionBadge.label}
                    </Text>
                  </View>
                </View>
                {isAvailable ? (
                  <PeachButton
                    title={isGranted ? 'Manage in Android Settings' : 'Grant Access in Android Settings'}
                    onPress={openSystemSettings}
                    variant="secondary"
                    size="lg"
                    fullWidth
                    icon={<ExternalLink color={ts.text.primary} size={18} />}
                  />
                ) : (
                  <View style={styles.unavailableRow}>
                    <PauseCircle color={ts.icon.muted} size={18} />
                    <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, flex: 1 }]}>
                      {isUnsupported
                        ? 'Notification-listener auto-capture runs on Android only and stays safely inactive here.'
                        : 'This build has no native listener. Expo Go stays safely inactive; nothing is read.'}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>

          {isAvailable && (
            <>
              <View style={styles.sectionTitleBar}>
                <Text style={[Typography.labelBold, { color: ts.text.onSurface, flex: 1 }]}>Supported Sources</Text>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                  {`${activeSourceCount} Active on device`}
                </Text>
              </View>

              <View style={[styles.card, styles.listCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                {loading && permission === null ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={ts.icon.primary} />
                    <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Checking installed sources...</Text>
                  </View>
                ) : sources.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={[styles.emptyIcon, { backgroundColor: ts.raw.purple100 }]}>
                      <Search color={ts.icon.primary} size={20} />
                    </View>
                    <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>No Parsers Installed</Text>
                    <Text style={[Typography.labelMd, styles.emptySub, { color: ts.text.onSurfaceVariant }]}>
                      We could not detect supported banking or card payment applications on this device.
                    </Text>
                  </View>
                ) : (
                  sources.map((source, index) => {
                    const active = source.status === 'active';
                    const tint = active ? successTint : neutralTint;
                    return (
                      <View
                        key={source.id}
                        style={[
                          styles.sourceRow,
                          index > 0 && { borderTopWidth: 1, borderTopColor: ts.border.subtle },
                        ]}
                      >
                        <View style={[styles.sourceChip, { backgroundColor: tint[0] }]}>
                          <Bell color={tint[1]} size={16} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[Typography.captionBold, { color: ts.text.onSurface }]} numberOfLines={1}>
                            {source.displayName}
                          </Text>
                          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]} numberOfLines={1}>
                            {active ? 'Notification parser active' : 'Not detected on this device'}
                          </Text>
                        </View>
                        <View
                          accessibilityLabel={`${source.displayName}, ${active ? 'active' : 'not detected'}`}
                          style={[styles.pill, { backgroundColor: active ? ts.raw.statusSuccessContainer : neutralTint[0] }]}
                        >
                          <View style={[styles.statusDot, { backgroundColor: active ? ts.raw.success : neutralTint[1] }]} />
                          <Text style={[Typography.micro, { color: active ? ts.raw.statusSuccessText : neutralTint[1], fontFamily: 'Manrope_700Bold' }]}>
                            {active ? 'Active' : 'Not detected'}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </>
          )}

          <View style={styles.sectionTitleBar}>
            <Text style={[Typography.labelBold, { color: ts.text.onSurface, flex: 1 }]}>Diagnostic Activity</Text>
            <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Last 30 Days</Text>
          </View>

          <View style={[styles.card, styles.listCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
            {loading && activity === null ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={ts.icon.primary} />
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Checking recent activity...</Text>
              </View>
            ) : activity && activity.status === 'ready' ? (
              activity.entries.map((entry, index) => {
                const tag = activityTag(entry.status);
                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.sourceRow,
                      index > 0 && { borderTopWidth: 1, borderTopColor: ts.border.subtle },
                    ]}
                  >
                    <View style={[styles.activityChip, { backgroundColor: ts.bg.primary10 }]}>
                      <ClipboardList color={ts.icon.primary} size={16} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={[Typography.captionBold, { color: ts.text.onSurface }]} numberOfLines={1}>
                        {entry.merchant ?? 'Notification event'}
                      </Text>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]} numberOfLines={1}>
                        {`${describeSource(entry.source)} · ${formatRelativeDateWithTime(entry.createdAt)}`}
                      </Text>
                    </View>
                    {entry.amount !== null ? (
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={[Typography.captionBold, styles.activityAmount, { color: ts.text.onSurface }]}
                      >
                        {formatCurrency(entry.amount, settings.currency)}
                      </Text>
                    ) : null}
                    <View
                      accessibilityLabel={`Outcome: ${tag.label}`}
                      style={[styles.pill, { backgroundColor: tag.background }]}
                    >
                      <Text style={[Typography.micro, { color: tag.color, fontFamily: 'Manrope_700Bold' }]}>
                        {tag.label}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: ts.raw.purple100 }]}>
                  <ClipboardList color={ts.icon.primary} size={20} />
                </View>
                <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>
                  {activity && activity.status === 'empty' ? 'No Recent Activity' : 'Activity log unavailable'}
                </Text>
                <Text style={[Typography.labelMd, styles.emptySub, { color: ts.text.onSurfaceVariant }]}>
                  {activity === null
                    ? (isUnsupported
                      ? 'Notification parsing runs on Android only. No activity is read here.'
                      : 'This build has no native listener, so no parsed notification activity exists.')
                    : activity.status === 'empty'
                      ? 'Parsed push notifications from the last 30 days will display here with their outcome.'
                      : 'Parsed notification outcomes could not be read. Retry to try again.'}
                </Text>
                {activity && activity.status === 'unavailable' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading diagnostic activity"
                    onPress={() => { void refresh(); }}
                    style={styles.retryHit}
                  >
                    <Text style={[Typography.labelLg, { color: ts.text.error }]}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.s5, paddingBottom: Spacing.s9 },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: Spacing.s4 },
  flex: { flex: 1, minWidth: 0 },
  navHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.s1 },
  backButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET },
  heroCard: { borderRadius: Radii.xl, padding: Spacing.s5, borderWidth: 1 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, marginBottom: Spacing.s2 },
  heroIconPill: { width: 38, height: 38, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2 },
  card: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.s4 },
  masterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
  },
  masterInfo: { flex: 1, minWidth: 0 },
  masterTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
  },
  switchHit: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: Radii.full,
    padding: 3,
  },
  switchKnob: { width: 22, height: 22, borderRadius: Radii.full },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s4,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.s2 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, minHeight: MIN_TOUCH_TARGET },
  permissionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3, marginBottom: Spacing.s3 },
  permissionLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  permissionIcon: { width: 34, height: 34, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
  unavailableRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  sectionTitleBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.s1 },
  listCard: { padding: 0, overflow: 'hidden' },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    minHeight: 56,
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s3,
  },
  sourceChip: { width: 36, height: 36, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
  activityChip: { width: 32, height: 32, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
  activityAmount: { flexShrink: 0 },
  statusDot: { width: 5, height: 5, borderRadius: Radii.full },
  emptyState: { alignItems: 'center', paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s8, gap: Spacing.s2 },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s1,
  },
  emptySub: { maxWidth: 240, textAlign: 'center' },
});
