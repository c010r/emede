import { useState } from 'react';
import { answerQuestions, useRepair, type Answer, type Question } from '../repair';
import { useStore } from '../store';
import { useT } from '../i18n';

const empty = (): Answer => ({ choice: [], values: {} });
const answered = (a?: Answer) => !!a && (a.ignore || a.choice.length > 0 || Object.values(a.values).some((v) => v.trim()));

/** Preguntas de la reparación: se abre sola cuando hay algo que solo el usuario puede decidir. */
export function QuestionsModal({ notify }: { notify: (m: string, e?: boolean) => void }) {
  const t = useT();
  const questions = useRepair((s) => s.questions);
  const nodes = useStore((s) => s.nodes);
  const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
  const [busy, setBusy] = useState(false);

  const set = (q: Question, fn: (a: Answer) => Answer) =>
    setAnswers((m) => new Map(m).set(q.key, fn({ ...empty(), ...m.get(q.key) })));

  const close = () => useRepair.setState({ showQuestions: false });
  const ready = [...answers.values()].filter(answered).length;

  const submit = async () => {
    setBusy(true);
    try {
      await answerQuestions(new Map([...answers].filter(([, a]) => answered(a))));
      setAnswers(new Map());
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const nodeName = (id?: string) => {
    const d = nodes.find((n) => n.id === id)?.data.d;
    return d ? `${d.kind === 'command' ? '/' : ''}${d.name}` : '';
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal wide questions">
        <div className="modal-head">
          <h2>{questions.length === 1 ? t('q.titleOne') : t('q.titleMany', { n: questions.length })}</h2>
          <button className="btn ghost" onClick={close} disabled={busy}>✕</button>
        </div>
        <p className="muted small">{t('q.intro')}</p>

        {questions.map((q) => {
          const a = answers.get(q.key);
          return (
            <div key={q.key} className={`question ${answered(a) ? 'done' : ''}`}>
              <div className="question-title">
                {nodeName(q.nodeId) && <span className="question-node">{nodeName(q.nodeId)}</span>}
                <b>{q.title}</b>
              </div>
              {q.context && <div className="muted small">{q.context}</div>}
              {q.options?.map((o) => (
                <label key={o.id} className="check">
                  <input
                    type={q.multi ? 'checkbox' : 'radio'} name={q.key} disabled={a?.ignore}
                    checked={!!a?.choice.includes(o.id)}
                    onChange={(e) => set(q, (x) => ({
                      ...x,
                      choice: q.multi ? (e.target.checked ? [...x.choice, o.id] : x.choice.filter((c) => c !== o.id)) : [o.id],
                    }))}
                  />
                  {o.label}
                </label>
              ))}
              {q.inputs?.map((inp) => (
                <label key={inp.id} className="field">
                  <span className="small muted">{inp.label}</span>
                  {inp.multiline ? (
                    <textarea rows={2} disabled={a?.ignore} placeholder={inp.placeholder} value={a?.values[inp.id] ?? ''}
                      onChange={(e) => set(q, (x) => ({ ...x, values: { ...x.values, [inp.id]: e.target.value } }))} />
                  ) : (
                    <input disabled={a?.ignore} placeholder={inp.placeholder} value={a?.values[inp.id] ?? ''}
                      onChange={(e) => set(q, (x) => ({ ...x, values: { ...x.values, [inp.id]: e.target.value } }))} />
                  )}
                </label>
              ))}
              <label className="check small muted">
                <input type="checkbox" checked={!!a?.ignore} onChange={(e) => set(q, (x) => ({ ...x, ignore: e.target.checked }))} />
                {t('q.ignore')}
              </label>
            </div>
          );
        })}

        <div className="modal-foot">
          <button className="btn" onClick={close} disabled={busy}>{t('q.later')}</button>
          <button className="btn primary" onClick={submit} disabled={busy || !ready}>
            {busy ? t('q.applying') : t('q.apply', { n: ready })}
          </button>
        </div>
      </div>
    </div>
  );
}
