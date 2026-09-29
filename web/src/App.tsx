import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { BrandMark } from './components/ui/Icon';
import { NAV } from './nav';
import { ComingSoon } from './pages/ComingSoon';
import { Demographics } from './pages/Demographics';
import { Explorer } from './pages/Explorer';
import { Insight } from './pages/Insight';
import { MapPage } from './pages/MapPage';
import { Origins } from './pages/Origins';
import { Overview } from './pages/Overview';
import { Time } from './pages/Time';
import { DataProvider, useDataState } from './state/DataProvider';
import { FilterProvider } from './state/FilterProvider';

// 웹페이지(Artifact)로 올린 판은 주소의 `#/time` 같은 경로가 페이지까지 오지 않아 화면 이동을 앱 안에서만 한다.
const Router = import.meta.env.VITE_ARTIFACT === '1' ? MemoryRouter : HashRouter;

export function App() {
  return (
    <DataProvider>
      <Gate />
    </DataProvider>
  );
}

function Gate() {
  const state = useDataState();
  if (state.status !== 'ready') {
    return (
      <div className="boot" role={state.status === 'error' ? 'alert' : 'status'}>
        <BrandMark size={36} />
        <p className="boot-name">LOCAL POPULATION LAB</p>
        <p className="boot-msg">{state.status === 'error' ? state.message : '데이터를 불러오는 중…'}</p>
      </div>
    );
  }
  return (
    <FilterProvider>
      <Router>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="time" element={<Time />} />
            <Route path="demographics" element={<Demographics />} />
            <Route path="origins" element={<Origins />} />
            <Route path="map" element={<MapPage />} />
            <Route path="explore" element={<Explorer />} />
            <Route path="insight" element={<Insight />} />
            {NAV.filter((n) => !n.ready).map((n) => (
              <Route key={n.path} path={n.path.slice(1)} element={<ComingSoon item={n} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </FilterProvider>
  );
}
