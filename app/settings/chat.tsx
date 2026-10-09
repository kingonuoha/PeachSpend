import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Eye,
  EyeOff,
  HelpCircle,
  Lock,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';

import { Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { SearchFilterBar } from '../../components/ui/SearchFilterBar';
import { useToast } from '../../components/ui/ToastProvider';
import { aiChatService } from '../../services/AIChatService';
import { databaseService } from '../../services/DatabaseService';
import { getAiErrorMessage, type AiProvider, type ProviderModel } from '../../ai/contracts';
import type {
  ConversationHistoryState,
  MaskedKeyState,
  ModelRefreshOutcome,
  ProviderKeyState,
} from '../../data/ProviderSettings';

// S-17 AI Chat Settings (FR-17.1-17.4, FR-07.8). Single home for both provider
// keys and their model lists. A stored key is only ever read as its constant mask
// through the Data & AI contract; the local text field holds an unsaved draft that
// is cleared on save and never logged.

type ModelTierFilter = 'all' | 'free' | 'paid';

const GEMINI_SECRET_KEY = 'gemini_api_key';
const OPENROUTER_SECRET_KEY = 'chat_openrouter_api_key';
const GEMINI_MODEL_SETTING = 'chat_gemini_model';
const OPENROUTER_MODEL_SETTING = 'chat_openrouter_model';
const CONTENT_MAX_WIDTH = 640;

function providerLabel(model: ProviderModel, provider: AiProvider): string {
  if (provider === 'gemini') return 'Google';
  const vendor = model.id.includes('/') ? model.id.split('/')[0] : '';
  return vendor ? vendor.charAt(0).toUpperCase() + vendor.slice(1) : 'OpenRouter';
}

function formatContextLength(length: number | undefined): string | null {
  if (!length || length <= 0) return null;
  if (length >= 1_000_000) {
    const millions = length / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M context`;
  }
  return `${Math.round(length / 1000)}K context`;
}

function maskPlaceholder(state: MaskedKeyState | undefined): string | undefined {
  return state?.status === 'configured' ? state.masked : undefined;
}

function ModelRow({
  model,
  provider,
  active,
  onSelect,
}: {
  model: ProviderModel;
  provider: AiProvider;
  active: boolean;
  onSelect: () => void;
}) {
  const ts = useThemeStyles();
  const contextLabel = formatContextLength(model.contextLength);
  const tier: 'free' | 'paid' | null =
    model.isFree === true ? 'free' : model.isFree === false ? 'paid' : null;

  return (
    <ScalePressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${model.displayName}, ${active ? 'active model' : 'select model'}`}
      style={[
        styles.modelRow,
        {
          backgroundColor: active ? ts.raw.purple100 : ts.bg.low,
          borderColor: active ? ts.raw.primaryBorder : ts.raw.outline,
        },
      ]}
    >
      <View
        style={[
          styles.modelRadio,
          {
            borderColor: active ? ts.raw.primary : ts.raw.onSurfaceVariant,
            backgroundColor: active ? ts.raw.primary : 'transparent',
          },
        ]}
      >
        {active ? <Check size={11} color={ts.raw.onPrimary} strokeWidth={3} /> : null}
      </View>
      <View style={styles.modelMain}>
        <View style={styles.modelTitleRow}>
          <Text
            numberOfLines={1}
            style={[Typography.captionBold, styles.modelName, { color: ts.raw.onSurface }]}
          >
            {model.displayName}
          </Text>
          {contextLabel ? (
            <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
              {`(${contextLabel})`}
            </Text>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
          {`${providerLabel(model, provider)} • ${model.id}`}
        </Text>
      </View>
      {tier === 'free' ? (
        <View style={[styles.tierBadge, { backgroundColor: ts.raw.successContainer, borderColor: ts.raw.successBorder }]}>
          <Text style={[Typography.micro, styles.tierText, { color: ts.raw.successText }]}>FREE</Text>
        </View>
      ) : tier === 'paid' ? (
        <View style={[styles.tierBadge, { backgroundColor: ts.bg.elevated, borderColor: ts.raw.outline }]}>
          <Text style={[Typography.micro, styles.tierText, { color: ts.raw.onSurfaceVariant }]}>PAID</Text>
        </View>
      ) : null}
    </ScalePressable>
  );
}

function KeyStatusBadge({
  state,
  readyLabel,
  tone = 'success',
}: {
  state: MaskedKeyState | undefined;
  readyLabel: string;
  tone?: 'success' | 'purple';
}) {
  const ts = useThemeStyles();
  const configured = state?.status === 'configured';
  // Canonical differentiates the two provider badges: Gemini active is emerald
  // (HTML 203) and OpenRouter connected is purple (HTML 230).
  const configuredPurple = configured && tone === 'purple';
  const background = !configured
    ? ts.raw.warningContainer
    : configuredPurple
      ? ts.raw.purple100
      : ts.raw.statusSuccessContainer;
  const border = !configured
    ? ts.raw.warningBorder
    : configuredPurple
      ? ts.raw.primaryBorder
      : ts.raw.successBorder;
  const textColor = !configured
    ? ts.raw.warningContainerText
    : configuredPurple
      ? ts.raw.primary
      : ts.raw.statusSuccessText;
  const dotColor = textColor;

  return (
    <View style={[styles.statusBadge, { backgroundColor: background, borderColor: border }]}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <Text style={[Typography.micro, styles.statusText, { color: textColor }]}>
        {configured ? readyLabel : 'Key Missing'}
      </Text>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const ts = useThemeStyles();
  return (
    <Text style={[Typography.micro, styles.sectionLabel, { color: ts.raw.onSurfaceVariant }]}>
      {children}
    </Text>
  );
}

export default function ChatSettingsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const toast = useToast();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ origin?: string }>();

  const [loading, setLoading] = useState(true);
  const [keyState, setKeyState] = useState<ProviderKeyState | null>(null);
  const [history, setHistory] = useState<ConversationHistoryState | null>(null);
  const [geminiModels, setGeminiModels] = useState<ProviderModel[]>([]);
  const [openRouterModels, setOpenRouterModels] = useState<ProviderModel[]>([]);
  const [activeGeminiModel, setActiveGeminiModel] = useState('');
  const [activeOpenRouterModel, setActiveOpenRouterModel] = useState('');
  const [provider, setProvider] = useState<AiProvider>('openrouter');
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<ModelTierFilter>('all');
  const [geminiRevealed, setGeminiRevealed] = useState(false);
  const [openRouterRevealed, setOpenRouterRevealed] = useState(false);
  const [savingKey, setSavingKey] = useState<AiProvider | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // The two key fields are uncontrolled so the stored secret is never read into
  // React state. Drafts live in refs and are cleared as soon as they are saved.
  const geminiInputRef = useRef<TextInput>(null);
  const openRouterInputRef = useRef<TextInput>(null);
  const geminiDraft = useRef('');
  const openRouterDraft = useRef('');

  const loadScreen = useCallback(async () => {
    const [keys, historyState, cachedGemini, cachedOpenRouter, geminiSetting, openRouterSetting] =
      await Promise.all([
        aiChatService.getProviderKeyState(),
        aiChatService.getConversationHistoryState(),
        aiChatService.getCachedGeminiModels(),
        aiChatService.getCachedOpenRouterModels(),
        databaseService.getSetting(GEMINI_MODEL_SETTING),
        databaseService.getSetting(OPENROUTER_MODEL_SETTING),
      ]);
    setKeyState(keys);
    setHistory(historyState);
    setGeminiModels(cachedGemini.map((model) => ({ id: model.name, displayName: model.displayName })));
    setOpenRouterModels(
      cachedOpenRouter.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        isFree: model.isFree,
        contextLength: model.contextLength,
      })),
    );
    setActiveGeminiModel(geminiSetting ?? '');
    setActiveOpenRouterModel(openRouterSetting ?? '');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadScreen();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadScreen]);

  const filteredModels = useMemo(() => {
    const source = provider === 'gemini' ? geminiModels : openRouterModels;
    const normalizedQuery = query.trim().toLowerCase();
    return source.filter((model) => {
      const matchesSearch =
        normalizedQuery.length === 0 ||
        model.displayName.toLowerCase().includes(normalizedQuery) ||
        model.id.toLowerCase().includes(normalizedQuery);
      const matchesTier =
        tierFilter === 'all' ||
        (tierFilter === 'free' ? model.isFree === true : model.isFree === false);
      return matchesSearch && matchesTier;
    });
  }, [provider, geminiModels, openRouterModels, query, tierFilter]);

  const activeModelId = provider === 'gemini' ? activeGeminiModel : activeOpenRouterModel;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/chat');
  };

  const saveKey = async (target: AiProvider) => {
    const draft = target === 'gemini' ? geminiDraft.current.trim() : openRouterDraft.current.trim();
    const label = target === 'gemini' ? 'Gemini' : 'OpenRouter';
    if (!draft) {
      setErrorNotice(`Enter a ${label} key before saving.`);
      return;
    }
    setSavingKey(target);
    setErrorNotice(null);
    try {
      await databaseService.updateSetting(
        target === 'gemini' ? GEMINI_SECRET_KEY : OPENROUTER_SECRET_KEY,
        draft,
      );
      if (target === 'gemini') {
        geminiDraft.current = '';
        geminiInputRef.current?.clear();
        setGeminiRevealed(false);
      } else {
        openRouterDraft.current = '';
        openRouterInputRef.current?.clear();
        setOpenRouterRevealed(false);
      }
      setKeyState(await aiChatService.getProviderKeyState());
      toast.showToast(`${label} key saved`, 'success');
    } catch {
      setErrorNotice(`${label} key could not be saved.`);
      toast.showToast(`${label} key could not be saved`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const runRefresh = async () => {
    setRefreshing(true);
    setErrorNotice(null);
    try {
      const outcome: ModelRefreshOutcome = await aiChatService.refreshProviderModels(provider);
      if (provider === 'gemini') setGeminiModels(outcome.models);
      else setOpenRouterModels(outcome.models);
      if (outcome.status === 'success') {
        toast.showToast('Models updated', 'success');
      } else {
        setErrorNotice(getAiErrorMessage(outcome.errorCode, 'chat'));
      }
    } catch {
      setErrorNotice('Models could not be refreshed. Try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const selectModel = async (model: ProviderModel) => {
    const settingKey = provider === 'gemini' ? GEMINI_MODEL_SETTING : OPENROUTER_MODEL_SETTING;
    await databaseService.updateSetting(settingKey, model.id);
    if (provider === 'gemini') setActiveGeminiModel(model.id);
    else setActiveOpenRouterModel(model.id);
    toast.showToast(`Model set to ${model.displayName}`, 'success');
  };

  const confirmClear = async () => {
    setClearing(true);
    try {
      await aiChatService.clearHistory();
      setHistory(await aiChatService.getConversationHistoryState());
      setClearOpen(false);
      toast.showToast('Conversation cleared', 'success');
    } catch {
      toast.showToast('Could not clear conversation', 'error');
    } finally {
      setClearing(false);
    }
  };

  const originLabel =
    params.origin === 'scan' ? 'Return to S-06 Neural Scan' : 'Return to S-07 AI Chat';

  const header = (
    <View>
      <LinearGradient
        colors={ts.isDark ? Gradients.dark : Gradients.light}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.vaultCard, { borderColor: ts.raw.primaryBorder + '40' }]}
      >
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={[styles.vaultGlow, { backgroundColor: ts.raw.primaryContainer }]}
        />
        <View style={styles.vaultRow}>
          <View style={styles.vaultIcon}>
            <Lock size={16} color={ts.raw.onPrimary} />
          </View>
          <View style={styles.vaultText}>
            <View style={styles.vaultTitleRow}>
              <Text style={[Typography.captionBold, styles.vaultTitle]}>Centralized Dual-Key Vault</Text>
              <View style={styles.frhBadge}>
                <Text style={[Typography.micro, styles.frhText]}>FR-17.1</Text>
              </View>
            </View>
            <Text style={[Typography.labelMd, styles.vaultBody]}>
              Keys saved here drive S-07 AI Chat. Stored in the device secure store with no
              duplicate key field anywhere else.
            </Text>
          </View>
        </View>
      </LinearGradient>

      {errorNotice ? (
        <View style={[styles.errorBanner, { backgroundColor: ts.raw.dangerSoft, borderColor: ts.raw.danger }]}>
          <AlertTriangle size={16} color={ts.raw.danger} />
          <View style={styles.errorText}>
            <Text style={[Typography.captionBold, { color: ts.raw.danger }]}>Action failed</Text>
            <Text style={[Typography.labelMd, { color: ts.raw.danger }]}>{errorNotice}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <FieldLabel>Provider Credentials</FieldLabel>
        <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Secure storage</Text>
      </View>

      <LuminousCard variant="low" style={styles.keyCard}>
        <View style={styles.keyCardHead}>
          <View style={styles.keyIdentity}>
            <View style={[styles.keyChip, { backgroundColor: ts.bg.primary20 }]}>
              <Text style={[Typography.micro, styles.keyChipText, { color: ts.raw.primary }]}>G</Text>
            </View>
            <Text style={[Typography.captionBold, { color: ts.raw.onSurface }]}>Google Gemini Key</Text>
          </View>
          <KeyStatusBadge state={keyState?.gemini} readyLabel="Active" />
        </View>
        <View style={styles.inputWrap}>
          <TextInput
            ref={geminiInputRef}
            onChangeText={(text) => {
              geminiDraft.current = text;
              setErrorNotice(null);
            }}
            placeholder={maskPlaceholder(keyState?.gemini) ?? 'Paste AIzaSy... key'}
            placeholderTextColor={ts.raw.onSurfaceVariant}
            secureTextEntry={!geminiRevealed}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Gemini API key"
            style={[
              Typography.labelMd,
              styles.keyInput,
              {
                backgroundColor: ts.bg.screen,
                borderColor: ts.raw.outline,
                color: ts.raw.onSurface,
              },
            ]}
          />
          <ScalePressable
            onPress={() => setGeminiRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={geminiRevealed ? 'Hide Gemini key' : 'Show Gemini key'}
            style={styles.eyeButton}
          >
            {geminiRevealed ? (
              <EyeOff size={18} color={ts.raw.onSurfaceVariant} />
            ) : (
              <Eye size={18} color={ts.raw.onSurfaceVariant} />
            )}
          </ScalePressable>
        </View>
        <View style={styles.keyCardFoot}>
          <Text style={[Typography.micro, styles.keyHint, { color: ts.raw.onSurfaceVariant }]}>
            Default fallback engine
          </Text>
          <PeachButton
            title="Save Key"
            onPress={() => saveKey('gemini')}
            variant="secondary"
            size="xs"
            isLoading={savingKey === 'gemini'}
            disabled={savingKey !== null && savingKey !== 'gemini'}
          />
        </View>
      </LuminousCard>

      <LuminousCard variant="low" style={styles.keyCard}>
        <View style={styles.keyCardHead}>
          <View style={styles.keyIdentity}>
            <View style={[styles.keyChip, { backgroundColor: ts.raw.purple100 }]}>
              <Text style={[Typography.micro, styles.keyChipText, { color: ts.raw.primary }]}>OR</Text>
            </View>
            <Text style={[Typography.captionBold, { color: ts.raw.onSurface }]}>OpenRouter Key</Text>
          </View>
          <KeyStatusBadge
            state={keyState?.openrouter}
            tone="purple"
            readyLabel={
              openRouterModels.length > 0
                ? `${openRouterModels.length} Models Ready`
                : 'Connected'
            }
          />
        </View>
        <View style={styles.inputWrap}>
          <TextInput
            ref={openRouterInputRef}
            onChangeText={(text) => {
              openRouterDraft.current = text;
              setErrorNotice(null);
            }}
            placeholder={maskPlaceholder(keyState?.openrouter) ?? 'Paste sk-or-v1-... key'}
            placeholderTextColor={ts.raw.onSurfaceVariant}
            secureTextEntry={!openRouterRevealed}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="OpenRouter API key"
            style={[
              Typography.labelMd,
              styles.keyInput,
              {
                backgroundColor: ts.bg.screen,
                borderColor: ts.raw.outline,
                color: ts.raw.onSurface,
              },
            ]}
          />
          <ScalePressable
            onPress={() => setOpenRouterRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={openRouterRevealed ? 'Hide OpenRouter key' : 'Show OpenRouter key'}
            style={styles.eyeButton}
          >
            {openRouterRevealed ? (
              <EyeOff size={18} color={ts.raw.onSurfaceVariant} />
            ) : (
              <Eye size={18} color={ts.raw.onSurfaceVariant} />
            )}
          </ScalePressable>
        </View>
        <View style={styles.keyCardFoot}>
          <Text style={[Typography.micro, styles.keyHint, { color: ts.raw.onSurfaceVariant }]}>
            Supports Claude, Llama 3 and Mistral
          </Text>
          <PeachButton
            title="Save Key"
            onPress={() => saveKey('openrouter')}
            variant="primary"
            size="xs"
            isLoading={savingKey === 'openrouter'}
            disabled={savingKey !== null && savingKey !== 'openrouter'}
          />
        </View>
      </LuminousCard>

      <View style={styles.sectionHead}>
        <View style={styles.sectionHeadText}>
          <FieldLabel>Model Selector</FieldLabel>
          <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
            Dynamic discovery via your provider
          </Text>
        </View>
        <PeachButton
          title={refreshing ? 'Syncing...' : 'Refresh'}
          onPress={runRefresh}
          variant="quiet"
          size="xs"
          icon={<RefreshCw size={14} color={ts.raw.primary} />}
          isLoading={refreshing}
        />
      </View>

      <View style={[styles.providerTabs, { backgroundColor: ts.bg.screen, borderColor: ts.raw.outline }]}>
        {(['openrouter', 'gemini'] as const).map((tab) => {
          const selected = provider === tab;
          const label = tab === 'openrouter' ? 'OpenRouter' : 'Google Gemini';
          const count = tab === 'openrouter' ? openRouterModels.length : geminiModels.length;
          return (
            <ScalePressable
              key={tab}
              onPress={() => setProvider(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={[
                styles.providerTab,
                selected && { backgroundColor: ts.raw.primary },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  Typography.captionBold,
                  { color: selected ? ts.raw.onPrimary : ts.raw.onSurfaceVariant },
                ]}
              >
                {`${label} (${count})`}
              </Text>
            </ScalePressable>
          );
        })}
      </View>

      <SearchFilterBar
        expanded
        onExpandedChange={() => undefined}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search models (e.g. claude, llama, free)..."
        chips={[
          {
            id: 'all',
            label: 'All Models',
            tone: tierFilter === 'all' ? 'applied' : 'default',
            onPress: () => setTierFilter('all'),
          },
          {
            id: 'free',
            label: 'Free Tier Only',
            tone: tierFilter === 'free' ? 'active' : 'default',
            onPress: () => setTierFilter('free'),
          },
          {
            id: 'paid',
            label: 'Paid Tier',
            tone: tierFilter === 'paid' ? 'applied' : 'default',
            onPress: () => setTierFilter('paid'),
          },
        ]}
        resultCount={filteredModels.length}
        resultLabel="models"
        totalLabel={refreshing ? 'Syncing' : undefined}
      />
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <FieldLabel>Local Data Retention</FieldLabel>
      <LuminousCard variant="low" style={styles.historyCard}>
        <View style={styles.historyHead}>
          <View style={styles.historyHeadText}>
            <Text style={[Typography.captionBold, { color: ts.raw.onSurface }]}>
              Conversation History (S-07)
            </Text>
            <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
              {`${history?.messageCount ?? 0} messages stored locally`}
            </Text>
          </View>
          <View style={[styles.storageChip, { backgroundColor: ts.bg.elevated, borderColor: ts.raw.outline }]}>
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>SQLite</Text>
          </View>
        </View>
        <View style={[styles.autoClear, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primaryBorder }]}>
          <Clock size={16} color={ts.raw.primary} />
          <Text style={[Typography.micro, styles.autoClearText, { color: ts.raw.onSurface }]}>
            {history?.willAutoClear
              ? 'Stale messages are due to be cleared on next chat activity.'
              : `Auto-clears after ${history?.autoClearDays ?? 7} days of inactivity.`}
          </Text>
        </View>
        <PeachButton
          title="Clear All Chat Messages"
          onPress={() => setClearOpen(true)}
          variant="destructive"
          size="md"
          fullWidth
          icon={<Trash2 size={16} color={ts.raw.danger} />}
        />
      </LuminousCard>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: ts.raw.outline }]}>
        <View style={styles.headerInner}>
          <ScalePressable
            onPress={handleBack}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={[styles.headerCircle, { backgroundColor: ts.bg.elevated }]}
          >
            <ArrowLeft size={20} color={ts.raw.onSurface} />
          </ScalePressable>
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
            >
              AI Chat Settings
            </Text>
            <View style={styles.headerOrigin}>
              <View style={[styles.headerDot, { backgroundColor: ts.raw.primary }]} />
              <Text
                numberOfLines={1}
                style={[Typography.micro, styles.headerOriginText, { color: ts.raw.primary }]}
              >
                {originLabel}
              </Text>
            </View>
          </View>
          <ScalePressable
            onPress={() => toast.showToast('Keys are stored in the device secure store.', 'info')}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Security information"
            style={[styles.headerCircle, { backgroundColor: ts.bg.low }]}
          >
            <HelpCircle size={18} color={ts.raw.onSurfaceVariant} />
          </ScalePressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={ts.raw.primary} />
          <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
            Loading settings...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredModels}
          keyExtractor={(item) => `${provider}:${item.id}`}
          renderItem={({ item }) => (
            <ModelRow
              model={item}
              provider={provider}
              active={item.id === activeModelId}
              onSelect={() => void selectModel(item)}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { borderColor: ts.raw.outline }]}>
              <Text style={[Typography.labelMd, styles.emptyText, { color: ts.raw.onSurfaceVariant }]}>
                No matching models found
              </Text>
              <Text style={[Typography.micro, styles.emptyText, { color: ts.raw.onSurfaceVariant }]}>
                {provider === 'openrouter' && openRouterModels.length === 0
                  ? 'Save a key and tap Refresh to load the live list.'
                  : 'Try clearing filters or search query.'}
              </Text>
            </View>
          }
          ListFooterComponent={footer}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        />
      )}

      <Modal
        visible={clearOpen}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setClearOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setClearOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.danger }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              style={[styles.modalHandle, { backgroundColor: ts.raw.onSurfaceVariant + '66' }]}
            />
            <View style={[styles.modalIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <AlertTriangle size={24} color={ts.raw.danger} />
            </View>
            <Text accessibilityRole="header" style={[Typography.headlineMd, styles.modalTitle, { color: ts.raw.onSurface }]}>
              Clear All Chat History?
            </Text>
            <Text style={[Typography.labelMd, styles.modalBody, { color: ts.raw.onSurfaceVariant }]}>
              {`${history?.messageCount ?? 0} messages will be permanently removed from local storage. Ledger transactions remain intact.`}
            </Text>
            <View style={styles.modalActions}>
              <PeachButton
                title="Keep Messages"
                onPress={() => setClearOpen(false)}
                variant="neutral"
                size="sm"
                fullWidth
                disabled={clearing}
                style={styles.modalButton}
              />
              <PeachButton
                title="Clear History"
                onPress={() => void confirmClear()}
                variant="destructive"
                size="sm"
                fullWidth
                isLoading={clearing}
                style={styles.modalButton}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s4,
    paddingBottom: Spacing.s9,
    gap: Spacing.s3,
  },
  header: {
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    alignSelf: 'center',
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  headerCircle: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerOrigin: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, marginTop: 2 },
  headerDot: { width: 6, height: 6, borderRadius: Radii.full },
  headerOriginText: { flexShrink: 1 },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.s2 },

  vaultCard: {
    borderRadius: Radii.md,
    padding: Spacing.s3,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Canonical decorative corner glow (HTML 160): a clipped low-opacity brand
  // circle in the bottom-right, matching the StatCard glow precedent.
  vaultGlow: {
    position: 'absolute',
    right: -24,
    bottom: -24,
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.12,
  },
  vaultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s3 },
  vaultIcon: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  vaultText: { flex: 1, minWidth: 0 },
  vaultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexWrap: 'wrap' },
  vaultTitle: { color: '#FFFFFF' },
  frhBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.s1,
    paddingVertical: 2,
  },
  frhText: { color: '#FFFFFF', letterSpacing: 1 },
  vaultBody: { color: 'rgba(255,255,255,0.82)', marginTop: Spacing.s1 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
    marginTop: Spacing.s3,
  },
  errorText: { flex: 1, minWidth: 0 },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginTop: Spacing.s4,
    marginBottom: Spacing.s2,
  },
  sectionHeadText: { flex: 1, minWidth: 0 },
  sectionLabel: { letterSpacing: 1.6, textTransform: 'uppercase' },

  keyCard: { marginBottom: Spacing.s3 },
  keyCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s2,
  },
  keyIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 },
  keyChip: {
    width: 24,
    height: 24,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyChipText: { letterSpacing: 0.5 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    flexShrink: 0,
  },
  statusDot: { width: 6, height: 6, borderRadius: Radii.full },
  statusText: { letterSpacing: 0.2 },
  inputWrap: { position: 'relative', justifyContent: 'center' },
  keyInput: {
    minHeight: 46,
    borderRadius: Radii.sm,
    borderWidth: 1,
    paddingLeft: Spacing.s3,
    // Canonical pr-10 (HTML 209): keeps the typed draft clear of the 44pt eye.
    paddingRight: Spacing.s8,
    paddingVertical: Spacing.s2,
    letterSpacing: 1,
  },
  eyeButton: {
    position: 'absolute',
    right: 2,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginTop: Spacing.s2,
  },
  keyHint: { flexShrink: 1 },

  providerTabs: {
    flexDirection: 'row',
    padding: Spacing.s1,
    borderRadius: Radii.sm,
    borderWidth: 1,
    marginBottom: Spacing.s3,
  },
  providerTab: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s2,
  },

  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  modelRadio: {
    width: 16,
    height: 16,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelMain: { flex: 1, minWidth: 0 },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  modelName: { flexShrink: 1 },
  tierBadge: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    flexShrink: 0,
  },
  tierText: { letterSpacing: 0.5 },
  rowGap: { height: Spacing.s2 },

  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radii.md,
    padding: Spacing.s5,
    alignItems: 'center',
    gap: Spacing.s1,
  },
  emptyText: { textAlign: 'center' },

  footer: { marginTop: Spacing.s4 },
  historyCard: { gap: Spacing.s3 },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  historyHeadText: { flex: 1, minWidth: 0 },
  storageChip: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    flexShrink: 0,
  },
  autoClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    padding: Spacing.s3,
  },
  autoClearText: { flex: 1, minWidth: 0 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    // Canonical clear-history dialog is anchored to the bottom (HTML 320).
    justifyContent: 'flex-end',
    padding: Spacing.s5,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s5,
    alignItems: 'center',
    gap: Spacing.s3,
  },
  modalHandle: {
    width: 48,
    height: 4,
    borderRadius: Radii.full,
    marginTop: -Spacing.s2,
    marginBottom: -Spacing.s1,
  },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: { textAlign: 'center' },
  modalBody: { textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: Spacing.s3, width: '100%' },
  modalButton: { flex: 1 },
});
