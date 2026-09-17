import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  Clock,
  Download,
  GitMerge,
  IdCard,
  Pencil,
  PencilRuler,
  Plus,
  Search,
  SendHorizontal,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react'
import type { BulkPersonPatch, Person, PersonInput, TagCount } from '../../../shared/types'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'
import PersonForm from './PersonForm'
import PersonDetail from './PersonDetail'
import ComposeModal from './ComposeModal'
import ImportModal from './ImportModal'
import BulkEditModal from './BulkEditModal'
import MergeModal from './MergeModal'
import ExportModal from './ExportModal'

interface Props {
  newPersonSignal?: number
  importSignal?: number
  /** 알림함에서 사람 열기 — 같은 사람을 다시 눌러도 열리도록 순번(n)을 함께 받는다 */
  openPerson?: { id: number; n: number } | null
  /** 회사 화면에서 넘어온 회사 필터 */
  organizationFilter?: { id: number; name: string } | null
  onClearOrganizationFilter?: () => void
}

export default function PeopleView({
  newPersonSignal = 0,
  importSignal = 0,
  openPerson = null,
  organizationFilter = null,
  onClearOrganizationFilter
}: Props): React.JSX.Element {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [search, setSearch] = useState('')
  const [allTags, setAllTags] = useState<TagCount[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [awaitingOnly, setAwaitingOnly] = useState(false)
  const [awaitingCount, setAwaitingCount] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const [detail, setDetail] = useState<Person | null>(null)
  const [composeTargets, setComposeTargets] = useState<Person[] | null>(null)
  /** 후속을 처리하는 초안 — 템플릿과 후속 id를 함께 넘긴다 */
  const [composeFollowUp, setComposeFollowUp] = useState<{
    templateId: number | null
    followUpId: number
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [bulkEditing, setBulkEditing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dupCount, setDupCount] = useState(0)
  const [companyOptions, setCompanyOptions] = useState<string[]>([])
  const { confirm, toast } = useDialog()

  const reload = useCallback(
    async (q?: string, tag?: string | null, awaiting?: boolean) => {
      const [list, tags, dups, orgs, awaitingList] = await Promise.all([
        window.api.people.list({
          search: q,
          tag: tag ?? undefined,
          organizationId: organizationFilter?.id,
          awaitingReply: awaiting || undefined
        }),
        window.api.tags.list(),
        window.api.people.duplicates(),
        window.api.organizations.list(),
        window.api.people.list({ awaitingReply: true })
      ])
      setPeople(list)
      setAllTags(tags)
      setDupCount(dups.length)
      setCompanyOptions(orgs.map((o) => o.name))
      setAwaitingCount(awaitingList.length)
      // 열려 있는 상세는 최신 데이터로 갱신
      setDetail((d) => (d ? (list.find((p) => p.id === d.id) ?? d) : null))
    },
    [organizationFilter?.id]
  )

  const firstLoad = useRef(true)
  useEffect(() => {
    // 첫 로드·태그/회사 전환은 즉시, 검색 입력은 디바운스
    if (firstLoad.current) {
      firstLoad.current = false
      reload(search, activeTag, awaitingOnly)
      return
    }
    const t = setTimeout(() => reload(search, activeTag, awaitingOnly), 150)
    return () => clearTimeout(t)
  }, [search, activeTag, awaitingOnly, reload])

  // 알림함에서 넘어온 사람 열기 — openPerson은 요청할 때마다 새 객체라 그때만 돈다
  useEffect(() => {
    if (!openPerson) return
    let alive = true
    window.api.people.get(openPerson.id).then((p) => {
      if (alive && p) setDetail(p)
    })
    return () => {
      alive = false
    }
  }, [openPerson])

  // 팔레트 등 바깥에서 온 신호 — 값이 바뀐 렌더에서 바로 상태를 맞춘다
  const [seenNewSignal, setSeenNewSignal] = useState(newPersonSignal)
  if (newPersonSignal !== seenNewSignal) {
    setSeenNewSignal(newPersonSignal)
    if (newPersonSignal > 0) setEditing('new')
  }
  const [seenImportSignal, setSeenImportSignal] = useState(importSignal)
  if (importSignal !== seenImportSignal) {
    setSeenImportSignal(importSignal)
    if (importSignal > 0) setImporting(true)
  }

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async (input: PersonInput): Promise<void> => {
    const isNew = editing === 'new'
    try {
      let saved: Person
      if (isNew) saved = await window.api.people.create(input)
      else if (editing) saved = await window.api.people.update(editing.id, input)
      else return
      setEditing(null)
      await reload(search, activeTag, awaitingOnly)
      if (detail && detail.id === saved.id) setDetail(saved)
      toast(isNew ? '사람이 등록되었습니다' : '저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const remove = async (person: Person): Promise<void> => {
    const ok = await confirm({
      title: '사람 삭제',
      message: `'${person.name}'을(를) 삭제할까요?\n이메일·명함 이미지 연결이 함께 삭제되고, 활동 기록은 이름만 남습니다.`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.people.remove(person.id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(person.id)
      return next
    })
    if (detail?.id === person.id) setDetail(null)
    await reload(search, activeTag, awaitingOnly)
    toast('삭제되었습니다')
  }

  /** 현재 목록에 보이는 선택 사람만 일괄 처리 대상 (필터로 숨은 것은 제외) */
  const removeMany = async (targets: Person[]): Promise<void> => {
    if (targets.length === 0) return
    const ok = await confirm({
      title: '일괄 삭제',
      message: `선택한 ${targets.length}명을 삭제할까요?\n삭제한 사람은 되돌릴 수 없습니다.`,
      confirmLabel: `${targets.length}명 삭제`,
      danger: true
    })
    if (!ok) return
    try {
      const removed = await window.api.people.removeMany(targets.map((p) => p.id))
      setSelected(new Set())
      await reload(search, activeTag, awaitingOnly)
      toast(`${removed}명을 삭제했습니다`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const applyBulk = async (targets: Person[], patch: BulkPersonPatch): Promise<void> => {
    try {
      const updated = await window.api.people.bulkUpdate(
        targets.map((p) => p.id),
        patch
      )
      setBulkEditing(false)
      await reload(search, activeTag, awaitingOnly)
      toast(`${updated}명을 수정했습니다`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const openCompose = (targets: Person[]): void => {
    const withEmail = targets.filter((p) => p.emails.length > 0)
    if (withEmail.length === 0) {
      toast('선택한 사람에게 이메일 주소가 없습니다', 'warn')
      return
    }
    setComposeTargets(targets)
  }

  const list = people ?? []
  const selectedPeople = list.filter((p) => selected.has(p.id))
  const hasFilter = Boolean(search || activeTag || organizationFilter || awaitingOnly)

  return (
    <div className="view">
      <header className="view-header">
        <h1>사람</h1>
        <div className="toolbar">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="이름·회사·이메일·태그 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn primary"
            disabled={selected.size === 0}
            onClick={() => openCompose(selectedPeople)}
          >
            <SendHorizontal size={15} />
            메일 쓰기{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button className="btn" onClick={() => setEditing('new')}>
            <Plus size={15} />
            사람 등록
          </button>
          <button
            className="btn"
            onClick={() => setImporting(true)}
            title="CSV/엑셀 가져오기"
            aria-label="CSV/엑셀 가져오기"
          >
            <Upload size={15} />
          </button>
          <button
            className="btn"
            onClick={() => setExporting(true)}
            disabled={list.length === 0}
            title="CSV/엑셀 내보내기"
            aria-label="CSV/엑셀 내보내기"
          >
            <Download size={15} />
          </button>
          <button
            className={`btn ${dupCount > 0 ? 'attention' : ''}`}
            onClick={() => setMerging(true)}
            title="중복 정리"
            aria-label={dupCount > 0 ? `중복 ${dupCount}건 정리` : '중복 정리'}
          >
            <GitMerge size={15} />
            {dupCount > 0 && <span className="btn-count">{dupCount}</span>}
          </button>
        </div>
      </header>

      {selectedPeople.length > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="선택한 사람 작업">
          <strong>{selectedPeople.length}명 선택</strong>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setBulkEditing(true)}>
            <PencilRuler size={14} />
            일괄 수정
          </button>
          <button className="btn sm" onClick={() => setExporting(true)}>
            <Download size={14} />
            내보내기
          </button>
          <button className="btn sm danger" onClick={() => removeMany(selectedPeople)}>
            <Trash2 size={14} />
            삭제
          </button>
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      {(allTags.length > 0 || organizationFilter || awaitingCount > 0) && (
        <div className="tag-filter">
          {awaitingCount > 0 && (
            <button
              className={`chip chip-awaiting ${awaitingOnly ? 'chip-active' : ''}`}
              onClick={() => setAwaitingOnly((v) => !v)}
              title="보낸 뒤 회신이 없는 사람만 봅니다"
            >
              <Clock size={12} /> 답장 대기 <span className="chip-count">{awaitingCount}</span>
            </button>
          )}
          {organizationFilter && (
            <button
              className="chip chip-active chip-org"
              onClick={onClearOrganizationFilter}
              title="회사 필터 해제"
            >
              <Building2 size={12} /> {organizationFilter.name} <X size={12} />
            </button>
          )}
          {allTags.length > 0 && (
            <button
              className={`chip ${activeTag === null ? 'chip-active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              전체
            </button>
          )}
          {allTags.map((t) => (
            <button
              key={t.name}
              className={`chip ${activeTag === t.name ? 'chip-active' : ''}`}
              onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
            >
              {t.name} <span className="chip-count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {people === null ? null : list.length === 0 ? (
        <div className="empty">
          <Users size={36} strokeWidth={1.4} />
          {hasFilter ? (
            <span className="empty-title">조건에 맞는 사람이 없습니다</span>
          ) : (
            <>
              <span className="empty-title">아직 등록된 사람이 없습니다</span>
              <span>명함을 스캔하거나 직접 입력해 첫 사람을 등록해 보세요.</span>
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Plus size={15} />
                사람 등록
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    checked={selected.size > 0 && selected.size === list.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())
                    }
                  />
                </th>
                <th>이름</th>
                <th>회사 / 부서</th>
                <th>직함</th>
                <th>이메일</th>
                <th>태그</th>
                <th>마지막 연락</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p, i) => (
                <tr
                  key={p.id}
                  className={selected.has(p.id) ? 'row-selected' : ''}
                  style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}
                >
                  <td className="col-check">
                    <input
                      type="checkbox"
                      aria-label={`${p.name} 선택`}
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td className="cell-name" onClick={() => setDetail(p)}>
                    <span className="name-with-avatar">
                      <Avatar name={p.name} />
                      {p.name}
                      {p.cards.length > 0 && (
                        <IdCard
                          size={13}
                          className="muted"
                          aria-label={`명함 ${p.cards.length}장`}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    {p.company}
                    {p.department ? ` / ${p.department}` : ''}
                  </td>
                  <td>{p.title}</td>
                  <td className="cell-email" title={p.emails.map((e) => e.address).join('\n')}>
                    {p.email ? (
                      <>
                        {p.email}
                        {p.emails.length > 1 && (
                          <span className="badge neutral email-more">+{p.emails.length - 1}</span>
                        )}
                      </>
                    ) : (
                      <span className="badge warn">이메일 없음</span>
                    )}
                  </td>
                  <td className="cell-tags">
                    <span className="tag-list">
                      {p.tags.slice(0, 3).map((t) => (
                        <span key={t} className="badge neutral">
                          {t}
                        </span>
                      ))}
                      {p.tags.length > 3 && <span className="muted">+{p.tags.length - 3}</span>}
                    </span>
                  </td>
                  <td className="nowrap muted">
                    <span className="contact-cell">
                      {p.last_contact_at?.slice(0, 10) ?? '—'}
                      {p.awaiting_reply && (
                        <span className="badge warn" title="보낸 뒤 회신이 없습니다">
                          <Clock size={10} /> 대기
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() => openCompose([p])}
                      disabled={p.emails.length === 0}
                    >
                      <SendHorizontal size={14} />
                      메일
                    </button>
                    <button
                      className="btn ghost sm icon-only"
                      aria-label={`${p.name} 편집`}
                      onClick={() => setEditing(p)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn ghost sm icon-only danger"
                      aria-label={`${p.name} 삭제`}
                      onClick={() => remove(p)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && !editing && (
        <PersonDetail
          person={detail}
          onEdit={() => setEditing(detail)}
          onCompose={() => openCompose([detail])}
          onComposeFollowUp={(templateId, followUpId) => {
            setComposeFollowUp({ templateId, followUpId })
            setComposeTargets([detail])
          }}
          onChanged={() => reload(search, activeTag)}
          onClose={() => setDetail(null)}
        />
      )}
      {editing && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          companyOptions={companyOptions}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      {composeTargets && (
        <ComposeModal
          people={composeTargets}
          initialTemplateId={composeFollowUp?.templateId ?? undefined}
          fulfillFollowUpId={composeFollowUp?.followUpId}
          onClose={() => {
            setComposeTargets(null)
            setComposeFollowUp(null)
            reload(search, activeTag, awaitingOnly)
          }}
        />
      )}
      {bulkEditing && selectedPeople.length > 0 && (
        <BulkEditModal
          count={selectedPeople.length}
          tagOptions={allTags.map((t) => t.name)}
          onApply={(patch) => applyBulk(selectedPeople, patch)}
          onClose={() => setBulkEditing(false)}
        />
      )}
      {merging && (
        <MergeModal
          onClose={(merged) => {
            setMerging(false)
            if (merged) {
              setSelected(new Set())
              reload(search, activeTag, awaitingOnly)
            }
          }}
        />
      )}
      {exporting && (
        <ExportModal
          selectedIds={selectedPeople.map((p) => p.id)}
          visibleIds={list.map((p) => p.id)}
          onClose={() => setExporting(false)}
        />
      )}
      {importing && (
        <ImportModal
          onClose={(imported) => {
            setImporting(false)
            if (imported) reload(search, activeTag, awaitingOnly)
          }}
        />
      )}
    </div>
  )
}
