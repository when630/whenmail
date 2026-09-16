import { dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { EXPORT_HEADERS, personToRow } from '../shared/importFields'
import type { ExportFormat, Person } from '../shared/types'

/**
 * 사람 목록을 CSV/xlsx로 저장한다. 열은 가져오기 매핑과 동일해 그대로 다시 가져올 수 있다.
 * CSV는 UTF-8 BOM을 붙여 한국어 Excel에서 바로 열린다. 취소 시 null, 성공 시 저장 경로
 */
export async function exportPeople(people: Person[], format: ExportFormat): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const ext = format === 'xlsx' ? 'xlsx' : 'csv'
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '사람 목록 내보내기',
    defaultPath: `whenmail-people-${stamp}.${ext}`,
    filters:
      format === 'xlsx'
        ? [{ name: 'Excel', extensions: ['xlsx'] }]
        : [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (canceled || !filePath) return null

  const rows = [EXPORT_HEADERS, ...people.map(personToRow)]
  const sheet = XLSX.utils.aoa_to_sheet(rows)

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '사람')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    fs.writeFileSync(filePath, buf)
  } else {
    // sheet_to_csv는 BOM을 붙이지 않으므로 직접 붙인다. 줄바꿈은 Excel 호환을 위해 CRLF
    const csv = XLSX.utils.sheet_to_csv(sheet, { RS: '\r\n' })
    fs.writeFileSync(filePath, '﻿' + csv, 'utf8')
  }
  return path.resolve(filePath)
}
