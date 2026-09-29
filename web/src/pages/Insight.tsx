import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { copyText } from '../clipboard';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { aiContext, findings, type FindingKind } from '../data/insights';
import { useDataset } from '../state/DataProvider';
import { useFilters } from '../state/FilterProvider';

const KINDS: FindingKind[] = ['규모', '시간', '인구 구조', '유입지역', '데이터 주의'];

export function Insight() {
  const ds = useDataset();
  const { summary: s } = useFilters();
  const list = useMemo(() => findings(ds, s), [ds, s]);
  const context = useMemo(() => aiContext(ds, s, list), [ds, s, list]);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLPreElement>(null);

  const copy = async () => {
    if (await copyText(context)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      return;
    }
    // 복사가 막힌 화면에서는 요약을 모두 선택해 두어 직접 복사할 수 있게 한다
    const el = body.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  };

  return (
    <div className="page-insight">
      <PageHeader
        no="08"
        en="AI Insight"
        title="AI Insight"
        lead="현재 조건에서 눈에 띄는 점을 문장으로 정리합니다. 아직 AI를 연결하지 않았으므로, 아래 요약은 정해진 계산 규칙으로 만든 것이고 언어 모델이 쓴 글이 아닙니다."
      />

      <div className="grid">
        <section className="panel span-8 md-12" aria-labelledby="findings-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Fig. 01 · Rule-based</p>
              <h2 className="panel-title" id="findings-title">
                자동 요약 {list.length > 0 && <span className="muted">· {list.length}개</span>}
              </h2>
              <p className="panel-sub">필터를 바꾸면 요약도 다시 계산됩니다. 숫자는 모두 다른 화면과 같은 집계에서 나옵니다.</p>
            </div>
            <p className="status-pill" data-kind="rule">
              <span aria-hidden="true" />
              규칙 기반 · AI 아님
            </p>
          </header>
          {list.length === 0 ? (
            <p className="panel-empty">선택한 조건에 맞는 데이터가 없어 요약할 내용이 없습니다.</p>
          ) : (
            KINDS.filter((kind) => list.some((f) => f.kind === kind)).map((kind) => (
              <div className="finding-group" key={kind}>
                <p className="stacked-title">{kind}</p>
                <ul className="findings">
                  {list
                    .filter((f) => f.kind === kind)
                    .map((f) => (
                      <li key={f.id} className="finding" data-caution={f.caution}>
                        <div className="finding-main">
                          <p className="finding-title">
                            {f.caution && <Icon name="info" className="finding-icon" />}
                            {f.title}
                            {f.caution && <span className="tag">주의</span>}
                          </p>
                          <p className="finding-text">{f.text}</p>
                          {f.link && (
                            <Link className="finding-link" to={f.link.path}>
                              {f.link.label}에서 보기 →
                            </Link>
                          )}
                        </div>
                        <div className="finding-metric">
                          <span>{f.metric.label}</span>
                          <strong>{f.metric.value}</strong>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section className="panel span-4 md-12 ask" aria-labelledby="ask-title">
          <header className="panel-head">
            <div className="panel-heading">
              <p className="panel-fig">Fig. 02 · Ask</p>
              <h2 className="panel-title" id="ask-title">
                AI에게 묻기
              </h2>
              <p className="panel-sub">AI 기능은 아직 연결하지 않았습니다. 연결하면 아래 요약을 질문과 함께 보내 답을 받게 됩니다.</p>
            </div>
          </header>
          <p className="status-pill" data-kind="off">
            <span aria-hidden="true" />
            AI 연결 안 됨
          </p>
          <label className="ask-box">
            <span className="sr-only">질문</span>
            <textarea disabled rows={3} placeholder="예: 주말에 특히 많이 오는 거주지는 어디인가요? (AI 연결 후 사용 가능)" />
          </label>
          <button type="button" className="button button-primary" disabled>
            질문 보내기
          </button>

          <div className="context">
            <div className="context-head">
              <p className="stacked-title">AI에 보낼 요약 (미리보기)</p>
              <button type="button" className="button button-ghost" onClick={copy}>
                {copied ? '복사했습니다' : '복사'}
              </button>
            </div>
            <pre ref={body} className="context-body" tabIndex={0} aria-label="AI에 보낼 요약">
              {context}
            </pre>
            <p className="panel-foot">원본 행은 보내지 않고, 현재 조건과 위 요약만 보낼 예정입니다. 요약 첫 줄에 합성데이터임을 밝힙니다.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
