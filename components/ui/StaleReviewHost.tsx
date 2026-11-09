import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { databaseService } from '../../services/DatabaseService';
import { loadStaleReview } from '../../services/StaleReviewService';
import { StaleReviewSheet } from './StaleReviewSheet';

// Phase 14 M5 foreground nag host. On app start and on every return to the
// foreground it asks the D1 stale query for drafts older than STALE_AFTER_MS
// (72 hours, one named constant). When at least one exists it opens the
// queued review sheet; closing the sheet never blocks the app (DEC-14-04),
// and the sheet stays quiet for the same stale set until the set changes or
// the app foregrounds again. It renders nothing except the queued sheet.
export function StaleReviewHost() {
  const [open, setOpen] = useState(false);
  const dismissedKey = useRef<string | null>(null);

  const check = useCallback(() => {
    void databaseService
      .getDetectionDraftStore()
      .then(store => loadStaleReview(store, Date.now()))
      .then(stale => {
        if (stale.length === 0) {
          dismissedKey.current = null;
          return;
        }
        const key = stale
          .map(item => item.draft.id)
          .sort()
          .join(',');
        if (dismissedKey.current === key) return;
        setOpen(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') check();
    });
    check();
    return () => subscription.remove();
  }, [check]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const completed = useCallback(() => {
    void databaseService
      .getDetectionDraftStore()
      .then(store => loadStaleReview(store, Date.now()))
      .then(stale => {
        if (stale.length === 0) {
          dismissedKey.current = null;
          setOpen(false);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleClose = useCallback(() => {
    void databaseService
      .getDetectionDraftStore()
      .then(store => loadStaleReview(store, Date.now()))
      .then(stale => {
        dismissedKey.current =
          stale.length === 0
            ? null
            : stale
                .map(item => item.draft.id)
                .sort()
                .join(',');
      })
      .catch(() => undefined)
      .finally(() => {
        close();
      });
  }, [close]);

  if (!open) return null;
  return <StaleReviewSheet visible={open} onClose={handleClose} onCompleted={completed} />;
}

export default StaleReviewHost;
