import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDown,
  CircleAlert,
  ListOrdered,
  Loader2,
  Plus,
  Save,
  Trash2,
  Users
} from 'lucide-react'
import type { EmailTemplate, Sequence, SequenceInput } from '../../../shared/types'
import { useDialog } from '../components/dialogs'

type StepDraft = { template_id: number | null; delay_days: number; label: string }

const EMPTY: SequenceInput = {
  name: '',
  memo: '',
  steps: [{ template_id: null, delay_days: 0, label: '' }]
}

function toInput(s: Sequence): SequenceInput {
  return {
    name: s.name,
    memo: s.memo,
    steps: s.steps.map((st) => ({
      template_id: st.template_id,
      delay_days: st.delay_days,
      label: st.label
    }))
  }
}

/**
 * 템플릿 시퀀스 — 템플릿을 순서로 묶는다. 자동 전송은 하지 않는다.
 * 사람에게 시작하면 1단계가 바로 할 일로 뜨고, 초안을 만들면 다음 단계가 예약된다.
 */
export default function SequencesView(): React.JSX.Element {
  const [list, setList] = useState<Sequence[] | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<SequenceInput>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const { confirm, toast } = useDialog()

  const reload = useCallback(async (keepId?: number) => {
    const [seqs, tpls] = await Promise.all([
      window.api.sequences.list(),
      window.api.templates.list()
    ])
    setList(seqs)
    setTemplates(tpls)
    if (keepId !== undefined) {
      const found = seqs.find((s) => s.id === keepId)
      if (found) {
        setSelectedId(found.id)
        setForm(toInput(found))
        setDirty(false)
      }
    }
  }, [])

  useEffect(() => {
    Promise.all([window.api.sequences.list(), window.api.templates.list()]).then(([seqs, tpls]) => {
      setList(seqs)
      setTemplates(tpls)
    })
  }, [])

  const select = async (s: Sequence | 'new' | null): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: '저장하지 않은 변경',
        message: '저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다.',
        confirmLabel: '이동'
      })
      if (!ok) return
    }
    if (s === 'new') {
      setSelectedId('new')
      setForm(EMPTY)
    } else if (s) {
      setSelectedId(s.id)
      setForm(toInput(s))
    } else {
      setSelectedId(null)
      setForm(EMPTY)
    }
    setDirty(false)
  }

  const setStep = (i: number, patch: Partial<StepDraft>): void => {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((st, idx) => (idx === i ? { ...st, ...patch } : st))
    }))
    setDirty(true)
  }

  const addStep = (): void => {
    setForm((f) => ({
      ...f,
      steps: [...f.steps, { template_id: null, delay_days: 7, label: '' }]
    }))
    setDirty(true)
  }

  const removeStep = (i: number): void => {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim() || form.steps.length === 0) return
    setSaving(true)
    try {
      const saved =
        selectedId === 'new'
          ? await window.api.sequences.create(form)
          : await window.api.sequences.update(selectedId as number, form)
      await reload(saved.id)
      toast('저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: Sequence): Promise<void> => {
    const ok = await confirm({
      title: '시퀀스 삭제',
      message: `'${s.name}'을(를) 삭제할까요?\n진행 중인 ${s.running_count}명의 남은 단계도 함께 사라집니다.`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.sequences.remove(s.id)
    setSelectedId(null)
    setForm(EMPTY)
    await reload()
    toast('삭제되었습니다')
  }

  const canSave = form.name.trim().length > 0 && form.steps.length > 0

  return (
    <>
      <p className="muted seq-intro">
        템플릿을 순서로 묶어 둡니다. 사람에게 시작하면 1단계가 할 일로 뜨고, 초안을 만들면 다음
        단계가 지정한 일수 뒤로 예약됩니다. <strong>자동으로 보내지는 않습니다.</strong>
      </p>

      {list === null ? null : (
        <div className="view-split">
          <div className="split-list">
            <ul className="side-list">
              {list.map((s) => (
                <li
                  key={s.id}
                  className={s.id === selectedId ? 'active' : ''}
                  onClick={() => select(s)}
                >
                  <strong>{s.name}</strong>
                  <small>
                    {s.steps.length}단계
                    {s.running_count > 0 ? ` · 진행 중 ${s.running_count}명` : ''}
                  </small>
                </li>
              ))}
              {list.length === 0 && <li className="muted">아직 시퀀스가 없습니다</li>}
            </ul>
            <button className="btn seq-new" onClick={() => select('new')}>
              <Plus size={15} />
              시퀀스 추가
            </button>
          </div>

          <div className="split-editor">
            {selectedId === null ? (
              <div className="empty">
                <ListOrdered size={32} strokeWidth={1.4} />
                <span className="empty-title">시퀀스를 선택하세요</span>
                <span>예: 인사 → 1주 후 자료 → 2주 후 미팅 제안</span>
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <label className="form-field">
                    <span>
                      시퀀스 이름<em className="req">*</em>
                    </span>
                    <input
                      value={form.name}
                      placeholder="예: 신규 고객 인사 3단계"
                      onChange={(e) => {
                        setForm((f) => ({ ...f, name: e.target.value }))
                        setDirty(true)
                      }}
                    />
                  </label>
                  <label className="form-field">
                    <span>메모</span>
                    <input
                      value={form.memo}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, memo: e.target.value }))
                        setDirty(true)
                      }}
                    />
                  </label>
                </div>

                <h3 className="detail-title">단계</h3>
                <ol className="step-list">
                  {form.steps.map((st, i) => (
                    <li key={i} className="step-item">
                      <span className="step-no">{i + 1}</span>
                      <div className="step-fields">
                        <label className="form-field">
                          <span>템플릿</span>
                          <select
                            value={st.template_id ?? ''}
                            onChange={(e) =>
                              setStep(i, {
                                template_id: e.target.value ? Number(e.target.value) : null
                              })
                            }
                          >
                            <option value="">(선택 안 함 — 초안 때 고르기)</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>{i === 0 ? '시작' : '앞 단계 뒤'}</span>
                          {i === 0 ? (
                            <div className="step-immediate muted">바로 할 일로 뜸</div>
                          ) : (
                            <div className="days-row">
                              <input
                                type="number"
                                min={0}
                                max={365}
                                value={st.delay_days}
                                onChange={(e) => setStep(i, { delay_days: Number(e.target.value) })}
                              />
                              <span className="muted">일 뒤</span>
                            </div>
                          )}
                        </label>
                        <label className="form-field form-field-wide">
                          <span>설명</span>
                          <input
                            value={st.label}
                            placeholder="예: 자료 보내기"
                            onChange={(e) => setStep(i, { label: e.target.value })}
                          />
                        </label>
                      </div>
                      <button
                        className="btn ghost sm icon-only danger"
                        aria-label={`${i + 1}단계 삭제`}
                        disabled={form.steps.length === 1}
                        onClick={() => removeStep(i)}
                      >
                        <Trash2 size={14} />
                      </button>
                      {i < form.steps.length - 1 && (
                        <ArrowDown size={14} className="muted step-arrow" aria-hidden="true" />
                      )}
                    </li>
                  ))}
                </ol>
                <button className="btn ghost sm step-add" onClick={addStep}>
                  <Plus size={14} />
                  단계 추가
                </button>

                <div className="editor-actions">
                  {selectedId !== 'new' && (
                    <button
                      className="btn danger"
                      onClick={() => {
                        const s = list.find((x) => x.id === selectedId)
                        if (s) remove(s)
                      }}
                    >
                      <Trash2 size={15} />
                      삭제
                    </button>
                  )}
                  <span className="spacer" />
                  {selectedId !== 'new' && (
                    <span className="muted seq-running">
                      <Users size={13} />
                      진행 중 {list.find((x) => x.id === selectedId)?.running_count ?? 0}명
                    </span>
                  )}
                  {dirty && (
                    <span className="dirty-hint">
                      <CircleAlert size={14} />
                      저장되지 않음
                    </span>
                  )}
                  <button
                    className="btn primary"
                    onClick={save}
                    disabled={saving || !canSave || !dirty}
                  >
                    {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                    저장
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
