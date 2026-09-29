/**
 * 글자를 클립보드에 넣는다. 반드시 클릭 처리 안에서 불러야 한다.
 * Clipboard API가 막힌 곳(일부 앱 화면·내장 프레임)에서는 예전 방식(execCommand)으로 한 번 더 시도한다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return text.length <= MANUAL_COPY_LIMIT && legacyCopy(text);
  }
}

/** 예전 방식 복사나 직접 복사 창에 담을 수 있는 글자 수. 이보다 길면 글 상자를 그리는 데만 몇 초씩 걸린다. */
export const MANUAL_COPY_LIMIT = 600_000;

function legacyCopy(text: string): boolean {
  const focused = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  focused?.focus();
  return ok;
}
