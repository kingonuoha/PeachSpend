import { v4 as uuid } from 'uuid';
import type {
  AutoCaptureEvent,
  AutoCaptureEventSource,
  AutoCaptureHost as AutoCaptureHostContract,
  AutoCaptureHostState,
  AutoCapturePermission,
  AutoCaptureCapability,
  AutoCaptureSourceDescriptor,
  CaptureRepository,
} from './contracts';

const INITIAL_STATE: AutoCaptureHostState = {
  enabled: false,
  permission: 'unsupported',
  listenerAvailable: false,
  capability: 'unavailable',
  supportedSources: [],
  overlayActive: false,
  pendingCount: 0,
};
const MAX_PENDING_EVENTS = 50;

export class RootAutoCaptureHost implements AutoCaptureHostContract {
  private state = INITIAL_STATE;
  private currentEvent: AutoCaptureEvent | null = null;
  private pendingEvents: AutoCaptureEvent[] = [];
  private sourceUnsubscribe: (() => void) | null = null;
  private source: AutoCaptureEventSource | null = null;
  private requestedEnabled = false;
  private lifecycle = 0;
  private seenEventIds = new Set<string>();
  private listeners = new Set<(state: AutoCaptureHostState) => void>();

  constructor(private readonly repository: CaptureRepository) {}

  getState(): AutoCaptureHostState { return this.state; }

  setEnabled(enabled: boolean): void {
    this.requestedEnabled = enabled;
    if (!enabled) {
      this.stopSource();
      return;
    }
    this.reconcile();
  }

  setPermission(permission: AutoCapturePermission): void {
    this.updateState({ permission });
    this.reconcile();
  }

  setCapability(capability: AutoCaptureCapability, supportedSources: AutoCaptureSourceDescriptor[] = []): void {
    this.updateState({ capability, supportedSources });
  }

  start(source?: AutoCaptureEventSource, queueEvents = true): () => void {
    if (this.source !== (source ?? null)) this.stopSubscription();
    this.source = source ?? null;
    this.reconcile(queueEvents);
    return () => this.stop();
  }

  syncLifecycle(enabled: boolean, permission: AutoCapturePermission, source?: AutoCaptureEventSource, queueEvents = true): void {
    this.requestedEnabled = enabled;
    this.updateState({ permission });
    if (this.source !== (source ?? null)) this.stopSubscription();
    this.source = source ?? null;
    this.reconcile(queueEvents);
  }

  async presentEvent(event: AutoCaptureEvent): Promise<void> {
    if (!this.state.enabled || this.state.permission !== 'granted') return;
    if (this.currentEvent) {
      if (this.pendingEvents.length >= MAX_PENDING_EVENTS) this.pendingEvents.shift();
      this.pendingEvents.push(event);
    }
    else this.currentEvent = event;
    this.updateState({ overlayActive: true, pendingCount: this.totalPending() });
  }

  subscribe(listener: (state: AutoCaptureHostState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  stop(): void { this.stopSource(); }

  claimOverlay(): AutoCaptureEvent | null {
    if (!this.currentEvent) this.currentEvent = this.pendingEvents.shift() ?? null;
    if (!this.currentEvent) return null;
    this.updateState({ overlayActive: true, pendingCount: this.totalPending() });
    return this.currentEvent;
  }

  releaseOverlay(): void {
    if (!this.currentEvent) return;
    this.currentEvent = null;
    this.updateState({ overlayActive: false, pendingCount: this.totalPending() });
  }

  private async handleEvent(event: AutoCaptureEvent): Promise<void> {
    if (!this.isLive()) return;
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    await this.presentEvent(event);
  }

  private stopSource(): void {
    this.lifecycle += 1;
    this.sourceUnsubscribe?.();
    this.sourceUnsubscribe = null;
    this.currentEvent = null;
    this.pendingEvents = [];
    this.seenEventIds.clear();
    this.requestedEnabled = false;
    this.updateState({ listenerAvailable: false, enabled: false, overlayActive: false, pendingCount: this.totalPending() });
  }

  private reconcile(queueEvents = true): void {
    if (this.sourceUnsubscribe && this.requestedEnabled && this.state.permission === 'granted' && this.source) return;
    this.stopSubscription();
    this.source?.setLifecycle?.(this.requestedEnabled, this.state.permission);
    const live = this.requestedEnabled && this.state.permission === 'granted' && this.source !== null;
    if (!live) {
      this.clearPending();
      this.updateState({ enabled: false, listenerAvailable: false, overlayActive: false, pendingCount: this.totalPending() });
      return;
    }
    const source = this.source;
    if (!source) return;
    const lifecycle = this.lifecycle;
    this.sourceUnsubscribe = source.subscribe(event => {
      if (lifecycle !== this.lifecycle || !this.isLive()) return;
      if (queueEvents) void this.handleEvent(event);
      else void this.presentEvent(event);
    });
    this.updateState({ enabled: true, listenerAvailable: true });
  }

  private stopSubscription(): void {
    this.lifecycle += 1;
    this.sourceUnsubscribe?.();
    this.sourceUnsubscribe = null;
    this.source?.setLifecycle?.(false, this.state.permission);
  }

  private isLive(): boolean {
    return this.requestedEnabled && this.state.enabled && this.state.permission === 'granted';
  }

  private clearPending(): void {
    this.currentEvent = null;
    this.pendingEvents = [];
  }

  private totalPending(): number {
    return (this.currentEvent ? 1 : 0) + this.pendingEvents.length;
  }

  private updateState(update: Partial<AutoCaptureHostState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener(this.state);
  }
}

export function createAutoCaptureEvent(candidate: AutoCaptureEvent['candidate'], receivedAt = Date.now()): AutoCaptureEvent {
  return { id: uuid(), receivedAt, candidate };
}
