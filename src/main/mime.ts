import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { TemplateAttachment } from '../shared/types'

/** RFC 5322 메시지 소스 생성 — .eml 초안, Gmail raw, IMAP APPEND가 공유 */
export interface MimeInput {
  from?: string
  to: string
  cc: string[]
  bcc: string[]
  subject: string
  /** 완전한 HTML 문서 (<html>…</html>) */
  html: string
  attachments: TemplateAttachment[]
  /** 추가 헤더 (예: X-Unsent: 1) */
  extraHeaders?: string[]
  /** 줄바꿈. 신형 Outlook .eml은 LF, 그 외는 CRLF */
  lineEnding?: '\n' | '\r\n'
}

const b64 = (s: string | Buffer): string =>
  (typeof s === 'string' ? Buffer.from(s, 'utf8') : s).toString('base64')
/** MIME 본문용 76자 줄바꿈 base64 */
const b64Lines = (buf: Buffer, eol: string): string =>
  buf.toString('base64').replace(/(.{76})/g, `$1${eol}`)
/** 헤더에 한글 등이 들어갈 때 쓰는 RFC 2047 인코딩 */
export const encodedWord = (s: string): string => `=?UTF-8?B?${b64(s)}?=`

export async function buildMime(input: MimeInput): Promise<string> {
  const eol = input.lineEnding ?? '\r\n'
  const headers: string[] = []
  if (input.from) headers.push(`From: ${input.from}`)
  headers.push(`To: ${input.to}`)
  if (input.cc.length) headers.push(`Cc: ${input.cc.join(', ')}`)
  if (input.bcc.length) headers.push(`Bcc: ${input.bcc.join(', ')}`)
  headers.push(
    `Subject: ${encodedWord(input.subject)}`,
    ...(input.extraHeaders ?? []),
    `Message-ID: <${randomUUID()}@whenmail.local>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0'
  )

  const htmlPart = b64Lines(Buffer.from(input.html, 'utf8'), eol)
  let body: string[]
  if (input.attachments.length === 0) {
    body = [
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      htmlPart,
      ''
    ]
  } else {
    const boundary = `----=_whenmail_${randomUUID().replace(/-/g, '')}`
    body = [
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      htmlPart,
      ''
    ]
    for (const a of input.attachments) {
      const data = await fs.readFile(a.path)
      // 파일명에 한글이 있을 수 있어 RFC 2047 인코딩 + RFC 2231 filename* 둘 다 제공
      const nameWord = encodedWord(a.name)
      const nameStar = `UTF-8''${encodeURIComponent(a.name)}`
      body.push(
        `--${boundary}`,
        `Content-Type: application/octet-stream; name="${nameWord}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${nameWord}"; filename*=${nameStar}`,
        '',
        b64Lines(data, eol),
        ''
      )
    }
    body.push(`--${boundary}--`, '')
  }

  return [...headers, ...body].join(eol)
}
