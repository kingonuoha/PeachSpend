import type { AutoCaptureEventSource } from './contracts';

export type NativeAutoCaptureEventSource = AutoCaptureEventSource;

export interface AutoCaptureRuntimeStatus {
  nativeEventSourceAvailable: boolean;
  unsupportedReason?: string;
  capability?: 'available' | 'unavailable' | 'unsupported';
}

const unsupportedStatus: AutoCaptureRuntimeStatus = {
  nativeEventSourceAvailable: false,
  capability: 'unavailable',
  unsupportedReason: 'No approved native notification event source is installed; queue accepts only explicit native integration events.',
};

export class AutoCaptureRuntime {
  private running = false;
  private status: AutoCaptureRuntimeStatus = unsupportedStatus;

  getStatus(): AutoCaptureRuntimeStatus { return this.status; }

  start(source?: AutoCaptureEventSource): () => void {
    if (this.running) return () => this.stop();
    this.running = true;
    const capability = source?.capability ?? 'unavailable';
    this.status = { nativeEventSourceAvailable: capability === 'available', capability, unsupportedReason: capability === 'available' ? undefined : unsupportedStatus.unsupportedReason };
    return () => this.stop();
  }

  stop(): void {
    this.running = false;
  }
}
