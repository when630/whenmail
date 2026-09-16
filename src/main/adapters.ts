import { shell } from 'electron'
import fs from 'node:fs/promises'
import { ImapFlow } from 'imapflow'
import type { Account, DraftAdapterKind, TemplateAttachment } from '../shared/types'
import { effectiveOutlookMode, openDraft } from './outlook'
import { buildMime } from './mime'
import { getAccessToken, type OAuthClientConfig } from './oauth'
import { getSecret, secretKeys } from './credentials'

/** 어댑터에 넘기는 초안 내용 — 계정 종류와 무관 */
export interface DraftMessage {
  to: string
  cc: string[]
  bcc: string[]
  subject: string
  /** 본문(+서명) HTML 조각 */
  bodyFragment: string
  /** 순수 텍스트 (mailto 폴백) */
  text: string
  /** 클래식 Outlook 기본 서명을 살릴지 (앱 서명이 없을 때) */
  preserveOutlookSignature: boolean
  /** 존재 확인된 첨부 */
  attachments: TemplateAttachment[]
}

export interface AdapterContext {
  oauthClient: (kind: 'm365' | 'gmail') => OAuthClientConfig
}

/** Graph 첨부 1건 크기 상한 (base64 팽창 고려, 문서상 3MB) */
const GRAPH_ATTACHMENT_LIMIT = 3 * 1024 * 1024

/** 계정 종류에 따라 초안을 만들고, 실제 사용된 어댑터를 돌려준다 */
export async function createDraftForAccount(
  account: Account,
  message: DraftMessage,
  ctx: AdapterContext
): Promise<DraftAdapterKind> {
  switch (account.kind) {
    case 'outlook_local': {
      const mode = await effectiveOutlookMode(account.config.outlookMode ?? 'auto')
      return openDraft(
        {
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.subject,
          bodyFragment: message.bodyFragment,
          text: message.text,
          preserveOutlookSignature: message.preserveOutlookSignature,
          attachments: message.attachments
        },
        mode
      )
    }
    case 'm365':
      await createGraphDraft(account, message, ctx.oauthClient('m365'))
      return 'graph'
    case 'gmail':
      await createGmailDraft(account, message, ctx.oauthClient('gmail'))
      return 'gmail'
    case 'imap':
      await appendImapDraft(account, message)
      return 'imap'
  }
}

/** 어댑터 공통 — 본문 조각(<div style=…>)을 완전한 HTML 문서로 */
const fullHtml = (m: DraftMessage): string => `<html><body>${m.bodyFragment}</body></html>`

const recipients = (list: string[]): { emailAddress: { address: string } }[] =>
  list.map((address) => ({ emailAddress: { address } }))

async function graphFetch(
  token: string,
  url: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body.slice(0, 300)
    try {
      const j = JSON.parse(body) as { error?: { message?: string; code?: string } }
      if (j.error?.message) detail = `${j.error.code ?? ''} ${j.error.message}`.trim()
    } catch {
      /* 본문이 JSON이 아니면 그대로 */
    }
    throw new Error(`Microsoft Graph 오류 ${res.status}: ${detail}`)
  }
  if (res.status === 204) return {}
  return (await res.json()) as Record<string, unknown>
}

/** Microsoft 365: 초안 생성 → 첨부 추가 → webLink 열기 */
async function createGraphDraft(
  account: Account,
  m: DraftMessage,
  client: OAuthClientConfig
): Promise<void> {
  for (const a of m.attachments) {
    const size = (await fs.stat(a.path)).size
    if (size > GRAPH_ATTACHMENT_LIMIT) {
      throw new Error(
        `'${a.name}'(${(size / 1024 / 1024).toFixed(1)}MB)은 Microsoft 365 초안에 붙일 수 있는 한도(3MB)를 넘습니다`
      )
    }
  }
  const token = await getAccessToken('m365', client, account.id)
  const created = await graphFetch(token, 'https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    body: JSON.stringify({
      subject: m.subject,
      body: { contentType: 'HTML', content: fullHtml(m) },
      toRecipients: recipients([m.to]),
      ccRecipients: recipients(m.cc),
      bccRecipients: recipients(m.bcc)
    })
  })
  const id = String(created.id ?? '')
  if (!id) throw new Error('Microsoft Graph가 초안 id를 돌려주지 않았습니다')

  for (const a of m.attachments) {
    const bytes = await fs.readFile(a.path)
    await graphFetch(token, `https://graph.microsoft.com/v1.0/me/messages/${id}/attachments`, {
      method: 'POST',
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentBytes: bytes.toString('base64')
      })
    })
  }

  const webLink = typeof created.webLink === 'string' ? created.webLink : ''
  // webLink는 팝업 읽기 창을 가리키므로 ispopout=0 으로 편집 화면을 유도한다
  const url = webLink
    ? webLink.replace(/([?&])ispopout=1/, '$1ispopout=0')
    : 'https://outlook.office.com/mail/drafts'
  await shell.openExternal(url)
}

/** Gmail: MIME → drafts.create → 웹 초안 목록 열기 */
async function createGmailDraft(
  account: Account,
  m: DraftMessage,
  client: OAuthClientConfig
): Promise<void> {
  const token = await getAccessToken('gmail', client, account.id)
  const raw = await buildMime({
    from: account.address,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    html: fullHtml(m),
    attachments: m.attachments
  })
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        raw: Buffer.from(raw, 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      }
    })
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body.slice(0, 300)
    try {
      const j = JSON.parse(body) as { error?: { message?: string } }
      if (j.error?.message) detail = j.error.message
    } catch {
      /* 그대로 */
    }
    throw new Error(`Gmail API 오류 ${res.status}: ${detail}`)
  }
  const authuser = account.address ? `?authuser=${encodeURIComponent(account.address)}` : ''
  await shell.openExternal(`https://mail.google.com/mail/u/0/${authuser}#drafts`)
}

/** IMAP 접속 설정 (비밀번호는 credentials에서) */
export function imapOptions(
  account: Pick<Account, 'id' | 'address' | 'config'>,
  password?: string
): ConstructorParameters<typeof ImapFlow>[0] {
  const host = account.config.imapHost?.trim()
  if (!host) throw new Error('IMAP 서버 주소가 없습니다')
  const pass = password ?? getSecret(secretKeys.imap(account.id)) ?? ''
  if (!pass)
    throw new Error('IMAP 비밀번호가 저장되어 있지 않습니다. 설정 > 계정에서 다시 입력하세요')
  const secure = account.config.imapSecure !== false
  return {
    host,
    port: account.config.imapPort || (secure ? 993 : 143),
    secure,
    auth: { user: account.config.imapUser?.trim() || account.address, pass },
    logger: false,
    connectionTimeout: 15000
  }
}

/** 초안 폴더 경로 — 설정값 우선, 없으면 \Drafts special-use, 그다음 이름으로 추정 */
export async function findDraftsPath(client: ImapFlow, preferred?: string): Promise<string> {
  if (preferred?.trim()) return preferred.trim()
  const boxes = await client.list()
  const special = boxes.find((b) => b.specialUse === '\\Drafts')
  if (special) return special.path
  const byName = boxes.find((b) => /^(drafts|draft|임시보관함|임시 보관함)$/i.test(b.name))
  if (byName) return byName.path
  throw new Error('초안 폴더를 찾지 못했습니다. 계정 설정에서 초안 폴더 이름을 직접 입력하세요')
}

async function appendImapDraft(account: Account, m: DraftMessage): Promise<void> {
  const client = new ImapFlow(imapOptions(account))
  await client.connect()
  try {
    const draftsPath = await findDraftsPath(client, account.config.imapDraftsPath)
    const source = await buildMime({
      from: account.address,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject,
      html: fullHtml(m),
      attachments: m.attachments
    })
    const result = await client.append(draftsPath, source, ['\\Draft'])
    if (!result) throw new Error('IMAP 서버가 초안 저장을 거부했습니다')
  } finally {
    await client.logout().catch(() => undefined)
  }
}

/** IMAP 접속 확인 + 초안 폴더 탐지 (계정 저장 전 테스트용) */
export async function testImapConnection(
  account: Pick<Account, 'id' | 'address' | 'config'>,
  password?: string
): Promise<{ draftsPath: string }> {
  const client = new ImapFlow(imapOptions(account, password))
  await client.connect()
  try {
    return { draftsPath: await findDraftsPath(client, account.config.imapDraftsPath) }
  } finally {
    await client.logout().catch(() => undefined)
  }
}
