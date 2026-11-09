import { describe, expect, it } from 'vitest';
import {
  buildDetectionAppLink,
  detectionRouteFor,
  parseDetectionAppLink,
} from './detectionDeepLink';

describe('detection deep link contract', () => {
  it('builds the summary link without a view param', () => {
    expect(buildDetectionAppLink('draft-1')).toBe('app://detection/draft-1');
  });

  it('builds the edit link with the edit view param', () => {
    expect(buildDetectionAppLink('draft-1', 'edit')).toBe('app://detection/draft-1?view=edit');
  });

  it('round trips summary and edit links', () => {
    expect(parseDetectionAppLink(buildDetectionAppLink('abc-123'))).toEqual({ draftId: 'abc-123', view: 'summary' });
    expect(parseDetectionAppLink(buildDetectionAppLink('abc-123', 'edit'))).toEqual({ draftId: 'abc-123', view: 'edit' });
  });

  it('rejects foreign schemes, hosts, and empty ids', () => {
    expect(parseDetectionAppLink(null)).toBeNull();
    expect(parseDetectionAppLink('')).toBeNull();
    expect(parseDetectionAppLink('https://detection/abc')).toBeNull();
    expect(parseDetectionAppLink('app://notifications/abc')).toBeNull();
    expect(parseDetectionAppLink('app://detection/')).toBeNull();
    expect(parseDetectionAppLink('app://detection/%zz')).toBeNull();
  });

  it('falls back to summary on unknown or missing view params', () => {
    expect(parseDetectionAppLink('app://detection/abc?view=banner')).toEqual({ draftId: 'abc', view: 'summary' });
    expect(parseDetectionAppLink('app://detection/abc?other=1&view=edit')).toEqual({ draftId: 'abc', view: 'edit' });
  });

  it('exposes the typed route for the router push', () => {
    expect(detectionRouteFor('abc-123')).toEqual({ pathname: '/detection/[id]', params: { id: 'abc-123' } });
    expect(detectionRouteFor('abc-123', 'edit')).toEqual({
      pathname: '/detection/[id]',
      params: { id: 'abc-123', view: 'edit' },
    });
  });
});
