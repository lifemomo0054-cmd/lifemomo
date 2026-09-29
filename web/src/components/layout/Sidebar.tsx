import { NavLink } from 'react-router-dom';
import { dotDay } from '../../data/dates';
import { NAV, NAV_GROUPS } from '../../nav';
import { useDataset } from '../../state/DataProvider';
import { BrandMark, Icon } from '../ui/Icon';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useDataset();
  return (
    <>
      <div className="scrim" hidden={!open} onClick={onClose} />
      <aside id="sidebar" className="sidebar" data-open={open} aria-label="주 메뉴">
        <div className="sidebar-brand">
          <NavLink to="/" className="brand" onClick={onClose} aria-label="LOCAL POPULATION LAB 홈">
            <BrandMark />
            <span className="brand-text">
              <span className="brand-name">
                LOCAL POPULATION
                <br />
                LAB
              </span>
              <span className="brand-sub">지역 생활인구 분석</span>
            </span>
          </NavLink>
          <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="메뉴 닫기">
            <Icon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.id}>
              <p className="nav-group-label">{group.label}</p>
              <ul>
                {NAV.filter((n) => n.group === group.id).map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end
                      className="nav-item"
                      onClick={onClose}
                      title={item.label}
                      aria-label={`${item.no} ${item.label}${item.ready ? '' : ' (준비 중)'}`}
                    >
                      <span className="nav-no">{item.no}</span>
                      <span className="nav-label">{item.label}</span>
                      {(item.tag || !item.ready) && <span className="nav-tag">{item.tag ?? 'soon'}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="eyebrow">Dataset</p>
          <p className="dataset-name">{ds.stayRegion.name}</p>
          <p className="dataset-desc">{ds.measure}</p>
          <p className="dataset-range">
            {dotDay(ds.calendar[0])} – {dotDay(ds.calendar[ds.calendar.length - 1]).slice(5)}
          </p>
          <p className="synthetic-note">
            <span className="synthetic-dot" aria-hidden="true" />
            합성데이터 · 공식통계 아님
          </p>
        </div>
      </aside>
    </>
  );
}
