import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';

interface Props {
  eyebrow: string;
  label: string;
  value: string;
  active?: boolean; // 기본값이 아닌 조건이 걸려 있음
  width?: number;
  children: (close: () => void) => ReactNode;
}

/** 필터 한 칸: 라벨 + 현재 값 버튼 + 누르면 열리는 선택 패널 */
export function FilterPopover({ eyebrow, label, value, active, width = 320, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector<HTMLElement>('input, button:not([disabled])');
    first?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="field" ref={root} data-open={open}>
      <span className="field-label" id={`${id}-label`}>
        <span className="field-eyebrow">{eyebrow}</span>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="field-trigger"
        data-active={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="field-value" id={`${id}-value`}>
          {value}
        </span>
        <Icon name="chevron" className="field-chevron" />
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          className="popover"
          role="dialog"
          aria-label={`${label} 선택`}
          style={{ ['--popover-w' as string]: `${width}px` }}
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}

/** 목록의 한 줄 (선택 표시는 16px 굵은 체크) */
export function OptionRow({
  selected,
  disabled,
  label,
  hint,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  label: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="option" role="radio" aria-checked={selected} disabled={disabled} onClick={onSelect}>
      <span className="option-check" aria-hidden="true">
        {selected && <Icon name="check" size={16} />}
      </span>
      <span className="option-label">{label}</span>
      {hint && <span className="option-hint">{hint}</span>}
    </button>
  );
}
