/** 라벨이 자리에 들어가는지 미리 가늠하기 위한 대략의 글자 폭 (px) */
export function textWidth(text: string, fontSize = 12): number {
  let w = 0;
  for (const ch of text) {
    if (/[가-힣]/.test(ch)) w += 1.0; // 한글
    else if (/[0-9]/.test(ch)) w += 0.6;
    else if (/[,.·:]/.test(ch)) w += 0.3;
    else w += 0.58;
  }
  return w * fontSize;
}
