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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const id = ++requestId.current;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
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
    setLoading(false);
    setRefreshing(false);
  }, [cadence]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const retry = useCallback(() => {
    void load('refresh');
  }, [load]);

  return { read, categoryMeta, loading, refreshing, retry };
}
