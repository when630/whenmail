import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Save, Search, Trash2, Users } from 'lucide-react'
import type { Organization, OrganizationInput, Person } from '../../../shared/types'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'

interface Props {
  /** 사람 화면으로 이동해 이 회사 소속만 보기 */
  onShowPeople: (organizationId: number, name: string) => void
}

const EMPTY: OrganizationInput = { name: '', domain: '', memo: '' }

/**
 * 회사 목록(왼쪽) + 상세(오른쪽). 상세에서는 이름·도메인·메모를 고치고 소속 사람을 본다.
 * 회사는 사람 저장 시 자동으로 생기므로 여기서 새로 만들지는 않는다.
 */
export default function CompaniesView({ onShowPeople }: Props): React.JSX.Element {
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState<OrganizationInput>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [members, setMembers] = useState<Person[] | null>(null)
  const [saving, setSaving] = useState(false)
  const { confirm, toast } = useDialog()

  const reload = useCallback(async (): Promise<Organization[]> => {
    const list = await window.api.organizations.list()
    setOrgs(list)
    return list
  }, [])

  useEffect(() => {
    window.api.organizations.list().then(setOrgs)
  }, [])

  const selected = useMemo(() => orgs?.find((o) => o.id === selectedId) ?? null, [orgs, selectedId])

  // 선택이 바뀐 렌더에서 폼을 그 회사 값으로 맞춘다
  const [formFor, setFormFor] = useState<number | null>(null)
  if ((selected?.id ?? null) !== formFor) {
    setFormFor(selected?.id ?? null)
    setForm(
      selected ? { name: selected.name, domain: selected.domain, memo: selected.memo } : EMPTY
    )
    setDirty(false)
    setMembers(null)
  }
  useEffect(() => {
    if (selected) window.api.people.list({ organizationId: selected.id }).then(setMembers)
  }, [selected])

  const filtered = useMemo(() => {
    if (!orgs) return null
    const q = search.trim().toLowerCase()
    if (!q) return orgs
    return orgs.filter((o) => [o.name, o.domain, o.memo].some((v) => v.toLowerCase().includes(q)))
  }, [orgs, search])

  const select = async (o: Organization): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: '저장하지 않은 변경',
        message: '저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다.',
        confirmLabel: '이동'
      })
      if (!ok) return
    }
    setSelectedId(o.id)
  }

  const set = (key: keyof OrganizationInput, value: string): void => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!selected || !form.name.trim()) return
    setSaving(true)
    try {
      await window.api.organizations.update(selected.id, form)
      await reload()
      setDirty(false)
      toast('저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    const ok = await confirm({
      title: '회사 삭제',
      message: `'${selected.name}'을(를) 삭제할까요?\n소속 ${selected.person_count}명은 남고 회사 정보만 비워집니다.`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.organizations.remove(selected.id)
    setSelectedId(null)
    await reload()
    toast('삭제되었습니다')
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>회사</h1>
        <div className="toolbar">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="회사·도메인 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

      {filtered === null ? null : orgs && orgs.length === 0 ? (
        <div className="empty">
          <Building2 size={36} strokeWidth={1.4} />
          <span className="empty-title">아직 회사가 없습니다</span>
          <span>사람을 등록할 때 회사를 입력하면 여기에 자동으로 모입니다.</span>
        </div>
      ) : (
        <div className="view-split">
          <div className="split-list">
            <ul className="side-list">
              {filtered.map((o) => (
                <li
                  key={o.id}
                  className={o.id === selectedId ? 'active' : ''}
                  onClick={() => select(o)}
                >
                  <strong>{o.name}</strong>
                  <small>
                    {o.person_count}명{o.domain ? ` · ${o.domain}` : ''}
                  </small>
                </li>
              ))}
              {filtered.length === 0 && <li className="muted">검색 결과가 없습니다</li>}
            </ul>
          </div>

          <div className="split-editor">
            {!selected ? (
              <div className="empty">
                <Building2 size={32} strokeWidth={1.4} />
                <span className="empty-title">회사를 선택하세요</span>
                <span>소속 사람과 메모를 볼 수 있습니다.</span>
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <label className="form-field">
                    <span>
                      회사 이름<em className="req">*</em>
                    </span>
                    <input value={form.name} onChange={(e) => set('name', e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span>
                      이메일 도메인{' '}
                      <em className="muted hint-inline">— 소속 사람의 회사 주소에서 자동 추출</em>
                    </span>
                    <input
                      value={form.domain}
                      placeholder="예: company.co.kr"
                      onChange={(e) => set('domain', e.target.value)}
                    />
                  </label>
                  <label className="form-field form-field-wide">
                    <span>메모</span>
                    <textarea
                      rows={3}
                      value={form.memo}
                      placeholder="거래 조건, 담당 부서, 주의사항 등"
                      onChange={(e) => set('memo', e.target.value)}
                    />
                  </label>
                </div>
                <div className="editor-actions">
                  <button className="btn danger" onClick={remove}>
                    <Trash2 size={15} />
                    삭제
                  </button>
                  <span className="spacer" />
                  {dirty && <span className="dirty-hint">저장되지 않음</span>}
                  <button
                    className="btn primary"
                    onClick={save}
                    disabled={saving || !dirty || !form.name.trim()}
                  >
                    <Save size={15} />
                    저장
                  </button>
                </div>

                <div className="member-head">
                  <h3 className="detail-title">
                    <Users size={15} /> 소속 {members?.length ?? selected.person_count}명
                  </h3>
                  <button
                    className="btn sm"
                    onClick={() => onShowPeople(selected.id, selected.name)}
                  >
                    사람 화면에서 보기
                  </button>
                </div>
                {members === null ? null : members.length === 0 ? (
                  <p className="muted">소속 사람이 없습니다</p>
                ) : (
                  <ul className="member-list">
                    {members.map((p) => (
                      <li key={p.id}>
                        <Avatar name={p.name} />
                        <span className="member-main">
                          <strong>{p.name}</strong>
                          <small className="muted">
                            {[p.department, p.title].filter(Boolean).join(' · ')}
                          </small>
                        </span>
                        <span className="muted member-email">
                          {p.email || <span className="badge warn">이메일 없음</span>}
                        </span>
                        <span className="muted nowrap">
                          {p.last_contact_at?.slice(0, 10) ?? ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
