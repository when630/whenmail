import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CalendarPlus,
  CheckCheck,
  Clock,
  ExternalLink,
  Globe,
  ListOrdered,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Play,
  RefreshCw,
  SendHorizontal,
  Smartphone,
  Square,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import type {
  Activity,
  FollowUp,
  MailEntry,
  Person,
  PersonSequence,
  Sequence,
  SyncState
} from '../../../shared/types'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'
import { KIND_LABEL, activityText } from '../activityLabels'

interface Props {
  person: Person
  onEdit: () => void
  onCompose: () => void
  /** 후속을 처리하는 초안 만들기 */
  onComposeFollowUp?: (templateId: number | null, followUpId: number) => void
  /** 활동·메일이 바뀌어 목록의 마지막 연락일 등을 다시 읽어야 할 때 */
  onChanged?: () => void
  onClose: () => void
}

/** 활동과 메일을 한 줄기로 합친 타임라인 항목 */
type TimelineItem =
  | { at: string; type: 'activity'; activity: Activity }
  | { at: string; type: 'mail'; mail: MailEntry }

/** 오늘로부터 n일 뒤 'YYYY-MM-DD' */
function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86400_000)
  const pad = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function PersonDetail({
  person,
  onEdit,
  onCompose,
  onComposeFollowUp,
  onChanged,
  onClose
}: Props): React.JSX.Element {
  const [activities, setActivities] = useState<Activity[] | null>(null)
  const [mails, setMails] = useState<MailEntry[] | null>(null)
  const [note, setNote] = useState('')
  const [followUps, setFollowUps] = useState<FollowUp[] | null>(null)
  const [running, setRunning] = useState<PersonSequence[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [dueDate, setDueDate] = useState(() => inDays(7))
  const [dueNote, setDueNote] = useState('')
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const { confirm, toast } = useDialog()

  const reload = useCallback(async () => {
    const [acts, mail, fus, seqs] = await Promise.all([
      window.api.activities.list(person.id),
      window.api.mail.list(person.id),
      window.api.followUps.list(person.id),
      window.api.sequences.running(person.id)
    ])
    setActivities(acts)
    setMails(mail)
    setFollowUps(fus)
    setRunning(seqs)
  }, [person.id])

  useEffect(() => {
    Promise.all([
      window.api.activities.list(person.id),
      window.api.mail.list(person.id),
      window.api.followUps.list(person.id),
      window.api.sequences.running(person.id),
      window.api.sequences.list()
    ]).then(([acts, mail, fus, seqs, allSeqs]) => {
      setActivities(acts)
      setMails(mail)
      setFollowUps(fus)
      setRunning(seqs)
      setSequences(allSeqs)
    })
  }, [person.id])

  useEffect(() => {
    for (const c of person.cards) {
      window.api.files
        .imageDataUrl(c.image_path)
        .then((url) => url && setThumbs((t) => ({ ...t, [c.id]: url })))
        .catch(() => undefined)
    }
  }, [person])

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...(activities ?? []).map((a) => ({
        at: a.occurred_at,
        type: 'activity' as const,
        activity: a
      })),
      ...(mails ?? []).map((m) => ({ at: m.occurredAt, type: 'mail' as const, mail: m }))
    ]
    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }, [activities, mails])

  /** 후속·시퀀스 조작 공통 — 끝나면 상세와 목록을 다시 읽는다 */
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await reload()
      onChanged?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

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

  /** 이 사람의 주소만 다시 조회한다 */
  const syncPerson = async (): Promise<void> => {
    setSyncing(true)
    try {
      const result: SyncState = await window.api.sync.run(person.id)
      await reload()
      onChanged?.()
      if (result.phase === 'error') toast(result.message ?? '동기화 실패', 'error')
      else if (result.fetched > 0) toast(`새 메일 ${result.fetched}건을 확인했습니다`)
      else toast(result.message ?? '새로 온 메일이 없습니다', 'info')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSyncing(false)
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

            <h3 className="detail-title">연락 상태</h3>
            <ul className="detail-list contact-state">
              <li>
                <ArrowUpRight size={14} className="muted" aria-label="보냄" />
                <span className="muted">마지막 보냄</span>
                <span className="detail-value">{person.last_outbound_at?.slice(0, 16) ?? '—'}</span>
              </li>
              <li>
                <ArrowDownLeft size={14} className="muted" aria-label="받음" />
                <span className="muted">마지막 받음</span>
                <span className="detail-value">{person.last_inbound_at?.slice(0, 16) ?? '—'}</span>
              </li>
            </ul>
            {person.awaiting_reply && (
              <p className="settings-warn awaiting-line">
                <Clock size={14} />
                보낸 뒤 회신이 없습니다. 알림함에도 쌓입니다
              </p>
            )}

            <h3 className="detail-title">
              후속
              <span className="spacer" />
              <button
                className="btn ghost sm"
                onClick={() => setAddingFollowUp((v) => !v)}
                aria-expanded={addingFollowUp}
              >
                <CalendarPlus size={13} />
                리마인더 추가
              </button>
            </h3>

            {addingFollowUp && (
              <div className="followup-add">
                <div className="days-row">
                  <input
                    type="date"
                    value={dueDate}
                    aria-label="기한"
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                  {[3, 7, 14].map((d) => (
                    <button key={d} className="btn ghost sm" onClick={() => setDueDate(inDays(d))}>
                      +{d}일
                    </button>
                  ))}
                </div>
                <input
                  value={dueNote}
                  placeholder="무엇을 챙길지 — 예: 견적 회신 확인"
                  onChange={(e) => setDueNote(e.target.value)}
                />
                <button
                  className="btn primary sm"
                  disabled={busy || !dueDate}
                  onClick={() =>
                    act(async () => {
                      await window.api.followUps.create({
                        personId: person.id,
                        dueAt: dueDate,
                        note: dueNote
                      })
                      setDueNote('')
                      setAddingFollowUp(false)
                    })
                  }
                >
                  {busy ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />}
                  추가
                </button>
              </div>
            )}

            {followUps === null ? null : followUps.length === 0 ? (
              <p className="muted">걸어 둔 후속이 없습니다</p>
            ) : (
              <ul className="followup-list">
                {followUps.map((f) => (
                  <li key={f.id} className={f.overdue ? 'overdue' : ''}>
                    <CalendarClock size={13} className="muted" />
                    <span className="followup-main">
                      <span className="followup-due">{f.due_at.slice(0, 16)}</span>
                      {f.note && <span className="muted">{f.note}</span>}
                      {f.sequence_name && (
                        <span className="badge neutral">
                          {f.sequence_name}
                          {f.step_no ? ` ${f.step_no}단계` : ''}
                        </span>
                      )}
                    </span>
                    {onComposeFollowUp && (
                      <button
                        className="btn ghost sm icon-only"
                        aria-label="이 후속으로 초안 만들기"
                        title="초안 만들기"
                        onClick={() => onComposeFollowUp(f.template_id, f.id)}
                      >
                        <SendHorizontal size={13} />
                      </button>
                    )}
                    <button
                      className="btn ghost sm icon-only"
                      aria-label="후속 완료"
                      title="완료"
                      disabled={busy}
                      onClick={() => act(() => window.api.followUps.complete(f.id))}
                    >
                      <CheckCheck size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {running.length > 0 && (
              <ul className="followup-list">
                {running
                  .filter((ps) => ps.status === 'running')
                  .map((ps) => (
                    <li key={ps.id}>
                      <ListOrdered size={13} className="muted" />
                      <span className="followup-main">
                        <span>{ps.sequence_name}</span>
                        <span className="muted">
                          {ps.done_steps}/{ps.total_steps}단계
                        </span>
                      </span>
                      <button
                        className="btn ghost sm icon-only danger"
                        aria-label="시퀀스 중단"
                        title="중단"
                        disabled={busy}
                        onClick={() => act(() => window.api.sequences.stop(ps.id))}
                      >
                        <Square size={13} />
                      </button>
                    </li>
                  ))}
              </ul>
            )}

            {sequences.length > 0 && (
              <div className="seq-start">
                <Play size={13} className="muted" />
                <select
                  aria-label="시퀀스 시작"
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const id = Number(e.target.value)
                    if (id) act(() => window.api.sequences.start(person.id, id))
                  }}
                >
                  <option value="">시퀀스 시작…</option>
                  {sequences.map((sq) => (
                    <option key={sq.id} value={sq.id}>
                      {sq.name} ({sq.steps.length}단계)
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              <span className="spacer" />
              <button
                className="btn ghost sm"
                onClick={syncPerson}
                disabled={syncing}
                title="이 사람의 주소로 오간 메일을 다시 확인합니다"
              >
                {syncing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                메일 확인
              </button>
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
            {activities === null || mails === null ? null : timeline.length === 0 ? (
              <p className="muted">
                아직 기록이 없습니다. 초안을 만들거나 메모를 남기면 여기에 쌓입니다.
              </p>
            ) : (
              <ul className="timeline">
                {timeline.map((item) =>
                  item.type === 'activity' ? (
                    <li
                      key={`a-${item.activity.id}`}
                      className={`timeline-item kind-${item.activity.kind}`}
                    >
                      <span className="timeline-dot" />
                      <div className="timeline-body">
                        <div className="timeline-meta">
                          <span className={`badge kind-${item.activity.kind}`}>
                            {KIND_LABEL[item.activity.kind]}
                          </span>
                          <span className="muted nowrap">{item.activity.occurred_at}</span>
                          {item.activity.template_name && (
                            <span className="muted">· {item.activity.template_name}</span>
                          )}
                          {item.activity.adapter && (
                            <span className={`badge mode-${item.activity.adapter}`}>
                              {item.activity.adapter}
                            </span>
                          )}
                          <span className="spacer" />
                          {(item.activity.kind === 'note' || item.activity.kind === 'merge') && (
                            <button
                              className="btn ghost sm icon-only danger"
                              aria-label="기록 삭제"
                              onClick={() => removeActivity(item.activity)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        <div className="timeline-text">{activityText(item.activity)}</div>
                        {item.activity.kind === 'draft' && item.activity.person_email && (
                          <div className="muted timeline-sub">→ {item.activity.person_email}</div>
                        )}
                      </div>
                    </li>
                  ) : (
                    <li
                      key={`m-${item.mail.id}`}
                      className={`timeline-item kind-mail-${item.mail.direction}`}
                    >
                      <span className="timeline-dot" />
                      <div className="timeline-body">
                        <div className="timeline-meta">
                          <span className={`badge kind-mail-${item.mail.direction}`}>
                            {item.mail.direction === 'in' ? (
                              <>
                                <ArrowDownLeft size={10} /> 받음
                              </>
                            ) : (
                              <>
                                <ArrowUpRight size={10} /> 보냄
                              </>
                            )}
                          </span>
                          <span className="muted nowrap">{item.mail.occurredAt}</span>
                          {item.mail.accountName && (
                            <span className="muted">· {item.mail.accountName}</span>
                          )}
                          <span className="spacer" />
                          {item.mail.openRef.startsWith('http') && (
                            <button
                              className="btn ghost sm icon-only"
                              aria-label="원문 열기"
                              title="메일 클라이언트에서 원문 열기"
                              onClick={() => window.api.system.openExternal(item.mail.openRef)}
                            >
                              <ExternalLink size={13} />
                            </button>
                          )}
                        </div>
                        <div className="timeline-text">{item.mail.subject || '(제목 없음)'}</div>
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
