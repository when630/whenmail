import { useMemo, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, X } from 'lucide-react'
import type {
  DuplicatePolicy,
  ImportParseResult,
  ImportSummary,
  PersonInput
} from '../../../shared/types'
import {
  IMPORT_FIELDS,
  guessMapping,
  rowToPersonInput,
  splitList,
  type ImportKey
} from '../../../shared/importFields'
import { useDialog } from '../components/dialogs'

interface Props {
  onClose: (imported: boolean) => void
}

/** 미리보기 셀 표시 */
function previewCell(row: PersonInput, key: ImportKey): string {
  switch (key) {
    case 'email':
      return row.emails[0] ?? ''
    case 'emails_extra':
      return row.emails.slice(1).join(', ')
    case 'tags':
      return row.tags.join(', ')
    default:
      return row[key]
  }
}

export default function ImportModal({ onClose }: Props): React.JSX.Element {
  const [parsed, setParsed] = useState<ImportParseResult | null>(null)
  const [mapping, setMapping] = useState<Record<ImportKey, number> | null>(null)
  /** 가져오는 모든 사람에 함께 붙일 태그 (쉼표 구분) */
  const [extraTags, setExtraTags] = useState('')
  const [policy, setPolicy] = useState<DuplicatePolicy>('skip')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const { toast } = useDialog()

  const pickFile = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.import.pick()
      if (result) {
        setParsed(result)
        setMapping(guessMapping(result.headers))
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const mappedRows = useMemo<PersonInput[]>(() => {
    if (!parsed || !mapping) return []
    const common = splitList(extraTags)
    return parsed.rows.map((row) => rowToPersonInput(row, mapping, common))
  }, [parsed, mapping, extraTags])

  /** 미리보기에 보일 열 — 매핑된 열 + (일괄 태그가 있으면) 태그 열 */
  const previewFields = IMPORT_FIELDS.filter(
    (f) => mapping !== null && (mapping[f.key] >= 0 || (f.key === 'tags' && extraTags.trim()))
  )

  const validCount = mappedRows.filter((r) => r.name.trim()).length

  const commit = async (): Promise<void> => {
    setBusy(true)
    try {
      setSummary(await window.api.import.commit(mappedRows, policy))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => onClose(summary !== null)}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>CSV/엑셀 가져오기</h2>
          <button
            className="btn ghost sm icon-only"
            aria-label="닫기"
            onClick={() => onClose(summary !== null)}
          >
            <X size={16} />
          </button>
        </div>

        {summary ? (
          <div>
            <div className="import-summary">
              <CheckCircle2 size={20} />
              <span>
                {summary.inserted}명 추가
                {summary.updated > 0 && ` · ${summary.updated}명 덮어씀`}
                {summary.skipped > 0 && ` · 중복 ${summary.skipped}명 건너뜀`}
                {summary.invalid > 0 && ` · 이름 없는 ${summary.invalid}행 제외`}
              </span>
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onClose(true)}>
                완료
              </button>
            </div>
          </div>
        ) : !parsed ? (
          <div className="empty">
            <FileSpreadsheet size={36} strokeWidth={1.4} />
            <span className="empty-title">CSV 또는 엑셀 파일을 선택하세요</span>
            <span>첫 행은 열 이름(헤더)이어야 합니다. 내보내기로 만든 파일은 그대로 읽힙니다.</span>
            <button className="btn primary" onClick={pickFile} disabled={busy}>
              파일 선택
            </button>
          </div>
        ) : (
          mapping && (
            <>
              <p className="muted import-file">
                <FileSpreadsheet size={15} /> {parsed.fileName} — {parsed.rows.length}행
              </p>
              <div className="mapping-grid">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field.key} className="form-field">
                    <span>
                      {field.label}
                      {field.key === 'name' && <em className="req">*</em>}
                    </span>
                    <select
                      aria-label={`${field.label} 열 선택`}
                      value={mapping[field.key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field.key]: Number(e.target.value) })
                      }
                    >
                      <option value={-1}>(가져오지 않음)</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <label className="form-field import-extra-tags">
                <span>가져오는 모든 사람에 태그 추가 (선택, 쉼표 구분)</span>
                <input
                  value={extraTags}
                  placeholder="예: 2026 전시회"
                  onChange={(e) => setExtraTags(e.target.value)}
                />
              </label>

              <div className="import-preview">
                <div className="palette-group">미리보기 (처음 4행)</div>
                <div className="card table-scroll">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        {previewFields.map((f) => (
                          <th key={f.key}>{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedRows.slice(0, 4).map((row, i) => (
                        <tr key={i}>
                          {previewFields.map((f) => (
                            <td key={f.key}>{previewCell(row, f.key)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="import-policy">
                <span className="muted">이메일이 같은 사람이 이미 있으면:</span>
                <label>
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === 'skip'}
                    onChange={() => setPolicy('skip')}
                  />
                  건너뛰기
                </label>
                <label>
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === 'overwrite'}
                    onChange={() => setPolicy('overwrite')}
                  />
                  덮어쓰기
                </label>
              </div>

              <div className="modal-actions">
                <button className="btn" onClick={() => setParsed(null)} disabled={busy}>
                  다른 파일
                </button>
                <button
                  className="btn primary"
                  onClick={commit}
                  disabled={busy || validCount === 0 || mapping.name < 0}
                >
                  {validCount}명 가져오기
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
