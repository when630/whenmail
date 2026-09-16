import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { OutlookAdapter, OutlookModePref, TemplateAttachment } from '../shared/types'

const execFileAsync = promisify(execFile)

export interface DraftPayload {
  to: string
  /** 참조 주소 목록 (비어 있으면 생략) */
  cc: string[]
  /** 숨은 참조 주소 목록 (비어 있으면 생략) */
  bcc: string[]
  subject: string
  /** 본문(+앱 서명) HTML 조각 — <div>…</div>. <html>/<body>는 어댑터가 감싼다 */
  bodyFragment: string
  /** mailto 폴백용 플레인 텍스트 본문 */
  text: string
  /**
   * true면 클래식 Outlook이 자동 삽입하는 기본 서명을 살려 본문 아래에 둔다.
   * 앱 자체 서명을 쓰는 경우 false로 두어 서명이 두 번 들어가지 않게 한다.
   */
  preserveOutlookSignature: boolean
  /** 템플릿 첨부 파일 (존재 확인된 것만). mailto는 지원하지 않아 무시된다 */
  attachments: TemplateAttachment[]
}

let detectedMode: OutlookAdapter | null = null

/**
 * 클래식 Outlook(COM ProgID 등록) 존재 여부로 어댑터를 정한다.
 * 신형 Outlook은 COM을 지원하지 않으므로 .eml(X-Unsent) 방식으로 폴백.
 */
export async function detectOutlookMode(): Promise<OutlookAdapter> {
  if (detectedMode) return detectedMode
  try {
    await execFileAsync('reg', ['query', 'HKEY_CLASSES_ROOT\\Outlook.Application', '/ve'], {
      windowsHide: true
    })
    detectedMode = 'com'
  } catch {
    detectedMode = 'eml'
  }
  return detectedMode
}

/** 설정값(auto/com/eml)을 실제 사용할 어댑터로 — auto는 감지 결과를 따른다 */
export async function effectiveOutlookMode(pref: OutlookModePref): Promise<OutlookAdapter> {
  if (pref === 'com' || pref === 'eml') return pref
  return detectOutlookMode()
}

/** 지정 어댑터부터 폴백 체인 순서로 시도하고, 실제 사용된 어댑터를 반환 */
export async function openDraft(
  payload: DraftPayload,
  mode: OutlookAdapter
): Promise<OutlookAdapter> {
  const chain: OutlookAdapter[] = mode === 'com' ? ['com', 'eml', 'mailto'] : ['eml', 'mailto']
  let lastError: unknown
  for (const adapter of chain) {
    try {
      if (adapter === 'com') await openViaCom(payload)
      else if (adapter === 'eml') await openViaEml(payload)
      else await openViaMailto(payload)
      return adapter
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Outlook 초안 열기에 실패했습니다')
}

const wrapHtml = (fragment: string): string => `<html><body>${fragment}</body></html>`
const b64 = (s: string | Buffer): string =>
  (typeof s === 'string' ? Buffer.from(s, 'utf8') : s).toString('base64')
/** MIME 본문용 76자 줄바꿈 base64 */
const b64Lines = (buf: Buffer): string => buf.toString('base64').replace(/(.{76})/g, '$1\n')
/** 헤더에 한글 등이 들어갈 때 쓰는 RFC 2047 인코딩 */
const encodedWord = (s: string): string => `=?UTF-8?B?${b64(s)}?=`

/**
 * 클래식 Outlook COM: MailItem.Display().
 * 값은 PS 스크립트에 base64로 실어 인코딩/이스케이프 문제를 차단하고,
 * 스크립트 전체도 -EncodedCommand(UTF-16LE base64)로 전달한다.
 *
 * 기본 서명 보존: HTMLBody를 먼저 덮어쓰면 Outlook 기본 서명이 사라진다.
 * GetInspector로 서명이 삽입된 HTMLBody를 먼저 받아, 그 <body> 시작 직후에
 * 본문 조각을 끼워 넣으면 서명이 본문 아래에 남는다.
 */
async function openViaCom(p: DraftPayload): Promise<void> {
  const attachLines = p.attachments
    .map((a) => `$null = $mail.Attachments.Add((FromB64 '${b64(a.path)}'))`)
    .join('\n')
  const script = `
$ErrorActionPreference = 'Stop'
function FromB64([string]$s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
$ol = New-Object -ComObject Outlook.Application
$mail = $ol.CreateItem(0)
$mail.To = FromB64 '${b64(p.to)}'
${p.cc.length ? `$mail.CC = FromB64 '${b64(p.cc.join('; '))}'` : ''}
${p.bcc.length ? `$mail.BCC = FromB64 '${b64(p.bcc.join('; '))}'` : ''}
$mail.Subject = FromB64 '${b64(p.subject)}'
$fragment = FromB64 '${b64(p.bodyFragment)}'
$keepSignature = $${p.preserveOutlookSignature ? 'true' : 'false'}
$done = $false
if ($keepSignature) {
  $null = $mail.GetInspector
  $existing = [string]$mail.HTMLBody
  if ($existing) {
    $m = [regex]::Match($existing, '<body[^>]*>', 'IgnoreCase')
    if ($m.Success) {
      $at = $m.Index + $m.Length
      $mail.HTMLBody = $existing.Substring(0, $at) + $fragment + $existing.Substring($at)
      $done = $true
    }
  }
}
if (-not $done) { $mail.HTMLBody = '<html><body>' + $fragment + '</body></html>' }
${attachLines}
$mail.Display()
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await execFileAsync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 30000
  })
}

/**
 * .eml + "X-Unsent: 1" 파일을 생성해 기본 메일 앱(신형 Outlook)으로 연다.
 * 신형 Outlook 호환성을 위해 LF 라인엔딩 + Message-ID를 부여한다.
 * 첨부가 있으면 multipart/mixed로 구성한다. (신형 Outlook은 X-Unsent 초안에서
 * 첨부를 놓치는 버그가 보고되어 있어, 첨부가 중요하면 클래식 Outlook을 권장)
 * 신형 Outlook은 자체 서명 삽입 위치를 .eml 쪽에서 제어할 수 없으므로,
 * 서명은 앱 설정의 서명(bodyFragment에 포함)으로 넣는 것을 권장한다.
 */
async function openViaEml(p: DraftPayload): Promise<void> {
  const headers = [`To: ${p.to}`]
  if (p.cc.length) headers.push(`Cc: ${p.cc.join(', ')}`)
  if (p.bcc.length) headers.push(`Bcc: ${p.bcc.join(', ')}`)
  headers.push(
    `Subject: ${encodedWord(p.subject)}`,
    'X-Unsent: 1',
    `Message-ID: <${randomUUID()}@whenmail.local>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0'
  )

  const htmlPart = b64Lines(Buffer.from(wrapHtml(p.bodyFragment), 'utf8'))
  let body: string[]
  if (p.attachments.length === 0) {
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
    for (const a of p.attachments) {
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
        b64Lines(data),
        ''
      )
    }
    body.push(`--${boundary}--`, '')
  }

  const eml = [...headers, ...body].join('\n')

  const dir = path.join(app.getPath('temp'), 'whenmail')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `draft-${Date.now()}-${randomUUID().slice(0, 8)}.eml`)
  await fs.writeFile(file, eml, 'utf8')
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
}

async function openViaMailto(p: DraftPayload): Promise<void> {
  const params = new URLSearchParams()
  if (p.cc.length) params.set('cc', p.cc.join(','))
  if (p.bcc.length) params.set('bcc', p.bcc.join(','))
  params.set('subject', p.subject)
  params.set('body', p.text)
  // URLSearchParams는 공백을 +로 바꾸므로 mailto 규격에 맞게 %20으로 되돌린다
  const query = params.toString().replace(/\+/g, '%20')
  await shell.openExternal(`mailto:${encodeURIComponent(p.to)}?${query}`)
}
