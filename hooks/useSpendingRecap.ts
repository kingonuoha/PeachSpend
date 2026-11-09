import { useCallback, useEffect, useRef, useState } from 'react';
import { databaseService } from '../services/DatabaseService';
import { RecapDataService } from '../data/RecapDataService';
import type { SpendingRecapCadence, SpendingRecapRead } from '../data/RecapContracts';

export interface RecapCategoryMeta {
  title: string;
  iconName: string;
}

// Module singleton mirrors the other data repositories: the screen consumes the
// Data and AI service plus the public category boundary, never SQL.
const recapDataService = new RecapDataService(databaseService);

export function useSpendingRecap(cadence: SpendingRecapCadence) {
  const [read, setRead] = useState<SpendingRecapRead | null>(null);
  const [categoryMeta, setCategoryMeta] = useState<Record<string, RecapCategoryMeta>>({});
  const [refreshing, setRefreshing] = useState(false);
  // The cadence the last landed read belongs to. `loading` is derived from it, so
  // the mount read does not have to set state synchronously from inside its own
  // effect (which would render twice before the fetch even starts).
  const [loadedCadence, setLoadedCadence] = useState<SpendingRecapCadence | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    // getRecap resolves its own offline/failure read instead of throwing, so no
    // catch is needed here; a resolved state is always rendered honestly.
    const [nextRead, categories] = await Promise.all([
      recapDataService.getRecap(cadence),
      databaseService.getCategories(),
    ]);
    if (id !== requestId.current) return;
    const meta: Record<string, RecapCategoryMeta> = {};
    for (const category of categories) {
      meta[category.id] = { title: category.title, iconName: category.icon_name };
    }
    setRead(nextRead);
    setCategoryMeta(meta);
    setLoadedCadence(cadence);
    setRefreshing(false);
  }, [cadence]);

  useEffect(() => {
    void load();
  }, [load]);

  // A retry re-reads without hiding the recap already on screen, so it only moves
  // the refresh flag; `loading` stays settled because the cadence did not change.
  const retry = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  return { read, categoryMeta, loading: loadedCadence !== cadence, refreshing, retry };
}
