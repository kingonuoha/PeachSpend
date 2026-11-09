import type { ProcessingStep } from './AIProcessingOverlay';

// Phase 11 B2-1 and B2-6. The real pipeline boundaries both capture screens can
// observe, in order.
//
// Progress is a count of these, not a timer: a step reports `done` only after the
// await that represents it has resolved. The provider call is one opaque await, so the
// screen reports "requesting" for its whole duration rather than inventing inner
// stages. The labels name the thing being captured so a shared image is never
// described as a photo the user just took.

export const PIPELINE_STAGES = ['captured', 'requesting', 'parsing', 'ready'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineContext = 'receipt' | 'gallery' | 'product' | 'share';

const CAPTURED_LABEL: Record<PipelineContext, string> = {
  receipt: 'Photo saved on this device',
  gallery: 'Image copied from your gallery',
  product: 'Photo saved on this device',
  share: 'Shared image saved on this device',
};

export function pipelineSteps(stage: PipelineStage | null, context: PipelineContext): ProcessingStep[] {
  const currentIndex = stage === null ? -1 : PIPELINE_STAGES.indexOf(stage);
  const labels: Record<PipelineStage, string> = {
    captured: CAPTURED_LABEL[context],
    requesting: 'Sent to your AI provider',
    parsing: 'Read the parsed result',
    ready: 'Ready for you to review',
  };
  return PIPELINE_STAGES.map((entry, index) => ({
    label: labels[entry],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending',
  }));
}
