import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  Globe,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  SendHorizontal,
  Smartphone,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import type { Activity, Person } from '../../../shared/types'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'
import { KIND_LABEL, activityText } from '../activityLabels'

interface Props {
  person: Person
  onEdit: () => void
  onCompose: () => void
  /** 활동(메모)이 바뀌어 목록의 마지막 연락일 등을 다시 읽어야 할 때 */
  onChanged?: () => void
  onClose: () => void
}

export default function PersonDetail({
  person,
  onEdit,
  onCompose,
  onChanged,
  onClose
}: Props): React.JSX.Element {
  const [activities, setActivities] = useState<Activity[] | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const { confirm, toast } = useDialog()

  const reload = useCallback(async () => {
    setActivities(await window.api.activities.list(person.id))
  }, [person.id])

  useEffect(() => {
    window.api.activities.list(person.id).then(setActivities)
  }, [person.id])

  useEffect(() => {
    for (const c of person.cards) {
      window.api.files
        .imageDataUrl(c.image_path)
        .then((url) => url && setThumbs((t) => ({ ...t, [c.id]: url })))
        .catch(() => undefined)
    }
  }, [person])

  const addNote = async (): Promise<void> => {
    if (!note.trim()) return
    setSaving(true)
    try {
      await window.api.activities.addNote(person.id, note)
      setNote('')
      await reload()
      onChanged?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeActivity = async (a: Activity): Promise<void> => {
    const ok = await confirm({
      title: '활동 삭제',
      message: `이 ${KIND_LABEL[a.kind]} 기록을 삭제할까요?`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.activities.remove(a.id)
    await reload()
    onChanged?.()
  }

  const info: { Icon: typeof Phone; label: string; value: string }[] = [
    { Icon: Phone, label: '전화', value: person.phone },
    { Icon: Smartphone, label: '휴대폰', value: person.mobile },
    { Icon: MapPin, label: '주소', value: person.address },
    { Icon: Globe, label: '웹사이트', value: person.website }
  ].filter((x) => x.value)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-head">
            <Avatar name={person.name} />
            <div>
              <h2>{person.name}</h2>
              <div className="muted detail-sub">
                {[person.company, person.department, person.title].filter(Boolean).join(' · ') ||
                  '소속 정보 없음'}
              </div>
            </div>
          </div>
          <div className="modal-header-actions">
            <button
              className="btn primary sm"
              onClick={onCompose}
              disabled={person.emails.length === 0}
            >
              <SendHorizontal size={14} />
              메일 쓰기
            </button>
            <button className="btn sm" onClick={onEdit}>
              <Pencil size={14} />
              편집
            </button>
            <button className="btn ghost sm icon-only" aria-label="닫기" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="detail-grid">
          <section className="detail-col">
            <h3 className="detail-title">연락 수단</h3>
            {person.emails.length === 0 ? (
              <p className="muted">이메일 주소가 없습니다</p>
            ) : (
              <ul className="detail-list">
                {person.emails.map((e) => (
                  <li key={e.id}>
                    <span className="detail-value">{e.address}</span>
                    {e.is_primary && <span className="badge neutral">대표</span>}
                    {e.label && <span className="muted">{e.label}</span>}
                  </li>
                ))}
              </ul>
            )}
            {info.length > 0 && (
              <ul className="detail-list">
                {info.map((x) => (
                  <li key={x.label}>
                    <x.Icon size={14} className="muted" aria-label={x.label} />
                    <span className="detail-value">{x.value}</span>
                  </li>
                ))}
              </ul>
            )}
            {person.company && (
              <p className="detail-org muted">
                <Building2 size={14} /> {person.company}
              </p>
            )}
            {person.tags.length > 0 && (
              <div className="tag-list">
                {person.tags.map((t) => (
                  <span key={t} className="badge neutral">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {person.memo && <p className="detail-memo">{person.memo}</p>}

            {person.cards.length > 0 && (
              <>
                <h3 className="detail-title">명함 {person.cards.length}장</h3>
                <div className="card-gallery">
                  {person.cards.map((c) => (
                    <figure key={c.id} className="card-thumb" title={c.received_at}>
                      {thumbs[c.id] ? (
                        <img src={thumbs[c.id]} alt="명함 이미지" />
                      ) : (
                        <span className="card-thumb-placeholder">명함</span>
                      )}
                    </figure>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="detail-col">
            <h3 className="detail-title">
              타임라인
              {person.last_contact_at && (
                <span className="muted hint-inline"> 마지막 초안 {person.last_contact_at}</span>
              )}
            </h3>
            <div className="note-input">
              <StickyNote size={15} className="muted" />
              <input
                value={note}
                placeholder="메모 남기기 — 예: 9/20 미팅, 견적 요청"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) addNote()
                }}
              />
              <button className="btn sm" onClick={addNote} disabled={saving || !note.trim()}>
                {saving ? <Loader2 size={14} className="spin" /> : '추가'}
              </button>
            </div>
            {activities === null ? null : activities.length === 0 ? (
              <p className="muted">
                아직 기록이 없습니다. 초안을 만들거나 메모를 남기면 여기에 쌓입니다.
              </p>
            ) : (
              <ul className="timeline">
                {activities.map((a) => (
                  <li key={a.id} className={`timeline-item kind-${a.kind}`}>
                    <span className="timeline-dot" />
                    <div className="timeline-body">
                      <div className="timeline-meta">
                        <span className={`badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                        <span className="muted nowrap">{a.occurred_at}</span>
                        {a.template_name && <span className="muted">· {a.template_name}</span>}
                        {a.adapter && (
                          <span className={`badge mode-${a.adapter}`}>{a.adapter}</span>
                        )}
                        <span className="spacer" />
                        {(a.kind === 'note' || a.kind === 'merge') && (
                          <button
                            className="btn ghost sm icon-only danger"
                            aria-label="기록 삭제"
                            onClick={() => removeActivity(a)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                      <div className="timeline-text">{activityText(a)}</div>
                      {a.kind === 'draft' && a.person_email && (
                        <div className="muted timeline-sub">→ {a.person_email}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
