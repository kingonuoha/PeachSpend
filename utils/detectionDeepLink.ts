// Phase 14 M2 deep link contract. One URL shape carries a detection draft from
// the device alert (content tap, Edit action) and from the inbox row tap to the
// same sheet, `app/detection/[id]`. The native side builds the app link form,
// the router consumes the route form; both directions parse here so the shape
// can never drift between the two callers. Cold start keeps the native splash
// (unavoidable) and expo-router delivers the link to the route directly, with
// no intermediate screen. The biometric gate wraps the whole tree, so the
// sheet stays behind the prompt exactly like a manual open.
//
// A blank view means the summary face; `edit` opens the sheet with fields
// prefilled. Unknown views fall back to summary rather than failing the open.

export const DETECTION_LINK_SCHEME = 'app';
export const DETECTION_LINK_HOST = 'detection';

export type DetectionSheetView = 'summary' | 'edit';

export interface DetectionRoute {
  pathname: '/detection/[id]';
  params: { id: string; view?: string };
}

export interface ParsedDetectionLink {
  draftId: string;
  view: DetectionSheetView;
}

export function detectionRouteFor(draftId: string, view: DetectionSheetView = 'summary'): DetectionRoute {
  return {
    pathname: '/detection/[id]',
    params: view === 'edit' ? { id: draftId, view } : { id: draftId },
  };
}

// The URI the native alert posts (content intent, full screen intent, Edit
// action). Draft ids are uuid hex plus dashes, always URI safe; a defensive
// encode keeps a future id shape from breaking the parse.
export function buildDetectionAppLink(draftId: string, view: DetectionSheetView = 'summary'): string {
  const encoded = encodeURIComponent(draftId.trim());
  return view === 'edit'
    ? `${DETECTION_LINK_SCHEME}://${DETECTION_LINK_HOST}/${encoded}?view=edit`
    : `${DETECTION_LINK_SCHEME}://${DETECTION_LINK_HOST}/${encoded}`;
}

export function parseDetectionAppLink(url: string | null | undefined): ParsedDetectionLink | null {
  if (!url) return null;
  const trimmed = url.trim();
  const prefix = `${DETECTION_LINK_SCHEME}://${DETECTION_LINK_HOST}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const rest = trimmed.slice(prefix.length);
  if (!rest) return null;
  const [encodedId, query] = rest.split('?', 2);
  let draftId: string;
  try {
    draftId = decodeURIComponent(encodedId ?? '');
  } catch {
    return null;
  }
  if (!draftId.trim()) return null;
  const view = parseViewParam(query ?? '');
  return { draftId: draftId.trim(), view };
}

function parseViewParam(query: string): DetectionSheetView {
  if (!query) return 'summary';
  for (const part of query.split('&')) {
    const [key, value] = part.split('=', 2);
    if (key === 'view' && value === 'edit') return 'edit';
  }
  return 'summary';
}
