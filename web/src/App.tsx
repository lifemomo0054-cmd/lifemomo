import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { BrandMark } from './components/ui/Icon';
import { NAV } from './nav';
import { ComingSoon } from './pages/ComingSoon';
import { Demographics } from './pages/Demographics';
import { Origins } from './pages/Origins';
import { Overview } from './pages/Overview';
import { Time } from './pages/Time';
import { DataProvider, useDataState } from './state/DataProvider';
import { FilterProvider } from './state/FilterProvider';

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
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="time" element={<Time />} />
            <Route path="demographics" element={<Demographics />} />
            <Route path="origins" element={<Origins />} />
            {NAV.filter((n) => !n.ready).map((n) => (
              <Route key={n.path} path={n.path.slice(1)} element={<ComingSoon item={n} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </FilterProvider>
  );
}
