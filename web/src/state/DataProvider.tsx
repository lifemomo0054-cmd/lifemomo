import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadDataset } from '../data/dataset';
import type { Dataset } from '../data/types';

type DataState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; ds: Dataset };

const DataContext = createContext<DataState>({ status: 'loading' });

const DATA_URL = `${import.meta.env.BASE_URL}data/population.json`;

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>({ status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    loadDataset(DATA_URL, ctrl.signal)
      .then((ds) => setState({ status: 'ready', ds }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, []);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useDataState(): DataState {
  return useContext(DataContext);
}

/** 데이터가 준비된 뒤에만 그려지는 화면에서 쓴다. */
export function useDataset(): Dataset {
  const state = useContext(DataContext);
  if (state.status !== 'ready') throw new Error('데이터가 아직 준비되지 않았습니다.');
  return state.ds;
}
