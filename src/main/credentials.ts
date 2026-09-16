import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 비밀값(OAuth 리프레시 토큰, IMAP 비밀번호, Google 클라이언트 시크릿) 저장소.
 * DB 밖 credentials.json에 두고 OS 암호화(safeStorage)로 감싼다. 백업 zip에는 포함되지 않는다.
 * 암호화를 쓸 수 없는 환경이면 'plain:' 접두어로 저장하고 로그를 남긴다.
 */
const FILE = 'credentials.json'

type Store = Record<string, string>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

function load(): Store {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function save(store: Store): void {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true })
  fs.writeFileSync(filePath(), JSON.stringify(store, null, 2), 'utf8')
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(value).toString('base64')
  }
  console.warn('[credentials] OS 암호화를 쓸 수 없어 평문으로 저장합니다')
  return 'plain:' + Buffer.from(value, 'utf8').toString('base64')
}

function decrypt(stored: string): string | null {
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return null
  } catch (e) {
    console.error('[credentials] 복호화 실패:', e)
    return null
  }
}

export function getSecret(key: string): string | null {
  const stored = load()[key]
  return stored ? decrypt(stored) : null
}

export function setSecret(key: string, value: string): void {
  const store = load()
  store[key] = encrypt(value)
  save(store)
}

export function deleteSecret(key: string): void {
  const store = load()
  if (key in store) {
    delete store[key]
    save(store)
  }
}

export function hasSecret(key: string): boolean {
  return Boolean(load()[key])
}

/** 계정별 키 규칙 */
export const secretKeys = {
  oauth: (accountId: number): string => `account:${accountId}:oauth`,
  imap: (accountId: number): string => `account:${accountId}:imap`,
  googleClientSecret: 'oauth:google_client_secret'
}

/** 계정 삭제 시 그 계정의 비밀값을 모두 지운다 */
export function deleteAccountSecrets(accountId: number): void {
  deleteSecret(secretKeys.oauth(accountId))
  deleteSecret(secretKeys.imap(accountId))
}
