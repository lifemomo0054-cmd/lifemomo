import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadDataset } from '../data/dataset';
import type { Dataset } from '../data/types';

type DataState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; ds: Dataset };

const DataContext = createContext<DataState>({ status: 'loading' });

const DATA_URL = `${import.meta.env.BASE_URL}data/population.json`;

// 요청은 한 번만 보내고 함께 쓴다. (개발 모드 StrictMode가 effect를 두 번 실행해도 요청이 취소·중복되지 않게)
let request: Promise<Dataset> | null = null;

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    request ??= loadDataset(DATA_URL);
    request
      .then((ds) => alive && setState({ status: 'ready', ds }))
      .catch((err: unknown) => {
        request = null; // 다음에 다시 시도할 수 있게
        if (alive) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
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
