import { useEffect, useState } from 'react'
import { GitMerge, Loader2, Users, X } from 'lucide-react'
import type { DuplicateGroup, Person } from '../../../shared/types'
import Avatar from '../components/Avatar'
import { useDialog } from '../components/dialogs'

interface Props {
  /** 미리 계산된 묶음. 없으면 열 때 조회 */
  initialGroups?: DuplicateGroup[]
  onClose: (merged: boolean) => void
}

const REASON_LABEL: Record<DuplicateGroup['reason'], string> = {
  email: '같은 이메일',
  name_company: '같은 이름·회사'
}

function summary(p: Person): string {
  return [p.company, p.title].filter(Boolean).join(' · ') || p.email || `${p.emails.length}개 주소`
}

/**
 * 같은 사람으로 의심되는 묶음을 나란히 보여주고, 남길 사람을 골라 나머지를 합친다.
 * 남길 사람의 값은 유지되고 빈 필드만 채워진다. 이메일·명함·태그·활동은 모두 합쳐진다.
 */
export default function MergeModal({ initialGroups, onClose }: Props): React.JSX.Element {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(initialGroups ?? null)
  const [keep, setKeep] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [mergedAny, setMergedAny] = useState(false)
  const { confirm, toast } = useDialog()

  useEffect(() => {
    if (groups === null) window.api.people.duplicates().then(setGroups)
  }, [groups])

  /** 남길 사람 — 고르지 않았으면 정보가 가장 많은 사람 */
  const keepOf = (g: DuplicateGroup): number =>
    keep[g.key] ?? [...g.people].sort((a, b) => score(b) - score(a))[0].id

  const merge = async (g: DuplicateGroup): Promise<void> => {
    const targetId = keepOf(g)
    const target = g.people.find((p) => p.id === targetId)
    if (!target) return
    const others = g.people.filter((p) => p.id !== targetId)
    const ok = await confirm({
      title: '사람 병합',
      message: `${others.map((p) => `'${p.name}'`).join(', ')}을(를) '${target.name}'에 합칠까요?\n이메일·명함·태그·활동은 모두 옮겨지고, 합쳐진 항목은 삭제됩니다.`,
      confirmLabel: '병합'
    })
    if (!ok) return
    setBusy(g.key)
    try {
      await window.api.people.merge(
        targetId,
        others.map((p) => p.id)
      )
      setMergedAny(true)
      toast(`${others.length}명을 '${target.name}'에 합쳤습니다`)
      setGroups(await window.api.people.duplicates())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => onClose(mergedAny)}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>중복 정리</h2>
          <button
            className="btn ghost sm icon-only"
            aria-label="닫기"
            onClick={() => onClose(mergedAny)}
          >
            <X size={16} />
          </button>
        </div>
        <p className="muted bulk-hint">
          같은 이메일이거나 이름·회사가 같은 사람을 묶었습니다. 남길 사람을 고르면 나머지가 그
          사람에게 합쳐집니다. 남기는 사람의 값은 그대로, 빈 항목만 채워집니다.
        </p>

        {groups === null ? null : groups.length === 0 ? (
          <div className="empty">
            <Users size={32} strokeWidth={1.4} />
            <span className="empty-title">중복으로 보이는 사람이 없습니다</span>
          </div>
        ) : (
          <div className="dup-groups">
            {groups.map((g) => (
              <section key={g.key} className="dup-group">
                <header className="dup-head">
                  <span className="badge neutral">{REASON_LABEL[g.reason]}</span>
                  <strong>{g.value}</strong>
                  <span className="spacer" />
                  <button
                    className="btn primary sm"
                    disabled={busy !== null}
                    onClick={() => merge(g)}
                  >
                    {busy === g.key ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <GitMerge size={14} />
                    )}
                    {g.people.length}명 → 1명으로 병합
                  </button>
                </header>
                <div className="dup-options">
                  {g.people.map((p) => (
                    <label
                      key={p.id}
                      className={`dup-option ${keepOf(g) === p.id ? 'chosen' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`keep-${g.key}`}
                        checked={keepOf(g) === p.id}
                        onChange={() => setKeep((k) => ({ ...k, [g.key]: p.id }))}
                      />
                      <Avatar name={p.name} />
                      <span className="dup-main">
                        <span className="dup-name">
                          {p.name}
                          {keepOf(g) === p.id && <span className="badge neutral">남김</span>}
                        </span>
                        <span className="muted">{summary(p)}</span>
                        <span className="muted dup-stats">
                          주소 {p.emails.length} · 명함 {p.cards.length} · 태그 {p.tags.length}
                          {p.last_contact_at ? ` · 마지막 초안 ${p.last_contact_at}` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={() => onClose(mergedAny)}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 채워진 정보가 많을수록 높은 점수 — 기본으로 남길 사람 결정용 */
function score(p: Person): number {
  return (
    [p.company, p.department, p.title, p.phone, p.mobile, p.address, p.website, p.memo].filter(
      Boolean
    ).length +
    p.emails.length * 2 +
    p.cards.length * 2 +
    p.tags.length +
    (p.last_contact_at ? 3 : 0)
  )
}
