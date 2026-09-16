import { useEffect, useState } from 'react'
import { Loader2, Plus, ScanLine, Trash2, X } from 'lucide-react'
import type { BusinessCard, Person, PersonInput } from '../../../shared/types'
import { useDialog } from '../components/dialogs'

type StringField = Exclude<
  keyof PersonInput,
  'tags' | 'emails' | 'new_card_paths' | 'remove_card_ids'
>

const EMPTY: PersonInput = {
  name: '',
  company: '',
  department: '',
  title: '',
  emails: [],
  phone: '',
  mobile: '',
  address: '',
  website: '',
  memo: '',
  tags: []
}

const FIELDS: { key: StringField; label: string; required?: boolean }[] = [
  { key: 'name', label: '이름', required: true },
  { key: 'company', label: '회사' },
  { key: 'department', label: '부서' },
  { key: 'title', label: '직함' },
  { key: 'phone', label: '전화' },
  { key: 'mobile', label: '휴대폰' },
  { key: 'address', label: '주소' },
  { key: 'website', label: '웹사이트' }
]

interface Props {
  person: Person | null
  /** 회사 목록 자동완성 */
  companyOptions?: string[]
  onSave: (input: PersonInput) => Promise<void>
  onClose: () => void
}

/** 새로 스캔해 붙일 명함 (저장 전) */
interface PendingCard {
  path: string
  dataUrl: string
}

export default function PersonForm({
  person,
  companyOptions = [],
  onSave,
  onClose
}: Props): React.JSX.Element {
  const [form, setForm] = useState<PersonInput>(
    person
      ? {
          name: person.name,
          company: person.company,
          department: person.department,
          title: person.title,
          emails: person.emails.map((e) => e.address),
          phone: person.phone,
          mobile: person.mobile,
          address: person.address,
          website: person.website,
          memo: person.memo,
          tags: person.tags
        }
      : EMPTY
  )
  /** 입력 중인 이메일 목록 — 빈 칸도 유지해 편집할 수 있게 하고 저장 시 정리 */
  const [emails, setEmails] = useState<string[]>(
    person && person.emails.length > 0 ? person.emails.map((e) => e.address) : ['']
  )
  const [tagsText, setTagsText] = useState(person ? person.tags.join(', ') : '')
  const [cards, setCards] = useState<BusinessCard[]>(person?.cards ?? [])
  const [removedCardIds, setRemovedCardIds] = useState<number[]>([])
  const [pending, setPending] = useState<PendingCard[]>([])
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const { toast } = useDialog()

  useEffect(() => {
    for (const c of person?.cards ?? []) {
      window.api.files
        .imageDataUrl(c.image_path)
        .then((url) => url && setThumbs((t) => ({ ...t, [c.id]: url })))
        .catch(() => undefined)
    }
  }, [person])

  const set = (key: StringField, value: string): void => setForm((f) => ({ ...f, [key]: value }))

  const setEmail = (i: number, value: string): void =>
    setEmails((list) => list.map((e, idx) => (idx === i ? value : e)))
  const addEmail = (): void => setEmails((list) => [...list, ''])
  const removeEmail = (i: number): void =>
    setEmails((list) => (list.length === 1 ? [''] : list.filter((_, idx) => idx !== i)))

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      const result = await window.api.ocr.scanCard()
      if (!result) return
      // 사용자가 이미 입력한 값은 유지하고 빈 필드만 채운다
      setForm((f) => {
        const next = { ...f }
        for (const [key, value] of Object.entries(result.fields)) {
          if (key === 'emails' || key === 'tags' || typeof value !== 'string' || !value) continue
          const k = key as StringField
          if (!next[k]?.trim()) next[k] = value
        }
        return next
      })
      const found = result.fields.emails ?? []
      if (found.length > 0) {
        setEmails((list) => {
          const filled = list.filter((e) => e.trim())
          const merged = [...filled]
          for (const e of found) if (!merged.includes(e)) merged.push(e)
          return merged.length ? merged : ['']
        })
      }
      setPending((list) => [...list, { path: result.imagePath, dataUrl: result.imageDataUrl }])
      toast('명함에서 정보를 추출했습니다. 내용을 확인해 주세요', 'info')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setScanning(false)
    }
  }

  const removeCard = (card: BusinessCard): void => {
    setCards((list) => list.filter((c) => c.id !== card.id))
    setRemovedCardIds((ids) => [...ids, card.id])
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const tags = [
        ...new Set(
          tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        )
      ]
      const cleanEmails = [...new Set(emails.map((x) => x.trim().toLowerCase()).filter(Boolean))]
      await onSave({
        ...form,
        emails: cleanEmails,
        tags,
        new_card_paths: pending.map((p) => p.path),
        remove_card_ids: removedCardIds
      })
    } finally {
      setSaving(false)
    }
  }

  const hasAnyCard = cards.length > 0 || pending.length > 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{person ? '사람 편집' : '사람 등록'}</h2>
          <div className="modal-header-actions">
            <button type="button" className="btn sm" onClick={scan} disabled={scanning}>
              {scanning ? <Loader2 size={14} className="spin" /> : <ScanLine size={14} />}
              {scanning ? '인식 중…' : '명함 스캔'}
            </button>
            <button
              type="button"
              className="btn ghost sm icon-only"
              aria-label="닫기"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {hasAnyCard && (
          <div className="card-gallery">
            {cards.map((c) => (
              <figure key={c.id} className="card-thumb">
                {thumbs[c.id] ? (
                  <img src={thumbs[c.id]} alt="명함 이미지" />
                ) : (
                  <span className="card-thumb-placeholder">명함</span>
                )}
                <button
                  type="button"
                  className="btn ghost sm icon-only danger card-thumb-remove"
                  aria-label="명함 떼기"
                  onClick={() => removeCard(c)}
                >
                  <Trash2 size={13} />
                </button>
              </figure>
            ))}
            {pending.map((p, i) => (
              <figure key={p.path} className="card-thumb card-thumb-new">
                <img src={p.dataUrl} alt="새 명함 이미지" />
                <span className="badge neutral card-thumb-badge">새 명함</span>
                <button
                  type="button"
                  className="btn ghost sm icon-only danger card-thumb-remove"
                  aria-label="새 명함 취소"
                  onClick={() => setPending((list) => list.filter((_, idx) => idx !== i))}
                >
                  <Trash2 size={13} />
                </button>
              </figure>
            ))}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="form-grid">
            {FIELDS.map((f) => (
              <label key={f.key} className="form-field">
                <span>
                  {f.label}
                  {f.required && <em className="req">*</em>}
                </span>
                <input
                  value={form[f.key]}
                  required={f.required}
                  list={f.key === 'company' ? 'person-company-options' : undefined}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
            <datalist id="person-company-options">
              {companyOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            <div className="form-field form-field-wide">
              <span>
                이메일 <em className="muted hint-inline">— 첫 주소가 초안의 기본 수신 주소</em>
              </span>
              <div className="email-list">
                {emails.map((value, i) => (
                  <div key={i} className="email-row">
                    <input
                      type="email"
                      value={value}
                      placeholder={i === 0 ? '대표 주소' : '추가 주소'}
                      aria-label={i === 0 ? '대표 이메일' : `추가 이메일 ${i}`}
                      onChange={(e) => setEmail(i, e.target.value)}
                    />
                    {i === 0 && value.trim() && <span className="badge neutral">대표</span>}
                    <button
                      type="button"
                      className="btn ghost sm icon-only"
                      aria-label="주소 삭제"
                      disabled={emails.length === 1 && !value}
                      onClick={() => removeEmail(i)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn ghost sm email-add" onClick={addEmail}>
                  <Plus size={14} />
                  주소 추가
                </button>
              </div>
            </div>

            <label className="form-field">
              <span>태그 (쉼표로 구분)</span>
              <input
                value={tagsText}
                placeholder="예: 전시회, VIP"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>메모</span>
              <textarea rows={3} value={form.memo} onChange={(e) => set('memo', e.target.value)} />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn primary" disabled={saving || !form.name.trim()}>
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
