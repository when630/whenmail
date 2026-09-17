import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity as ActivityIcon,
  CalendarClock,
  CheckCheck,
  Clock,
  ListChecks,
  Loader2,
  Search,
  SendHorizontal,
  Timer
} from 'lucide-react'
import type { Activity, ActivityKind, TodoItem } from '../../../shared/types'
import { KIND_LABEL, activityText } from '../activityLabels'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'

const KIND_FILTERS: { value: ActivityKind | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'note', label: '메모' },
  { value: 'card', label: '명함' },
  { value: 'merge', label: '병합' }
]

const SNOOZE_DAYS = [1, 3, 7]

interface Props {
  /** 할 일에서 초안 만들기 — 후속이면 그 후속을 처리한다 */
  onCompose: (personId: number, templateId?: number | null, followUpId?: number | null) => void
}

export default function ActivityView({ onCompose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<'todo' | 'log'>('todo')
  const [items, setItems] = useState<Activity[] | null>(null)
  const [todos, setTodos] = useState<TodoItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<ActivityKind | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const { toast } = useDialog()

  const reloadTodos = useCallback(async () => {
    setTodos(await window.api.todos.list())
  }, [])

  useEffect(() => {
    window.api.todos.list().then(setTodos)
    window.api.activities.list().then(setItems)
  }, [])

  const filtered = useMemo(() => {
    if (!items) return null
    const q = search.trim().toLowerCase()
    return items.filter((a) => {
      if (kind !== 'all' && a.kind !== kind) return false
      if (!q) return true
      return [a.person_name, a.person_email, a.summary, a.template_name].some((v) =>
        v.toLowerCase().includes(q)
      )
    })
  }, [items, search, kind])

  const act = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    try {
      await fn()
      await reloadTodos()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const overdueCount = (todos ?? []).filter((t) => t.overdue).length

  return (
    <div className="view">
      <header className="view-header">
        <h1>활동</h1>
        <div className="toolbar">
          {tab === 'log' && (
            <div className="search-box">
              <Search size={15} />
              <input
                placeholder="사람·제목·메모·템플릿 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>
      </header>

      <div className="segment view-tabs" role="tablist" aria-label="활동 보기">
        <button
          role="tab"
          aria-selected={tab === 'todo'}
          className={tab === 'todo' ? 'active' : ''}
          onClick={() => setTab('todo')}
        >
          <ListChecks size={14} /> 할 일
          {overdueCount > 0 && <span className="tab-count">{overdueCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'log'}
          className={tab === 'log' ? 'active' : ''}
          onClick={() => setTab('log')}
        >
          <ActivityIcon size={14} /> 기록
        </button>
      </div>

      {tab === 'todo' ? (
        todos === null ? null : todos.length === 0 ? (
          <div className="empty">
            <ListChecks size={36} strokeWidth={1.4} />
            <span className="empty-title">챙길 일이 없습니다</span>
            <span>
              초안을 만들 때 후속을 걸거나, 사람 상세에서 리마인더를 추가하면 여기에 모입니다.
            </span>
          </div>
        ) : (
          <ul className="todo-list">
            {todos.map((t) => (
              <li key={t.key} className={`todo-item ${t.overdue ? 'overdue' : ''}`}>
                <Avatar name={t.personName} />
                <div className="todo-body">
                  <div className="todo-meta">
                    <span className={`badge ${t.kind === 'follow_up' ? 'kind-follow_up' : 'warn'}`}>
                      {t.kind === 'follow_up' ? (
                        <>
                          <CalendarClock size={10} /> 후속
                        </>
                      ) : (
                        <>
                          <Clock size={10} /> 회신 대기
                        </>
                      )}
                    </span>
                    <strong>{t.personName}</strong>
                    {t.company && <span className="muted">{t.company}</span>}
                    {t.sequenceName && (
                      <span className="badge neutral">
                        {t.sequenceName}
                        {t.stepNo ? ` ${t.stepNo}단계` : ''}
                      </span>
                    )}
                    <span className="spacer" />
                    <span className={`muted nowrap ${t.overdue ? 'todo-due' : ''}`}>
                      {t.kind === 'follow_up' ? '기한 ' : '보낸 날 '}
                      {t.at.slice(0, 16)}
                    </span>
                  </div>
                  {t.note && <div className="todo-note">{t.note}</div>}
                  <div className="todo-actions">
                    <button
                      className="btn sm"
                      onClick={() => onCompose(t.personId, t.templateId, t.followUpId)}
                    >
                      <SendHorizontal size={13} />
                      초안 만들기
                      {t.templateName ? ` (${t.templateName})` : ''}
                    </button>
                    {t.followUpId && (
                      <>
                        <button
                          className="btn ghost sm"
                          disabled={busy === t.key}
                          onClick={() =>
                            act(t.key, () => window.api.followUps.complete(t.followUpId!))
                          }
                        >
                          {busy === t.key ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <CheckCheck size={13} />
                          )}
                          완료
                        </button>
                        <span className="todo-snooze">
                          <Timer size={13} className="muted" />
                          {SNOOZE_DAYS.map((d) => (
                            <button
                              key={d}
                              className="btn ghost sm"
                              disabled={busy === t.key}
                              onClick={() =>
                                act(t.key, () => window.api.followUps.snooze(t.followUpId!, d))
                              }
                            >
                              +{d}일
                            </button>
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="tag-filter">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`chip ${kind === f.value ? 'chip-active' : ''}`}
                onClick={() => setKind(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered === null ? null : filtered.length === 0 ? (
            <div className="empty">
              <ActivityIcon size={36} strokeWidth={1.4} />
              <span className="empty-title">
                {search || kind !== 'all' ? '조건에 맞는 활동이 없습니다' : '아직 활동이 없습니다'}
              </span>
              {!search && kind === 'all' && (
                <span>사람을 선택해 메일 초안을 만들거나 메모를 남겨 보세요.</span>
              )}
            </div>
          ) : (
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>종류</th>
                    <th>사람</th>
                    <th>내용</th>
                    <th>템플릿</th>
                    <th>방식</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => (
                    <tr key={a.id} style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}>
                      <td className="nowrap">{a.occurred_at}</td>
                      <td>
                        <span className={`badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                      </td>
                      <td>
                        {a.person_name || <span className="muted">(삭제된 사람)</span>}
                        {a.person_email && <small className="muted"> {a.person_email}</small>}
                      </td>
                      <td className="cell-summary">{activityText(a)}</td>
                      <td>{a.template_name}</td>
                      <td>
                        {a.adapter && (
                          <span className={`badge mode-${a.adapter}`}>{a.adapter}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
