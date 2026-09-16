import type { PersonInput } from './types'

export interface OcrLine {
  text: string
  /** 라인 bbox 높이(px) — 이름 추정에 사용, 없으면 무시 */
  height?: number
}

const TITLES = [
  '대표이사',
  '부사장',
  '사장',
  '전무',
  '상무',
  '이사',
  '본부장',
  '실장',
  '팀장',
  '부장',
  '차장',
  '과장',
  '대리',
  '주임',
  '사원',
  '선임',
  '책임',
  '수석',
  '매니저',
  '연구원',
  '프로',
  '대표',
  'CEO',
  'CTO',
  'COO',
  'CFO',
  'Director',
  'Manager'
]

const COMPANY_HINTS = [
  '(주)',
  '（주）',
  '주식회사',
  '(유)',
  'Co., Ltd',
  'Co.,Ltd',
  'Inc',
  'Corp',
  'Ltd',
  '컴퍼니',
  '그룹',
  '상사',
  '물산',
  '테크',
  '소프트',
  '시스템',
  '솔루션'
]

const DEPT_HINTS = ['팀', '부문', '사업부', '본부', '연구소', '개발실', '지원실', 'Lab']

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|[\w-]+\.(?:com|net|io|co\.kr|kr|ai)(?:\/[^\s]*)?/i
const MOBILE_RE = /(?:\+?82[-. ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}/
// 국제 표기(+82 10-…)는 앞자리 0이 생략되므로 +82 뒤에서는 0을 선택으로 둔다
const PHONE_RE = /(?:\+?82[-. ]?0?|0)\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}/
const HANGUL_NAME_RE = /^[가-힣]{2,4}$/
const ADDRESS_RE = /([가-힣]+(시|도)\s?[가-힣]+(구|군|시))|([가-힣\d]+(로|길)\s?\d)/

function normalizePhone(raw: string): string {
  let s = raw.replace(/[. ]/g, '-').replace(/-{2,}/g, '-')
  s = s.replace(/^\+?82-?/, '0').replace(/^00/, '0')
  return s
}

/** OCR 라인들에서 명함 필드를 추정한다. 확신 없는 필드는 빈 값으로 남긴다. */
export function parseCardLines(ocrLines: OcrLine[]): Partial<PersonInput> {
  const lines = ocrLines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0)

  const out: Partial<PersonInput> = {}
  const consumed = new Set<number>()

  for (const [i, line] of lines.entries()) {
    // 이메일
    if (!out.emails) {
      const m = line.text.match(EMAIL_RE)
      if (m) {
        out.emails = [m[0].toLowerCase()]
        consumed.add(i)
      }
    }
    // 전화/휴대폰 — 팩스 라벨이 붙은 번호는 제외
    const numbers = line.text.match(new RegExp(PHONE_RE.source, 'g')) ?? []
    for (const num of numbers) {
      const idx = line.text.indexOf(num)
      const label = line.text.slice(Math.max(0, idx - 6), idx).toLowerCase()
      if (/f[.:\s]|fax|팩스/.test(label)) continue
      const normalized = normalizePhone(num)
      if (MOBILE_RE.test(num)) {
        if (!out.mobile) out.mobile = normalized
      } else if (!out.phone) {
        out.phone = normalized
      }
    }
    if (numbers.length > 0) consumed.add(i)
  }

  for (const [i, line] of lines.entries()) {
    if (!out.website) {
      const m = line.text.match(URL_RE)
      if (m && !EMAIL_RE.test(line.text)) {
        out.website = m[0].replace(/[,;]$/, '')
        consumed.add(i)
      }
    }
    if (!out.address && ADDRESS_RE.test(line.text) && line.text.length >= 8) {
      out.address = line.text
      consumed.add(i)
    }
  }

  // 직함 — 직함 토큰이 포함된 라인. "홍길동 부장"이면 이름도 함께 추출
  for (const [i, line] of lines.entries()) {
    if (out.title) break
    for (const title of TITLES) {
      if (!line.text.includes(title)) continue
      out.title = title
      consumed.add(i)
      const rest = line.text
        .replace(title, '')
        .replace(/[|/·,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!out.name && HANGUL_NAME_RE.test(rest)) {
        out.name = rest
      } else if (rest && DEPT_HINTS.some((h) => rest.includes(h))) {
        // "영업본부 솔루션영업팀 / 차장" — 직함을 뺀 나머지가 부서
        out.department = rest
      }
      break
    }
  }

  // 회사 — 회사 힌트가 포함된 라인
  for (const [i, line] of lines.entries()) {
    if (out.company) break
    if (COMPANY_HINTS.some((h) => line.text.includes(h))) {
      out.company = line.text
      consumed.add(i)
    }
  }

  // 부서 — 부서 힌트로 끝나는 짧은 라인
  for (const [i, line] of lines.entries()) {
    if (out.department) break
    if (consumed.has(i) || line.text.length > 15) continue
    if (DEPT_HINTS.some((h) => line.text.endsWith(h) || line.text.includes(h + ' '))) {
      out.department = line.text
      consumed.add(i)
    }
  }

  // 이름 — 한글 2~4자 단독 라인. 후보가 여럿이면 글자 높이가 가장 큰 라인(명함에서 이름이 가장 큼)
  if (!out.name) {
    const candidates = lines
      .map((l, i) => ({ ...l, i }))
      .filter((l) => !consumed.has(l.i) && HANGUL_NAME_RE.test(l.text) && !TITLES.includes(l.text))
    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      out.name = candidates[0].text
    }
  }

  return out
}
