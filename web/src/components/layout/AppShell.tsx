import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useFilters } from '../../state/FilterProvider';
import { FilterBar } from '../filters/FilterBar';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** 모든 화면 맨 위에 항상 보이는 안내 문구 */
export const SYNTHETIC_NOTICE = '본 서비스의 현재 데이터는 합성데이터를 기반으로 합니다.';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const { stale } = useFilters();

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="shell-main">
        <p className="notice-strip" role="note">
          <span className="notice-tag">Notice</span>
          {SYNTHETIC_NOTICE}
        </p>
        <div className="shell-head">
          <TopBar navOpen={navOpen} onMenu={() => setNavOpen(true)} />
          <FilterBar />
        </div>
        <main id="main" className="page" data-stale={stale} aria-busy={stale}>
          <Outlet />
        </main>
        <footer className="shell-foot">
          <p>
            LOCAL POPULATION LAB · 모든 수치는 <strong>합성데이터</strong>에서 계산했으며 공식통계가 아닙니다. 정책 판단·보도·대외
            자료의 근거로 쓰지 마세요.
          </p>
        </footer>
      </div>
    </div>
  );
}
