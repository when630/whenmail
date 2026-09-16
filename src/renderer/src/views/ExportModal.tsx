import { useState } from 'react'
import { Download, FileSpreadsheet, FolderOpen, Loader2, X } from 'lucide-react'
import type { ExportFormat } from '../../../shared/types'
import { EXPORT_HEADERS } from '../../../shared/importFields'
import { useDialog } from '../components/dialogs'

interface Props {
  /** 현재 선택된 사람 id (없으면 선택 범위 비활성) */
  selectedIds: number[]
  /** 현재 필터 결과 전체의 id */
  visibleIds: number[]
  onClose: () => void
}

/**
 * 사람 목록 내보내기. 범위(선택 / 현재 목록 전체)와 형식(CSV / Excel)을 고른다.
 * 열은 가져오기와 동일해 내보낸 파일을 그대로 다시 가져올 수 있다.
 */
export default function ExportModal({
  selectedIds,
  visibleIds,
  onClose
}: Props): React.JSX.Element {
  const [scope, setScope] = useState<'selected' | 'all'>(
    selectedIds.length > 0 ? 'selected' : 'all'
  )
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const { toast } = useDialog()

  const ids = scope === 'selected' ? selectedIds : visibleIds

  const run = async (): Promise<void> => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const path = await window.api.people.export(ids, format)
      if (path) setSaved(path)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>사람 목록 내보내기</h2>
          <button className="btn ghost sm icon-only" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {saved ? (
          <div>
            <div className="import-summary">
              <FileSpreadsheet size={20} />
              <span>
                {ids.length}명을 저장했습니다
                <br />
                <small className="muted">{saved}</small>
              </span>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.api.system.showInFolder(saved)}>
                <FolderOpen size={15} />
                폴더 열기
              </button>
              <button className="btn primary" onClick={onClose}>
                완료
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="option-group">
              <span className="option-label">범위</span>
              <label className={`option-row ${selectedIds.length === 0 ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="export-scope"
                  disabled={selectedIds.length === 0}
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                />
                선택한 {selectedIds.length}명
              </label>
              <label className="option-row">
                <input
                  type="radio"
                  name="export-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                현재 목록 전체 {visibleIds.length}명
                <span className="muted hint-inline"> — 검색·태그·회사 필터가 반영됩니다</span>
              </label>
            </div>

            <div className="option-group">
              <span className="option-label">형식</span>
              <label className="option-row">
                <input
                  type="radio"
                  name="export-format"
                  checked={format === 'xlsx'}
                  onChange={() => setFormat('xlsx')}
                />
                Excel (.xlsx)
              </label>
              <label className="option-row">
                <input
                  type="radio"
                  name="export-format"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                />
                CSV (.csv, UTF-8)
                <span className="muted hint-inline"> — 엑셀에서 바로 열립니다</span>
              </label>
            </div>

            <p className="muted export-columns">
              열: {EXPORT_HEADERS.join(' · ')}
              <br />
              가져오기와 같은 열이라 내보낸 파일을 그대로 다시 가져올 수 있습니다.
            </p>

            <div className="modal-actions">
              <button className="btn" onClick={onClose} disabled={busy}>
                취소
              </button>
              <button className="btn primary" onClick={run} disabled={busy || ids.length === 0}>
                {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {ids.length}명 저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
