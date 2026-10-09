import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AlertTriangle, ArrowDown, ArrowDownUp, Check, ChevronDown, RotateCcw, X } from 'lucide-react-native';

import { PeachButton } from '../ui/PeachButton';
import { ScalePressable } from '../ui/ScalePressable';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import {
  buildConversionOptions,
  buildCurrencyConversionPreview,
  currencyConversionWriter,
  executeBulkCurrencyConversion,
} from '../../services/DataServices';
import type {
  BulkConversionOutcome,
  CurrencyConversionOption,
  CurrencyConversionPreview,
} from '../../services/DataServices';
import { formatCurrency, getCurrencyName, getCurrencyPrefix } from '../../utils/currency';
import type { Expense } from '../../types/database';

// SH-06a Bulk Currency Conversion. Rebuilt replacement for the legacy sheet: the
// account-wide, irreversible counterpart to the lightweight per-entry picker
// (EntryCurrencyPicker, S-09/S-11). Every figure comes from the typed settings
// contracts through app/services/DataServices.ts, never from screen SQL and never
// from a substituted 1:1 rate. A missing stored rate refuses the conversion and
// names the missing currencies (FR-06.5, S-05R-08).

const SHEET_MAX_WIDTH = 640;
const CLOSE_SIZE = 32;
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
const HEADER_CHIP = 28;
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 4;
const CHECK_BOX = 18;
// The pair locks a 12s "rate age" and an ECB live hook. This app has no network
// rate source, so the sheet reports the real saved rate with no fabricated age.

function settlementCodes(preview: CurrencyConversionPreview): string[] {
  if (preview.missingRates.length > 0) return preview.missingRates;
  if (preview.rate === null) return [preview.toCurrency];
  return [];
}

export interface CurrencyConversionSheetProps {
  fromCurrency: string;
  preview: CurrencyConversionPreview;
  /** Caller-owned target selection; the sheet does not reseed it. */
  selectedCode: string;
  consent: boolean;
  converting: boolean;
  error: string | null;
  result: BulkConversionOutcome | null;
  onConsentChange: (value: boolean) => void;
  onSelect: (code: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}

// Presentational canonical body. Used by the modal and, with dev-only fixtures,
// by the component showcase so the pair has one visual implementation.
export function CurrencyConversionSheet({
  fromCurrency,
  preview,
  selectedCode,
  consent,
  converting,
  error,
  result,
  onConsentChange,
  onSelect,
  onConfirm,
  onRetry,
  onClose,
}: CurrencyConversionSheetProps) {
  const ts = useThemeStyles();
  const [pickerOpen, setPickerOpen] = useState(false);

  const toCurrency = preview.toCurrency;
  const options = preview.options.filter((option) => option.code !== fromCurrency);
  const refusedCodes = settlementCodes(preview);
  const ready = preview.status === 'ready' && refusedCodes.length === 0;
  const successOutcome = result?.status === 'converted' ? result : null;
  const partialOutcome = result?.status === 'partial' ? result : null;
  const settled = successOutcome !== null || partialOutcome !== null;
  const rateText = preview.rateLabel ? `1 ${fromCurrency} = ${preview.rateLabel} ${toCurrency}` : null;

  const scope = preview.scope;
  const rateBadge = ready ? 'Ready' : 'Rate required';
  const rateBadgeColor = ready ? ts.raw.statusSuccessText : ts.raw.danger;
  const rateBadgeBg = ready ? ts.raw.statusSuccessContainer : ts.raw.dangerSoft;

  const canConfirm = ready && consent && !converting && !settled;

  const toggleConsent = () => {
    onConsentChange(!consent);
  };

  return (
    <View style={[styles.sheet, { backgroundColor: ts.raw.surface, borderTopColor: ts.raw.outline }]}>
      <View style={[styles.header, { borderBottomColor: ts.raw.outline }]}>
        <View
          style={[styles.handle, { backgroundColor: ts.raw.onSurfaceVariant + '66' }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.headerRow}>
          <View style={[styles.headerChip, { backgroundColor: ts.raw.purple100 }]}>
            <ArrowDownUp size={16} color={ts.raw.primary} strokeWidth={2.2} />
          </View>
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[Typography.bodyBold, { color: ts.raw.onSurface }]}
            >
              Convert Account Currency
            </Text>
            <Text numberOfLines={2} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
              Bulk recalculate all balances, budgets and ledger items
            </Text>
          </View>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Close currency conversion"
            hitSlop={CLOSE_HIT_SLOP}
            onPress={onClose}
            style={[styles.close, { backgroundColor: ts.isDark ? ts.bg.card : ts.bg.low }]}
          >
            <X size={16} color={ts.raw.onSurfaceVariant} strokeWidth={2} />
          </ScalePressable>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {settled ? (
          <View
            style={[
              styles.successCard,
              {
                backgroundColor: successOutcome ? ts.raw.successContainer : ts.raw.warningContainer,
                borderColor: successOutcome ? ts.raw.successBorder : ts.raw.warningBorder,
              },
            ]}
          >
            <View
              style={[
                styles.successIcon,
                { backgroundColor: successOutcome ? ts.raw.success : ts.raw.warning },
              ]}
            >
              <Check size={20} color={ts.text.white} strokeWidth={3} />
            </View>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface, textAlign: 'center' }]}>
              {successOutcome ? 'Conversion Completed' : 'Conversion Completed With Skips'}
            </Text>
            {successOutcome ? (
              <Text style={[Typography.labelMd, { color: ts.raw.successText, textAlign: 'center' }]}>
                Successfully re-denominated {successOutcome.convertedCount} transactions. New base currency is {successOutcome.toCurrency}.
              </Text>
            ) : partialOutcome ? (
              <Text style={[Typography.labelMd, { color: ts.raw.warningContainerText, textAlign: 'center' }]}>
                Converted {partialOutcome.convertedCount}, skipped {partialOutcome.skippedCount}. No rate was found for {partialOutcome.missingRates.join(', ')}.
              </Text>
            ) : null}
            <PeachButton title="Return to Settings" variant="primary" size="lg" fullWidth onPress={onClose} />
          </View>
        ) : null}

        {!settled ? (
          <>
            <View
              style={[
                styles.warning,
                { backgroundColor: ts.raw.conversionWarningBg, borderColor: ts.raw.conversionWarningBorder },
              ]}
            >
              <View style={[styles.warningIcon, { backgroundColor: ts.raw.warning }]}>
                <AlertTriangle size={13} color={ts.text.white} strokeWidth={2.4} />
              </View>
              <Text style={[Typography.micro, styles.warningText, { color: ts.raw.conversionWarningText }]}>
                <Text style={{ fontFamily: 'Manrope_700Bold' }}>Irreversible recalculation: </Text>
                This permanently re-denominates {scope.transactionCount} transactions using the saved{' '}
                {preview.rateLabel || 'exchange'} {toCurrency} rate. This is an account-wide change, not an entry display tag.
              </Text>
            </View>

            <View
              style={[
                styles.exchangeCard,
                {
                  backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.low,
                  borderColor: ts.raw.outline,
                },
              ]}
            >
              <Text style={[Typography.micro, styles.fieldLabel, { color: ts.text.onSurfaceVariant }]}>
                Source Currency (Current Ledger Base)
              </Text>
              <View style={[styles.sourceRow, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }]}>
                <View style={styles.rowLeft}>
                  <View style={[styles.symbolChip, { backgroundColor: ts.raw.statusSuccessContainer }]}>
                    <Text style={[Typography.captionBold, { color: ts.raw.statusSuccessText }]}>
                      {getCurrencyPrefix(fromCurrency)}
                    </Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      {fromCurrency}
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                        {`  ${getCurrencyName(fromCurrency)}`}
                      </Text>
                    </Text>
                  </View>
                </View>
                <View style={[styles.fixedTag, { backgroundColor: ts.bg.elevated }]}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Fixed source</Text>
                </View>
              </View>

              <View style={styles.rateBridge}>
                <View style={[styles.ratePill, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }]}>
                  <ArrowDown size={13} color={ts.raw.primary} strokeWidth={2.5} />
                  <Text style={[Typography.micro, { color: ts.raw.primary }]}>
                    {rateText ?? `No saved rate for ${toCurrency}`}
                  </Text>
                </View>
              </View>

              <View style={styles.targetHeader}>
                <Text style={[Typography.micro, styles.fieldLabel, { color: ts.text.onSurfaceVariant }]}>
                  Target Currency (New Base)
                </Text>
                <View style={[styles.rateBadge, { backgroundColor: rateBadgeBg }]}>
                  <Text style={[Typography.micro, { color: rateBadgeColor, fontFamily: 'Manrope_700Bold' }]}>
                    {rateBadge}
                  </Text>
                </View>
              </View>

              <ScalePressable
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={`Change target currency, currently ${toCurrency}`}
                onPress={() => setPickerOpen((open) => !open)}
                style={[styles.targetRow, { backgroundColor: ts.bg.surface, borderColor: ts.raw.primary }]}
              >
                <View style={styles.rowLeft}>
                  <View style={[styles.symbolChip, { backgroundColor: ts.bg.primary10 }]}>
                    <Text style={[Typography.captionBold, { color: ts.raw.primary }]}>
                      {getCurrencyPrefix(toCurrency)}
                    </Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      {toCurrency}
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                        {`  ${getCurrencyName(toCurrency)}`}
                      </Text>
                    </Text>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[Typography.labelBold, { color: ts.raw.primary }]}>Change</Text>
                  <ChevronDown size={16} color={ts.raw.primary} strokeWidth={2} />
                </View>
              </ScalePressable>

              {pickerOpen ? (
                <View style={[styles.tray, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }]}>
                  {options.length === 0 ? (
                    <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>
                      No target currencies available.
                    </Text>
                  ) : (
                    options.map((option) => (
                      <TargetOption
                        key={option.code}
                        option={option}
                        selected={option.code === selectedCode}
                        onSelect={onSelect}
                      />
                    ))
                  )}
                </View>
              ) : null}
            </View>

            <View
              style={[
                styles.rateCard,
                {
                  backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.surface,
                  borderColor: ts.raw.outline,
                },
              ]}
            >
              <View style={styles.rateCardLeft}>
                <View
                  style={[styles.rateDot, { backgroundColor: ready ? ts.raw.success : ts.raw.danger }]}
                />
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                    Saved conversion rate
                  </Text>
                  <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                    {rateText ?? `No saved rate for ${toCurrency}`}
                  </Text>
                </View>
              </View>
              <View style={[styles.rateTag, { backgroundColor: ts.raw.purple100 }]}>
                <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>
                  {ready ? 'From Settings' : 'Update in Settings'}
                </Text>
              </View>
            </View>

            <View style={styles.scopeSection}>
              <View style={styles.scopeHeader}>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                  Conversion Scope and Impact Preview
                </Text>
                <View style={[styles.scopeBadge, { backgroundColor: rateBadgeBg }]}>
                  <Text style={[Typography.micro, { color: rateBadgeColor, fontFamily: 'Manrope_700Bold' }]}>
                    {ready ? 'All records ready' : 'Rate required'}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.scopeCard,
                  {
                    backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.surface,
                    borderColor: ts.raw.outline,
                  },
                ]}
              >
                <View style={styles.scopeRow}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, flexShrink: 1 }]}>Current Total Balance</Text>
                  <View style={styles.scopeValue}>
                    {ready ? (
                      <>
                        <Text style={[Typography.labelMd, styles.strike, { color: ts.text.onSurfaceVariant }]}>
                          {formatCurrency(scope.sourceTotal, fromCurrency)}
                        </Text>
                        <Text style={[Typography.labelBold, { color: ts.raw.primary }]}>→</Text>
                        <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                          {formatCurrency(scope.convertedTotal, toCurrency)}
                        </Text>
                      </>
                    ) : (
                      <Text style={[Typography.labelBold, { color: ts.raw.danger }]}>Rate required</Text>
                    )}
                  </View>
                </View>

                <View style={[styles.scopeRow, styles.scopeRowTop, { borderTopColor: ts.raw.outline }]}>
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Historical Transactions</Text>
                    <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                      {scope.affectedCount} of {scope.transactionCount} amounts are re-denominated in place
                    </Text>
                  </View>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                    {scope.transactionCount} items
                  </Text>
                </View>
              </View>
            </View>

            {refusedCodes.length > 0 || error ? (
              <View style={[styles.errorCard, { backgroundColor: ts.raw.dangerSoft, borderColor: ts.raw.danger }]}>
                <View style={styles.errorHeader}>
                  <AlertTriangle size={15} color={ts.raw.danger} strokeWidth={2.2} />
                  <Text style={[Typography.labelBold, { color: ts.raw.danger }]}>Rate unavailable</Text>
                </View>
                <Text style={[Typography.micro, { color: ts.raw.danger }]}>
                  {error ??
                    `No stored rate for ${refusedCodes.join(', ')}. Add the rate in Settings, or pick a different target. No amount is converted at an assumed 1:1 rate.`}
                </Text>
                <ScalePressable
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel="Retry currency conversion"
                  onPress={onRetry}
                  style={styles.retryRow}
                >
                  <RotateCcw size={13} color={ts.raw.danger} strokeWidth={2.4} />
                  <Text style={[Typography.micro, { color: ts.raw.danger, fontFamily: 'Manrope_700Bold' }]}>
                    Retry
                  </Text>
                </ScalePressable>
              </View>
            ) : null}

            <ScalePressable
              haptic={false}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent, disabled: !ready }}
              accessibilityLabel={`Confirm converting ${scope.transactionCount} records to ${toCurrency}`}
              disabled={!ready}
              onPress={toggleConsent}
              style={[
                styles.consentRow,
                { backgroundColor: ts.bg.primary10, borderColor: ts.border.primary20, opacity: ready ? 1 : 0.6 },
              ]}
            >
              <View
                style={[
                  styles.checkbox,
                  consent && ready
                    ? { backgroundColor: ts.raw.primary, borderColor: ts.raw.primary }
                    : { backgroundColor: ts.bg.surface, borderColor: ts.border.card },
                ]}
              >
                {consent && ready ? <Check size={13} color={ts.text.white} strokeWidth={3} /> : null}
              </View>
              <Text style={[Typography.micro, { color: ts.raw.onSurface, flex: 1 }]}>
                I understand this will convert all {scope.transactionCount} records using the{' '}
                {preview.rateLabel || 'saved'} {toCurrency} rate. This cannot be undone automatically.
              </Text>
            </ScalePressable>
          </>
        ) : null}
      </ScrollView>

      {!settled ? (
        <View style={[styles.footer, { borderTopColor: ts.raw.outline, backgroundColor: ts.raw.surface }]}>
          <PeachButton
            title={converting ? 'Converting Database Records...' : `Convert All Records to ${toCurrency}`}
            variant="primary"
            size="lg"
            fullWidth
            style={{ opacity: canConfirm ? 1 : 0.4 }}
            isLoading={converting}
            disabled={!canConfirm}
            onPress={onConfirm}
          />
          <PeachButton
            title={`Cancel and keep ${fromCurrency}`}
            variant="quiet"
            size="lg"
            fullWidth
            disabled={converting}
            onPress={onClose}
          />
        </View>
      ) : null}
    </View>
  );
}

function TargetOption({
  option,
  selected,
  onSelect,
}: {
  option: CurrencyConversionOption;
  selected: boolean;
  onSelect: (code: string) => void;
}) {
  const ts = useThemeStyles();
  const disabled = option.excluded;

  return (
    <ScalePressable
      haptic={!disabled}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={
        disabled
          ? `${option.code}, no saved rate`
          : `${option.code}, rate ${option.rateLabel}`
      }
      onPress={() => onSelect(option.code)}
      style={[
        styles.targetOption,
        {
          backgroundColor: selected ? ts.bg.primary10 : ts.bg.surface,
          borderColor: selected ? ts.raw.primary : ts.raw.outline,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
        {option.code}
      </Text>
      <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        {option.rateLabel ? `${option.rateLabel} rate` : 'No saved rate'}
      </Text>
    </ScalePressable>
  );
}

export interface CurrencyConversionModalProps {
  visible: boolean;
  fromCurrency: string;
  expenses: Pick<Expense, 'id' | 'amount' | 'currency'>[];
  candidateCurrencies: readonly string[];
  rates: string | null;
  onClose: () => void;
  onConverted?: (outcome: BulkConversionOutcome) => void | Promise<void>;
}

// State owner for SH-06a. Builds the preview and runs the sole conversion
// executor through the DataServices wiring point, then reports the real outcome
// so the Settings screen refreshes expenses and settings and toasts honestly.
export function CurrencyConversionModal({
  visible,
  fromCurrency,
  expenses,
  candidateCurrencies,
  rates,
  onClose,
  onConverted,
}: CurrencyConversionModalProps) {
  const ts = useThemeStyles();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.root}>
        <ScalePressable
          haptic={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: ts.bg.overlay }]}
        >
          <View />
        </ScalePressable>
        <CurrencyConversionModalContent
          // Remount on open so every session starts unconfirmed, with a fresh
          // target and no carried success or error banner.
          key={visible ? 'sh-06a-open' : 'sh-06a-closed'}
          fromCurrency={fromCurrency}
          expenses={expenses}
          candidateCurrencies={candidateCurrencies}
          rates={rates}
          onClose={onClose}
          onConverted={onConverted}
        />
      </View>
    </Modal>
  );
}

function CurrencyConversionModalContent({
  fromCurrency,
  expenses,
  candidateCurrencies,
  rates,
  onClose,
  onConverted,
}: Omit<CurrencyConversionModalProps, 'visible'>) {
  const { height } = useWindowDimensions();
  const [target, setTarget] = useState('');
  const [consent, setConsent] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkConversionOutcome | null>(null);

  const options = useMemo(
    () => buildConversionOptions(fromCurrency, candidateCurrencies, rates).filter((option) => option.code !== fromCurrency),
    [fromCurrency, candidateCurrencies, rates],
  );
  const defaultTarget = useMemo(
    () => options.find((option) => !option.excluded)?.code ?? options[0]?.code ?? '',
    [options],
  );
  const activeTarget = target || defaultTarget;

  const preview = useMemo(
    () => buildCurrencyConversionPreview(expenses, fromCurrency, activeTarget, rates, candidateCurrencies),
    [expenses, fromCurrency, activeTarget, rates, candidateCurrencies],
  );

  const sheetMaxHeight = useMemo(() => Math.min(height * 0.92, 790), [height]);

  const confirm = useCallback(async () => {
    if (converting || !consent || preview.status !== 'ready') return;
    setConverting(true);
    setError(null);
    setResult(null);
    let outcome: BulkConversionOutcome | null = null;
    try {
      outcome = await executeBulkCurrencyConversion(currencyConversionWriter, expenses, activeTarget, rates);
    } catch {
      setError('The conversion could not be completed. Please try again.');
    } finally {
      setConverting(false);
    }
    if (!outcome) return;
    setResult(outcome);
    await onConverted?.(outcome);
  }, [converting, consent, preview.status, expenses, activeTarget, rates, onConverted]);

  return (
    <View style={[styles.sheetWrap, { maxHeight: sheetMaxHeight }]}>
      <CurrencyConversionSheet
        fromCurrency={fromCurrency}
        preview={preview}
        selectedCode={activeTarget}
        consent={consent}
        converting={converting}
        error={error}
        result={result}
        onConsentChange={setConsent}
        onSelect={(code) => {
          setTarget(code);
          setConsent(false);
          setError(null);
          setResult(null);
        }}
        onConfirm={() => void confirm()}
        onRetry={() => setError(null)}
        onClose={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheetWrap: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    alignSelf: 'center',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    borderTopWidth: 1,
    flexShrink: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    paddingTop: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s2,
    borderBottomWidth: 1,
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: Radii.full,
    alignSelf: 'center',
    marginBottom: Spacing.s3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  headerChip: {
    width: HEADER_CHIP,
    height: HEADER_CHIP,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  close: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s4,
    gap: Spacing.s4,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  warningIcon: {
    width: 24,
    height: 24,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  warningText: {
    flex: 1,
    lineHeight: 17,
  },
  exchangeCard: {
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    gap: Spacing.s3,
  },
  fieldLabel: {
    fontFamily: 'Manrope_600SemiBold',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexShrink: 1,
    minWidth: 0,
  },
  rowText: {
    flexShrink: 1,
    minWidth: 0,
  },
  symbolChip: {
    width: 28,
    height: 28,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fixedTag: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    flexShrink: 0,
  },
  rateBridge: {
    alignItems: 'center',
    marginVertical: -Spacing.s1,
  },
  ratePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  rateBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    flexShrink: 0,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    flexShrink: 0,
  },
  tray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
    padding: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  targetOption: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 88,
    padding: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
  },
  rateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  rateCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexShrink: 1,
    minWidth: 0,
  },
  rateDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    flexShrink: 0,
  },
  rateTag: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    flexShrink: 0,
  },
  scopeSection: {
    gap: Spacing.s2,
  },
  scopeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s1,
  },
  scopeBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    flexShrink: 0,
  },
  scopeCard: {
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  scopeRowTop: {
    paddingTop: Spacing.s3,
    marginTop: Spacing.s3,
    borderTopWidth: 1,
  },
  scopeValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexShrink: 0,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  errorCard: {
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
    gap: Spacing.s1,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  checkbox: {
    width: CHECK_BOX,
    height: CHECK_BOX,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  successCard: {
    alignItems: 'center',
    gap: Spacing.s2,
    padding: Spacing.s4,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  successIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: Spacing.s5,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
    gap: Spacing.s2,
  },
});
