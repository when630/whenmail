import { shell } from 'electron'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { AccountKind, OAuthResult } from '../shared/types'
import { getSecret, secretKeys, setSecret } from './credentials'

/**
 * 데스크톱 공개 클라이언트용 OAuth 2.0 — 인가 코드 + PKCE + 루프백 리디렉션.
 * 클라이언트 시크릿을 앱에 넣지 않는다(Google '데스크톱 앱' 유형은 시크릿을 요구하므로 설정에서 받는다).
 * 토큰은 계정별로 credentials 저장소에 두고, 만료되면 리프레시 토큰으로 갱신한다.
 */

export type OAuthKind = Extract<AccountKind, 'm365' | 'gmail'>

interface Provider {
  authorizeUrl: string
  tokenUrl: string
  /** 초안 생성에 필요한 기본 스코프 */
  scopes: string[]
  /** 읽기 동기화에 추가로 필요한 스코프 */
  readScopes: string[]
  /** 인가 요청에 덧붙일 파라미터 */
  extraAuthParams: Record<string, string>
  profile: (accessToken: string) => Promise<Omit<OAuthResult, 'canRead'>>
}

const PROVIDERS: Record<OAuthKind, Provider> = {
  m365: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.ReadWrite'],
    // Mail.ReadWrite가 읽기까지 포함하므로 추가 스코프가 없다
    readScopes: [],
    extraAuthParams: { prompt: 'select_account' },
    profile: async (token) => {
      const me = (await getJson('https://graph.microsoft.com/v1.0/me', token)) as {
        mail?: string
        userPrincipalName?: string
        displayName?: string
      }
      return {
        address: (me.mail || me.userPrincipalName || '').toLowerCase(),
        displayName: me.displayName || ''
      }
    }
  },
  gmail: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.compose'],
    // 목록 검색(q)이 gmail.metadata에서 막혀 있어 읽기에는 readonly가 필요하다.
    // 실제 조회는 format=metadata로만 해서 본문은 받아오지 않는다
    readScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    profile: async (token) => {
      const info = (await getJson('https://openidconnect.googleapis.com/v1/userinfo', token)) as {
        email?: string
        name?: string
      }
      return { address: (info.email || '').toLowerCase(), displayName: info.name || '' }
    }
  }
}

export interface OAuthClientConfig {
  clientId: string
  /** Google 데스크톱 앱 클라이언트에만 필요 */
  clientSecret?: string
}

/** 해당 종류가 읽기 동기화를 위해 받아야 하는 스코프를 이미 갖고 있는지 */
export function scopeHasRead(kind: OAuthKind, scope: string | undefined): boolean {
  const needed = PROVIDERS[kind].readScopes
  if (needed.length === 0) return true
  const granted = (scope ?? '').split(/\s+/).filter(Boolean)
  return needed.every((s) => granted.includes(s))
}

/** 저장된 토큰이 읽기 권한을 갖고 있는지 */
export function tokenCanRead(kind: OAuthKind, accountId: number): boolean {
  const raw = getSecret(secretKeys.oauth(accountId))
  if (!raw) return false
  try {
    return scopeHasRead(kind, (JSON.parse(raw) as StoredToken).scope)
  } catch {
    return false
  }
}

interface StoredToken {
  refresh_token: string
  access_token: string
  /** epoch ms */
  expires_at: number
  scope?: string
}

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${url} 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function postForm(
  url: string,
  form: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const desc = String(json.error_description ?? json.error ?? res.status)
    throw new Error(`토큰 요청 실패: ${desc}`)
  }
  return json
}

/** 브라우저에서 인가 코드를 받아오는 루프백 서버. 한 번만 응답하고 닫힌다 */
function waitForCode(
  expectedState: string,
  timeoutMs: number
): Promise<{ server: http.Server; port: number; code: Promise<string> }> {
  return new Promise((resolveSetup, rejectSetup) => {
    let resolveCode: (code: string) => void = () => undefined
    let rejectCode: (e: Error) => void = () => undefined
    const code = new Promise<string>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const state = url.searchParams.get('state')
      const c = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (err || !c || state !== expectedState) {
        res.end(
          page(
            '연결에 실패했습니다',
            `${err ?? 'state 불일치'} — whenmail로 돌아가 다시 시도하세요.`
          )
        )
        rejectCode(
          new Error(url.searchParams.get('error_description') || err || '인가 코드가 없습니다')
        )
      } else {
        res.end(page('연결되었습니다', '이 창을 닫고 whenmail로 돌아가세요.'))
        resolveCode(c)
      }
      setTimeout(() => server.close(), 200)
    })
    server.on('error', rejectSetup)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const timer = setTimeout(() => {
        rejectCode(new Error('브라우저 인증이 제한 시간 안에 끝나지 않았습니다'))
        server.close()
      }, timeoutMs)
      // finally 체인의 파생 프로미스까지 처리해 두지 않으면 거부 시 unhandledRejection이 된다
      code.finally(() => clearTimeout(timer)).catch(() => undefined)
      resolveSetup({ server, port, code })
    })
  })
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>whenmail</title>
<body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f5f7">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#475467">${body}</p></div></body>`
}

/**
 * 브라우저를 열어 사용자 인증을 받고, 토큰을 accountId 키로 저장한 뒤 프로필(주소·이름)을 돌려준다.
 * accountId가 없으면(새 계정) pendingKey를 만들어 그 키로 저장한다 — 계정 저장 시 옮겨 붙인다.
 */
export async function connectOAuth(
  kind: OAuthKind,
  client: OAuthClientConfig,
  storageKey: string,
  withRead = false
): Promise<OAuthResult> {
  if (!client.clientId.trim()) {
    throw new Error(
      kind === 'm365'
        ? 'Microsoft 365 연결에는 Azure 앱(클라이언트) ID가 필요합니다. 설정 > 연동 앱에서 입력하세요'
        : 'Gmail 연결에는 Google OAuth 클라이언트 ID가 필요합니다. 설정 > 연동 앱에서 입력하세요'
    )
  }
  const provider = PROVIDERS[kind]
  const scopes = withRead ? [...provider.scopes, ...provider.readScopes] : provider.scopes
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const { port, code } = await waitForCode(state, 3 * 60 * 1000)
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const params = new URLSearchParams({
    client_id: client.clientId.trim(),
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams
  })
  await shell.openExternal(`${provider.authorizeUrl}?${params.toString()}`)

  const authCode = await code
  const form: Record<string, string> = {
    client_id: client.clientId.trim(),
    grant_type: 'authorization_code',
    code: authCode,
    redirect_uri: redirectUri,
    code_verifier: verifier
  }
  if (client.clientSecret?.trim()) form.client_secret = client.clientSecret.trim()
  const token = await postForm(provider.tokenUrl, form)
  const stored: StoredToken = {
    refresh_token: String(token.refresh_token ?? ''),
    access_token: String(token.access_token ?? ''),
    expires_at: Date.now() + Number(token.expires_in ?? 3600) * 1000 - 60_000,
    scope: typeof token.scope === 'string' ? token.scope : undefined
  }
  if (!stored.refresh_token) {
    throw new Error('리프레시 토큰을 받지 못했습니다. 앱 등록의 리디렉션/권한 설정을 확인하세요')
  }
  setSecret(storageKey, JSON.stringify(stored))
  const profile = await provider.profile(stored.access_token)
  return { ...profile, canRead: scopeHasRead(kind, stored.scope ?? scopes.join(' ')) }
}

/** 저장된 토큰으로 액세스 토큰을 얻는다. 만료됐으면 갱신해 다시 저장 */
export async function getAccessToken(
  kind: OAuthKind,
  client: OAuthClientConfig,
  accountId: number
): Promise<string> {
  const key = secretKeys.oauth(accountId)
  const raw = getSecret(key)
  if (!raw) throw new Error('계정이 연결되어 있지 않습니다. 설정 > 계정에서 다시 연결하세요')
  const stored = JSON.parse(raw) as StoredToken
  if (stored.access_token && stored.expires_at > Date.now()) return stored.access_token

  const form: Record<string, string> = {
    client_id: client.clientId.trim(),
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token
  }
  if (client.clientSecret?.trim()) form.client_secret = client.clientSecret.trim()
  if (kind === 'm365') form.scope = PROVIDERS.m365.scopes.join(' ')
  const token = await postForm(PROVIDERS[kind].tokenUrl, form)
  const next: StoredToken = {
    refresh_token: String(token.refresh_token ?? stored.refresh_token),
    access_token: String(token.access_token ?? ''),
    expires_at: Date.now() + Number(token.expires_in ?? 3600) * 1000 - 60_000,
    scope: typeof token.scope === 'string' ? token.scope : stored.scope
  }
  setSecret(key, JSON.stringify(next))
  return next.access_token
}

/** 새 계정 연결 시 임시로 쓰는 저장 키 */
export const pendingOAuthKey = (): string => `pending:oauth:${base64url(randomBytes(8))}`
