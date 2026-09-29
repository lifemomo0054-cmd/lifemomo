import { useLocation } from 'react-router-dom';
import { navItemFor } from '../../nav';
import { useTheme } from '../../state/theme';
import { Icon } from '../ui/Icon';

export function TopBar({ navOpen, onMenu }: { navOpen: boolean; onMenu: () => void }) {
  const item = navItemFor(useLocation().pathname);
  const [theme, toggleTheme] = useTheme();

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button topbar-menu"
        onClick={onMenu}
        aria-label="메뉴 열기"
        aria-expanded={navOpen}
        aria-controls="sidebar"
      >
        <Icon name="menu" />
      </button>
      <p className="crumb">
        <span className="crumb-root">LPL</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <span className="crumb-no">{item.no}</span>
        <span className="crumb-page">{item.label}</span>
      </p>
      <div className="topbar-right">
        <span className="synthetic-badge" title="이 서비스의 모든 수치는 합성데이터에서 계산했습니다. 공식통계가 아닙니다.">
          Synthetic data<span className="synthetic-badge-ko"> · 합성데이터</span>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
          title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}
