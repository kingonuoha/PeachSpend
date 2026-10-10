import { useEffect, useRef } from 'react';
import { databaseService } from '../../services/DatabaseService';
import { resolveContinuityAccountState } from '../../data';
import { shouldAdoptContinuityAccount } from '../../services/ContinuityUiService';
import { logger } from '../../utils/logger';
import { useSettings } from './SettingsProvider';

// DEC-32 app-init continuity consumer. Renders nothing.
//
// A legacy v1 file has already been upgraded in place by DatabaseService.init
// (the version-gated migration runner), so this host only reads the Data & AI
// detection result once per launch and adopts an account that already holds
// records: it marks onboarding complete so the existing onboarding guard routes
// the migrated account into the app instead of showing setup to a user who
// already has data. A genuinely empty account (schema none, or a reinstall with no
// rows) is left untouched on the existing first-run path, and a current v2 install
// is a no-op. No new screen, route, or migration path is introduced.
export default function ContinuityGate() {
  const { settings, isLoading, updateSetting } = useSettings();
  const consumed = useRef(false);
  const onboardingComplete = settings.onboarding_complete === 'true';

  useEffect(() => {
    if (isLoading || consumed.current) return;
    consumed.current = true;
    void (async () => {
      try {
        const detection = await databaseService.detectContinuity();
        const account = resolveContinuityAccountState(detection);
        if (shouldAdoptContinuityAccount(account, onboardingComplete)) {
          await updateSetting('onboarding_complete', 'true');
        }
      } catch {
        // A detection failure must not block startup; the existing onboarding gate
        // still renders and the user can proceed or restore from Settings.
        logger.error('continuity_detection_failed');
      }
    })();
  }, [isLoading, onboardingComplete, updateSetting]);

  return null;
}
