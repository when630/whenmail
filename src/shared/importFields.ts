import type { Person, PersonInput } from './types'

/**
 * 가져오기·내보내기가 공유하는 열 정의.
 * 내보낸 파일을 그대로 다시 가져오면 같은 데이터가 복원되어야 한다(왕복 호환).
 */
export type ImportKey =
  | 'name'
  | 'company'
  | 'department'
  | 'title'
  | 'email'
  | 'emails_extra'
  | 'phone'
  | 'mobile'
  | 'address'
  | 'website'
  | 'memo'
  | 'tags'

export interface ImportField {
  key: ImportKey
  label: string
  aliases: string[]
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: '이름', aliases: ['이름', '성명', 'name', '담당자'] },
  { key: 'company', label: '회사', aliases: ['회사', '회사명', 'company', '거래처', '업체'] },
  { key: 'department', label: '부서', aliases: ['부서', 'department', '팀'] },
  { key: 'title', label: '직함', aliases: ['직함', '직책', '직위', 'title'] },
  { key: 'email', label: '이메일', aliases: ['이메일', 'email', 'e-mail', '메일', 'mail'] },
  {
    key: 'emails_extra',
    label: '추가 이메일',
    aliases: ['추가이메일', '추가 이메일', '이메일2', 'email2', 'other email', '기타 이메일']
  },
  { key: 'phone', label: '전화', aliases: ['전화', 'phone', 'tel', '전화번호', '유선'] },
  {
    key: 'mobile',
    label: '휴대폰',
    aliases: ['휴대폰', '핸드폰', 'mobile', '휴대전화', '모바일', 'hp']
  },
  { key: 'address', label: '주소', aliases: ['주소', 'address'] },
  { key: 'website', label: '웹사이트', aliases: ['웹사이트', 'website', 'url', '홈페이지'] },
  { key: 'memo', label: '메모', aliases: ['메모', '비고', 'memo', 'note', '노트'] },
  { key: 'tags', label: '태그', aliases: ['태그', 'tag', '분류', '그룹', '라벨', 'label'] }
]

/** 내보내기 헤더 = 가져오기 필드 라벨 (같은 순서) */
export const EXPORT_HEADERS: string[] = IMPORT_FIELDS.map((f) => f.label)

/** 여러 값이 든 셀 "전시회, VIP / 협력사" → ['전시회', 'VIP', '협력사'] */
export function splitList(cell: string): string[] {
  return [
    ...new Set(
      cell
        .split(/[,;/|\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ]
}

const norm = (s: string): string => s.toLowerCase().replace(/\s/g, '')

/**
 * 헤더명으로 필드 자동 매핑. 정확히 일치하는 열을 먼저 배정하고,
 * 남은 열을 포함 검색으로 배정한다 — "추가 이메일"이 "이메일"에 먹히지 않게.
 */
export function guessMapping(headers: string[]): Record<ImportKey, number> {
  const mapping = {} as Record<ImportKey, number>
  const used = new Set<number>()
  const normalized = headers.map(norm)
  for (const field of IMPORT_FIELDS) mapping[field.key] = -1

  for (const field of IMPORT_FIELDS) {
    const aliases = field.aliases.map(norm)
    const i = normalized.findIndex((h, idx) => !used.has(idx) && aliases.includes(h))
    if (i >= 0) {
      mapping[field.key] = i
      used.add(i)
    }
  }
  for (const field of IMPORT_FIELDS) {
    if (mapping[field.key] >= 0) continue
    const aliases = field.aliases.map(norm)
    const i = normalized.findIndex((h, idx) => !used.has(idx) && aliases.some((a) => h.includes(a)))
    if (i >= 0) {
      mapping[field.key] = i
      used.add(i)
    }
  }
  return mapping
}

/** 한 행을 PersonInput으로. extraTags는 모든 행에 공통으로 붙는 태그 */
export function rowToPersonInput(
  row: string[],
  mapping: Record<ImportKey, number>,
  extraTags: string[] = []
): PersonInput {
  const cell = (key: ImportKey): string => {
    const col = mapping[key]
    return col >= 0 ? (row[col] ?? '').trim() : ''
  }
  const emails = [
    ...new Set(
      [...splitList(cell('email')), ...splitList(cell('emails_extra'))].map((e) => e.toLowerCase())
    )
  ]
  return {
    name: cell('name'),
    company: cell('company'),
    department: cell('department'),
    title: cell('title'),
    emails,
    phone: cell('phone'),
    mobile: cell('mobile'),
    address: cell('address'),
    website: cell('website'),
    memo: cell('memo'),
    tags: [...new Set([...splitList(cell('tags')), ...extraTags])]
  }
}

/** 사람 1명 → 내보내기 행 (EXPORT_HEADERS 순서) */
export function personToRow(p: Person): string[] {
  const primary = p.email
  const extra = p.emails.map((e) => e.address).filter((a) => a !== primary)
  const byKey: Record<ImportKey, string> = {
    name: p.name,
    company: p.company,
    department: p.department,
    title: p.title,
    email: primary,
    emails_extra: extra.join('; '),
    phone: p.phone,
    mobile: p.mobile,
    address: p.address,
    website: p.website,
    memo: p.memo,
    tags: p.tags.join('; ')
  }
  return IMPORT_FIELDS.map((f) => byKey[f.key])
}
