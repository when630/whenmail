import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { BulkPersonPatch } from '../../../shared/types'

type BulkField = keyof BulkPersonPatch['fields']

const FIELDS: { key: BulkField; label: string; placeholder?: string }[] = [
  { key: 'company', label: '회사' },
  { key: 'department', label: '부서' },
  { key: 'title', label: '직함' },
  { key: 'phone', label: '전화 (대표번호)' },
  { key: 'address', label: '주소' },
  { key: 'website', label: '웹사이트' }
]

const TAG_MODES: { value: NonNullable<BulkPersonPatch['tags']>['mode']; label: string }[] = [
  { value: 'add', label: '추가' },
  { value: 'remove', label: '제거' },
  { value: 'replace', label: '교체' }
]

interface Props {
  /** 대상 사람 수 */
  count: number
  /** 태그 입력 자동완성용 */
  tagOptions: string[]
  onApply: (patch: BulkPersonPatch) => Promise<void>
  onClose: () => void
}

/**
 * 여러 사람에 공통 값을 한 번에 적용하는 모달.
 * "변경" 체크를 켠 필드만 덮어쓴다 — 체크만 켜고 비워 두면 그 필드를 비운다.
 * 이름·이메일·휴대폰·메모는 사람마다 다르므로 일괄 수정 대상에서 제외.
 */
export default function BulkEditModal({
  count,
  tagOptions,
  onApply,
  onClose
}: Props): React.JSX.Element {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<BulkField, string>>({
    company: '',
    department: '',
    title: '',
    phone: '',
    address: '',
    website: ''
  })
  const [tagsEnabled, setTagsEnabled] = useState(false)
  const [tagMode, setTagMode] = useState<NonNullable<BulkPersonPatch['tags']>['mode']>('add')
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)

  const tagValues = [
    ...new Set(
      tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ]
  const enabledFields = FIELDS.filter((f) => enabled[f.key])
  // 태그 "교체"는 빈 목록도 의미가 있지만(모두 제거), 추가/제거는 값이 있어야 한다
  const tagsReady = tagsEnabled && (tagMode === 'replace' || tagValues.length > 0)
  const canApply = enabledFields.length > 0 || tagsReady

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canApply) return
    const patch: BulkPersonPatch = { fields: {} }
    for (const f of enabledFields) patch.fields[f.key] = values[f.key].trim()
    if (tagsReady) patch.tags = { mode: tagMode, values: tagValues }
    setSaving(true)
    try {
      await onApply(patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>일괄 수정 ({count}명)</h2>
          <button
            type="button"
            className="btn ghost sm icon-only"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <p className="muted bulk-hint">
          변경할 항목만 체크하세요. 체크한 항목은 선택한 모든 사람에서 같은 값으로 바뀝니다.
        </p>

        <form onSubmit={submit}>
          <div className="bulk-fields">
            {FIELDS.map((f) => (
              <div key={f.key} className={`bulk-field ${enabled[f.key] ? 'on' : ''}`}>
                <label className="bulk-check">
                  <input
                    type="checkbox"
                    checked={Boolean(enabled[f.key])}
                    onChange={(e) => setEnabled((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                  />
                  <span>{f.label}</span>
                </label>
                <input
                  value={values[f.key]}
                  disabled={!enabled[f.key]}
                  placeholder={enabled[f.key] ? '비워 두면 해당 항목을 지웁니다' : ''}
                  aria-label={`${f.label} 새 값`}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </div>
            ))}

            <div className={`bulk-field bulk-field-tags ${tagsEnabled ? 'on' : ''}`}>
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={tagsEnabled}
                  onChange={(e) => setTagsEnabled(e.target.checked)}
                />
                <span>태그</span>
              </label>
              <div className="bulk-tags-row">
                <select
                  value={tagMode}
                  disabled={!tagsEnabled}
                  aria-label="태그 적용 방식"
                  onChange={(e) =>
                    setTagMode(e.target.value as NonNullable<BulkPersonPatch['tags']>['mode'])
                  }
                >
                  {TAG_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  list="bulk-tag-options"
                  value={tagsText}
                  disabled={!tagsEnabled}
                  placeholder="쉼표로 구분 — 예: 전시회, VIP"
                  aria-label="태그 목록"
                  onChange={(e) => setTagsText(e.target.value)}
                />
                <datalist id="bulk-tag-options">
                  {tagOptions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              {tagsEnabled && tagMode === 'replace' && tagValues.length === 0 && (
                <span className="field-error">
                  비운 채 교체하면 선택한 사람의 태그가 모두 제거됩니다
                </span>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn primary" disabled={saving || !canApply}>
              {saving && <Loader2 size={15} className="spin" />}
              {count}명에 적용
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
