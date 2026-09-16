import { useEffect, useMemo, useState } from 'react'
import { Activity as ActivityIcon, Search } from 'lucide-react'
import type { Activity, ActivityKind } from '../../../shared/types'
import { KIND_LABEL, activityText } from '../activityLabels'

const KIND_FILTERS: { value: ActivityKind | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'note', label: '메모' },
  { value: 'card', label: '명함' },
  { value: 'merge', label: '병합' }
]

export default function ActivityView(): React.JSX.Element {
  const [items, setItems] = useState<Activity[] | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<ActivityKind | 'all'>('all')

  useEffect(() => {
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

  return (
    <div className="view">
      <header className="view-header">
        <h1>활동</h1>
        <div className="toolbar">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="사람·제목·메모·템플릿 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

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
                    {a.adapter && <span className={`badge mode-${a.adapter}`}>{a.adapter}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
