import { ImapFlow } from 'imapflow'
import type { Account, MailHeader } from '../shared/types'
import { getAccessToken, type OAuthClientConfig } from './oauth'
import { imapOptions } from './adapters'
import { canReadKind } from '../shared/accounts'

export { canReadKind }

/**
 * 읽기 어댑터 — 등록된 사람의 주소와 오간 메일의 **헤더만** 가져온다.
 * 본문·첨부는 절대 요청하지 않는다(Gmail은 format=metadata, Graph는 $select, IMAP은 ENVELOPE).
 */

export interface ReadContext {
  oauthClient: (kind: 'm365' | 'gmail') => OAuthClientConfig
}

/** 주소 하나당 가져올 최대 메일 수 */
const PER_ADDRESS_LIMIT = 25
/** 한 번도 동기화한 적 없을 때 거슬러 올라가는 기간 */
const FIRST_SYNC_DAYS = 180

/** SQLite에 넣기 좋은 'YYYY-MM-DD HH:mm:ss' 로컬 시각 */
export function toLocalStamp(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** 증분 조회 기준 시각 — 마지막 동기화에서 하루 물려 잡아 경계 누락을 막는다 */
export function sinceFor(lastSyncAt: string | null): Date {
  if (!lastSyncAt) return new Date(Date.now() - FIRST_SYNC_DAYS * 86400_000)
  const t = new Date(lastSyncAt.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return new Date(Date.now() - FIRST_SYNC_DAYS * 86400_000)
  return new Date(t - 86400_000)
}

const lower = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase()

/** 계정 종류별 읽기. 지원하지 않으면 빈 배열 */
export async function readHeaders(
  account: Account,
  addresses: string[],
  since: Date,
  ctx: ReadContext
): Promise<MailHeader[]> {
  const targets = [...new Set(addresses.map(lower).filter(Boolean))]
  if (targets.length === 0) return []
  switch (account.kind) {
    case 'm365':
      return readGraph(account, targets, since, ctx.oauthClient('m365'))
    case 'gmail':
      return readGmail(account, targets, since, ctx.oauthClient('gmail'))
    case 'imap':
      return readImap(account, targets, since)
    case 'outlook_local':
      return []
  }
}

/* ────────────────────────── Microsoft 365 (Graph) ────────────────────────── */

interface GraphMessage {
  id?: string
  conversationId?: string
  subject?: string
  receivedDateTime?: string
  sentDateTime?: string
  isDraft?: boolean
  webLink?: string
  from?: { emailAddress?: { address?: string } }
  sender?: { emailAddress?: { address?: string } }
}

async function graphGet(token: string, url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' }
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body.slice(0, 200)
    try {
      const j = JSON.parse(body) as { error?: { message?: string; code?: string } }
      if (j.error?.message) detail = `${j.error.code ?? ''} ${j.error.message}`.trim()
    } catch {
      /* 그대로 */
    }
    throw new Error(`Microsoft Graph 읽기 오류 ${res.status}: ${detail}`)
  }
  return (await res.json()) as Record<string, unknown>
}

/**
 * $search="participants:<주소>"는 from·to·cc·bcc를 한 번에 훑어 양방향을 모두 준다.
 * $search는 $filter·$orderby와 함께 쓸 수 없어 기간 제한은 받아온 뒤 걸러낸다.
 */
async function readGraph(
  account: Account,
  addresses: string[],
  since: Date,
  client: OAuthClientConfig
): Promise<MailHeader[]> {
  const token = await getAccessToken('m365', client, account.id)
  const me = lower(account.address)
  const out: MailHeader[] = []

  for (const addr of addresses) {
    const url =
      'https://graph.microsoft.com/v1.0/me/messages' +
      `?$search=${encodeURIComponent(`"participants:${addr}"`)}` +
      '&$select=id,conversationId,subject,receivedDateTime,sentDateTime,isDraft,webLink,from,sender' +
      `&$top=${PER_ADDRESS_LIMIT}`
    const json = await graphGet(token, url)
    const items = Array.isArray(json.value) ? (json.value as GraphMessage[]) : []
    for (const m of items) {
      if (!m.id || m.isDraft) continue
      const when = m.receivedDateTime || m.sentDateTime
      if (!when) continue
      const at = new Date(when)
      if (at < since) continue
      const fromAddr = lower(m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address)
      // 보낸 사람이 나면 발신, 상대면 수신. 둘 다 아니면 참조로 엮인 메일이라 방향을 상대 기준으로 본다
      const direction: MailHeader['direction'] =
        fromAddr && fromAddr === addr ? 'in' : me && fromAddr === me ? 'out' : 'in'
      out.push({
        messageId: m.id,
        threadId: m.conversationId ?? '',
        direction,
        counterpart: addr,
        subject: m.subject ?? '',
        occurredAt: toLocalStamp(at),
        openRef: m.webLink ?? ''
      })
    }
  }
  return out
}

/* ────────────────────────── Gmail ────────────────────────── */

interface GmailListItem {
  id?: string
}
interface GmailMessage {
  id?: string
  threadId?: string
  labelIds?: string[]
  internalDate?: string
  payload?: { headers?: { name?: string; value?: string }[] }
}

async function gmailGet(token: string, url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text()
    let detail = body.slice(0, 200)
    try {
      const j = JSON.parse(body) as { error?: { message?: string } }
      if (j.error?.message) detail = j.error.message
    } catch {
      /* 그대로 */
    }
    throw new Error(`Gmail 읽기 오류 ${res.status}: ${detail}`)
  }
  return (await res.json()) as Record<string, unknown>
}

/**
 * 목록은 q 검색으로 좁히고, 본문을 받지 않도록 format=metadata + 필요한 헤더만 요청한다.
 * (q 검색은 gmail.metadata 스코프에서 막혀 있어 읽기에는 gmail.readonly가 필요하다)
 */
async function readGmail(
  account: Account,
  addresses: string[],
  since: Date,
  client: OAuthClientConfig
): Promise<MailHeader[]> {
  const token = await getAccessToken('gmail', client, account.id)
  const afterSec = Math.floor(since.getTime() / 1000)
  const out: MailHeader[] = []

  for (const addr of addresses) {
    const q = `(from:${addr} OR to:${addr} OR cc:${addr}) after:${afterSec} -in:chats`
    const listUrl =
      'https://gmail.googleapis.com/gmail/v1/users/me/messages' +
      `?q=${encodeURIComponent(q)}&maxResults=${PER_ADDRESS_LIMIT}`
    const list = await gmailGet(token, listUrl)
    const items = Array.isArray(list.messages) ? (list.messages as GmailListItem[]) : []

    for (const item of items) {
      if (!item.id) continue
      const detailUrl =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}` +
        '?format=metadata&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=From'
      const m = (await gmailGet(token, detailUrl)) as GmailMessage
      const labels = m.labelIds ?? []
      if (labels.includes('DRAFT')) continue
      const headers = new Map((m.payload?.headers ?? []).map((h) => [lower(h.name), h.value ?? '']))
      const ts = Number(m.internalDate)
      const at = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(headers.get('date') ?? '')
      if (Number.isNaN(at.getTime()) || at < since) continue
      out.push({
        messageId: item.id,
        threadId: m.threadId ?? '',
        direction: labels.includes('SENT') ? 'out' : 'in',
        counterpart: addr,
        subject: headers.get('subject') ?? '',
        occurredAt: toLocalStamp(at),
        openRef: `https://mail.google.com/mail/u/0/#all/${item.id}`
      })
    }
  }
  return out
}

/* ────────────────────────── IMAP ────────────────────────── */

interface ImapFolders {
  inbox: string[]
  sent: string[]
}

/** 읽을 폴더 — 설정값이 있으면 그것만, 없으면 INBOX와 \Sent를 자동 탐지 */
async function resolveReadFolders(client: ImapFlow, account: Account): Promise<ImapFolders> {
  const configured = (account.config.imapReadPaths ?? []).filter(Boolean)
  if (configured.length > 0) return { inbox: configured, sent: [] }
  const boxes = await client.list()
  const sent = boxes.filter((b) => b.specialUse === '\\Sent').map((b) => b.path)
  if (sent.length === 0) {
    const guess = boxes.find((b) => /^(sent|sent items|보낸편지함|보낸 편지함)$/i.test(b.name))
    if (guess) sent.push(guess.path)
  }
  return { inbox: ['INBOX'], sent }
}

async function readImap(account: Account, addresses: string[], since: Date): Promise<MailHeader[]> {
  const client = new ImapFlow(imapOptions(account))
  await client.connect()
  const out: MailHeader[] = []
  try {
    const folders = await resolveReadFolders(client, account)
    const plan: { paths: string[]; direction: MailHeader['direction']; key: 'from' | 'to' }[] = [
      { paths: folders.inbox, direction: 'in', key: 'from' },
      { paths: folders.sent, direction: 'out', key: 'to' }
    ]

    for (const step of plan) {
      for (const path of step.paths) {
        const lock = await client.getMailboxLock(path, { readOnly: true }).catch(() => null)
        if (!lock) continue
        try {
          for (const addr of addresses) {
            const criteria = step.key === 'from' ? { from: addr, since } : { to: addr, since }
            const uids = await client.search(criteria, { uid: true })
            if (!uids || uids.length === 0) continue
            const recent = uids.slice(-PER_ADDRESS_LIMIT)
            for await (const msg of client.fetch(
              recent.join(','),
              { envelope: true, uid: true },
              { uid: true }
            )) {
              const env = msg.envelope
              const at = env?.date ? new Date(env.date) : null
              if (!at || Number.isNaN(at.getTime()) || at < since) continue
              out.push({
                // 서버 간 이동에도 안정적인 RFC Message-ID를 우선 쓰고, 없으면 폴더+UID
                messageId: env?.messageId || `${path}:${msg.uid}`,
                threadId: '',
                direction: step.direction,
                counterpart: addr,
                subject: env?.subject ?? '',
                occurredAt: toLocalStamp(at),
                openRef: ''
              })
            }
          }
        } finally {
          lock.release()
        }
      }
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
  return out
}
