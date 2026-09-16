import type { Person, RenderWarning } from './types'

/** 템플릿 치환에 쓰이는 사람 필드 — email은 이번에 보낼 주소로 바꿔 넘길 수 있다 */
export type TemplateData = Pick<
  Person,
  | 'name'
  | 'company'
  | 'department'
  | 'title'
  | 'email'
  | 'phone'
  | 'mobile'
  | 'address'
  | 'website'
  | 'memo'
>

/** 템플릿 변수명(한글) → 사람 필드 매핑 */
export const TEMPLATE_VARIABLES: Record<string, keyof TemplateData | '__date__'> = {
  이름: 'name',
  회사: 'company',
  부서: 'department',
  직함: 'title',
  이메일: 'email',
  전화: 'phone',
  휴대폰: 'mobile',
  주소: 'address',
  웹사이트: 'website',
  메모: 'memo',
  보내는날짜: '__date__'
}

const VAR_PATTERN = /\{\{\s*([^{}|\s]+)\s*(?:\|([^{}]*))?\}\}/g

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

export interface RenderResult {
  text: string
  warnings: RenderWarning[]
}

/**
 * `{{변수}}` / `{{변수|기본값}}` 치환.
 * - 값이 비면 기본값 사용(경고 수집), 기본값도 없으면 원문 유지 + 경고
 * - 알 수 없는 변수는 치환하지 않고 경고
 */
export function renderTemplate(tpl: string, person: TemplateData): RenderResult {
  const warnings: RenderWarning[] = []
  const text = tpl.replace(VAR_PATTERN, (raw, name: string, fallback?: string) => {
    const field = TEMPLATE_VARIABLES[name]
    if (field === undefined) {
      warnings.push({ variable: name, usedDefault: null })
      return raw
    }
    const value = field === '__date__' ? todayString() : String(person[field] ?? '').trim()
    if (value) return value
    if (fallback !== undefined && fallback !== '') {
      warnings.push({ variable: name, usedDefault: fallback })
      return fallback
    }
    warnings.push({ variable: name, usedDefault: null })
    return raw
  })
  return { text, warnings }
}

/** 본문이 리치 텍스트(HTML)로 저장되었는지 판별 */
export function isHtmlBody(body: string): boolean {
  return /<[a-z][^>]*>/i.test(body)
}

/** HTML 본문을 mailto 폴백용 플레인 텍스트로 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const BODY_STYLE = `font-family:'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.6;`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 본문을 Outlook용 HTML 조각(<div>)으로 — 리치 텍스트는 그대로, 플레인 텍스트는 문단으로.
 * 서명이 있으면 본문 아래에 구분 여백을 두고 붙인다.
 * COM 어댑터는 이 조각을 Outlook이 만든 <body> 안(기본 서명 위)에 끼워 넣는다.
 */
export function bodyToHtmlFragment(body: string, signatureHtml = ''): string {
  const content = isHtmlBody(body)
    ? body
    : escapeHtml(body)
        .split(/\r?\n/)
        .map((line) => (line.trim() === '' ? '<p>&nbsp;</p>' : `<p>${line}</p>`))
        .join('\n')
  const signature = signatureHtml.trim()
    ? `<p>&nbsp;</p><div class="whenmail-signature">${signatureHtml}</div>`
    : ''
  return `<div style="${BODY_STYLE}">${content}${signature}</div>`
}

/** 본문(+서명)을 완전한 HTML 문서로 — .eml 어댑터용 */
export function bodyToHtml(body: string, signatureHtml = ''): string {
  return `<html><body style="${BODY_STYLE}">${bodyToHtmlFragment(body, signatureHtml)}</body></html>`
}
