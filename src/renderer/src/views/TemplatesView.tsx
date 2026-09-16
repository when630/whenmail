import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Mail, Paperclip, Plus, Save, Trash2, X } from 'lucide-react'
import type { EmailTemplate, TemplateAttachment, TemplateInput } from '../../../shared/types'
import { TEMPLATE_VARIABLES } from '../../../shared/render'
import { useDialog } from '../components/dialogs'
import RichEditor, { type RichEditorHandle } from '../components/RichEditor'

const EMPTY: TemplateInput = { name: '', subject_tpl: '', body_tpl: '', attachments: [] }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function TemplatesView(): React.JSX.Element {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<TemplateInput>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const bodyRef = useRef<RichEditorHandle>(null)
  const { confirm, toast } = useDialog()

  /** dirty 검사 없이 선택 상태만 반영 — 저장 후 재선택 등 내부용 */
  const applySelection = (t: EmailTemplate | null | 'new'): void => {
    if (t === 'new') {
      setSelectedId('new')
      setForm(EMPTY)
    } else if (t) {
      setSelectedId(t.id)
      setForm({
        name: t.name,
        subject_tpl: t.subject_tpl,
        body_tpl: t.body_tpl,
        attachments: t.attachments ?? []
      })
    } else {
      setSelectedId(null)
      setForm(EMPTY)
    }
    setDirty(false)
  }

  const reload = async (keepId?: number): Promise<void> => {
    const list = await window.api.templates.list()
    setTemplates(list)
    if (keepId !== undefined) applySelection(list.find((t) => t.id === keepId) ?? null)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 사용자가 목록에서 이동할 때 — 저장 안 된 변경이 있으면 확인 */
  const selectTemplate = async (t: EmailTemplate | null | 'new'): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: '저장하지 않은 변경',
        message: '저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다.',
        confirmLabel: '이동'
      })
      if (!ok) return
    }
    applySelection(t)
  }

  const set = (key: 'name' | 'subject_tpl' | 'body_tpl', value: string): void => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const insertVariable = (name: string): void => {
    const token = `{{${name}}}`
    if (bodyRef.current) bodyRef.current.insertText(token)
    else set('body_tpl', form.body_tpl + token)
  }

  const addAttachments = async (): Promise<void> => {
    setPicking(true)
    try {
      const picked = await window.api.templates.pickAttachments()
      if (!picked || picked.length === 0) return
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...picked] }))
      setDirty(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setPicking(false)
    }
  }

  const removeAttachment = (a: TemplateAttachment): void => {
    setForm((f) => ({ ...f, attachments: f.attachments.filter((x) => x.path !== a.path) }))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (selectedId === 'new') {
        const created = await window.api.templates.create(form)
        await reload(created.id)
      } else if (typeof selectedId === 'number') {
        await window.api.templates.update(selectedId, form)
        await reload(selectedId)
      }
      setDirty(false)
      toast('저장되었습니다')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (t: EmailTemplate): Promise<void> => {
    const ok = await confirm({
      title: '템플릿 삭제',
      message: `'${t.name}' 템플릿을 삭제할까요?`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.templates.remove(t.id)
    setSelectedId(null)
    setForm(EMPTY)
    setDirty(false)
    await reload()
    toast('삭제되었습니다')
  }

  const totalSize = form.attachments.reduce((s, a) => s + a.size, 0)

  return (
    <div className="view view-split">
      <div className="split-list">
        <header className="view-header">
          <h1>템플릿</h1>
          <button className="btn" onClick={() => selectTemplate('new')}>
            <Plus size={15} />새 템플릿
          </button>
        </header>
        {templates === null ? null : templates.length === 0 ? (
          <div className="empty">
            <Mail size={32} strokeWidth={1.4} />
            <span className="empty-title">템플릿이 없습니다</span>
          </div>
        ) : (
          <ul className="side-list">
            {templates.map((t) => (
              <li
                key={t.id}
                className={selectedId === t.id ? 'active' : ''}
                onClick={() => selectTemplate(t)}
              >
                <strong>
                  {t.name}
                  {(t.attachments?.length ?? 0) > 0 && (
                    <span className="side-attach" title={`첨부 ${t.attachments?.length ?? 0}개`}>
                      <Paperclip size={12} />
                      {t.attachments?.length ?? 0}
                    </span>
                  )}
                </strong>
                <small>{t.subject_tpl || '(제목 없음)'}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="split-editor">
        {selectedId === null ? (
          <div className="empty">
            <Mail size={32} strokeWidth={1.4} />
            <span className="empty-title">템플릿을 선택하세요</span>
            <span>왼쪽 목록에서 선택하거나 새로 만들 수 있습니다.</span>
          </div>
        ) : (
          <>
            <label className="form-field">
              <span>템플릿 이름</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="form-field">
              <span>제목</span>
              <input
                value={form.subject_tpl}
                placeholder="예: [{{회사|whenmail}}] {{이름}}님, 안녕하세요"
                onChange={(e) => set('subject_tpl', e.target.value)}
              />
            </label>
            <div className="variable-bar">
              {Object.keys(TEMPLATE_VARIABLES).map((v) => (
                <button key={v} className="chip" onClick={() => insertVariable(v)}>
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <div className="form-field form-field-grow">
              <span>
                본문 — 변수는 {'{{이름}}'} 또는 기본값 포함 {'{{이름|고객}}'} 형식
              </span>
              <RichEditor
                ref={bodyRef}
                value={form.body_tpl}
                placeholder="{{이름|고객}}님, 안녕하세요."
                onChange={(html) => set('body_tpl', html)}
              />
            </div>

            <div className="form-field">
              <span className="field-head">
                <span>
                  첨부 파일
                  {form.attachments.length > 0 && (
                    <em className="muted">
                      {' '}
                      — {form.attachments.length}개 · {formatBytes(totalSize)}
                    </em>
                  )}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={addAttachments}
                  disabled={picking}
                >
                  <Paperclip size={14} />
                  파일 추가
                </button>
              </span>
              {form.attachments.length > 0 && (
                <ul className="attach-list">
                  {form.attachments.map((a) => (
                    <li key={a.path} className="attach-item">
                      <Paperclip size={13} />
                      <span className="attach-name" title={a.name}>
                        {a.name}
                      </span>
                      <span className="muted">{formatBytes(a.size)}</span>
                      <button
                        type="button"
                        className="btn ghost sm icon-only"
                        aria-label={`${a.name} 첨부 제거`}
                        onClick={() => removeAttachment(a)}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="hint-inline">
                이 템플릿으로 만드는 모든 초안에 함께 첨부됩니다. 파일은 앱 데이터 폴더에 복사되어
                보관됩니다.
              </span>
            </div>

            <div className="editor-actions">
              {typeof selectedId === 'number' && (
                <button
                  className="btn ghost danger"
                  onClick={() => {
                    const t = templates?.find((x) => x.id === selectedId)
                    if (t) remove(t)
                  }}
                >
                  <Trash2 size={15} />
                  삭제
                </button>
              )}
              <span className="spacer" />
              {dirty && (
                <span className="dirty-hint">
                  <CircleAlert size={14} />
                  저장되지 않음
                </span>
              )}
              <button className="btn primary" onClick={save} disabled={saving || !form.name.trim()}>
                <Save size={15} />
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
