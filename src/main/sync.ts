import { BrowserWindow, ipcMain } from 'electron'
import type { SyncState } from '../shared/types'
import * as repo from './repo'
import { canReadKind, readHeaders, sinceFor, type ReadContext } from './readers'

/**
 * 읽기 동기화 — 앱이 상주하지 않으므로 사용자가 앱을 켜거나 버튼을 누를 때만 돈다.
 * 결과로 생기는 알림은 알림함(notification 테이블)에 쌓아 두고, 앱을 켰을 때 확인한다.
 */

let state: SyncState = { phase: 'idle', done: 0, total: 0, fetched: 0 }
let running: Promise<SyncState> | null = null

function broadcast(next: Partial<SyncState>): void {
  state = { ...state, ...next }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:state', state)
  }
}

export function syncState(): SyncState {
  return state
}

const stamp = (): string => {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 동기화를 돌릴 수 있는 계정 — 읽기 가능한 종류 + 연결됨 + 동기화 켜짐 */
export function syncableAccounts(): ReturnType<typeof repo.listAccounts> {
  return repo
    .listAccounts()
    .filter((a) => canReadKind(a.kind) && a.connected && a.can_read && a.sync_enabled)
}

export interface SyncOptions {
  /** 이 사람의 주소만 조회 (사람 상세를 열 때) */
  personId?: number
  /** 계정 오류를 알림함에 쌓을지 (자동 실행은 쌓고, 수동 실행은 화면에 바로 보여준다) */
  notifyErrors?: boolean
}

/** 이미 돌고 있으면 그 작업을 기다린다 (중복 실행 방지) */
export function runSync(options: SyncOptions = {}, ctx?: ReadContext): Promise<SyncState> {
  if (running) return running
  running = doSync(options, ctx ?? { oauthClient: repo.oauthClientFor }).finally(() => {
    running = null
  })
  return running
}

async function doSync(options: SyncOptions, ctx: ReadContext): Promise<SyncState> {
  const accounts = syncableAccounts()
  if (accounts.length === 0) {
    broadcast({
      phase: 'done',
      done: 0,
      total: 0,
      fetched: 0,
      message: '읽기를 켠 계정이 없습니다',
      finishedAt: stamp()
    })
    return state
  }

  const addresses = repo.syncAddresses(options.personId)
  if (addresses.length === 0) {
    broadcast({
      phase: 'done',
      done: 0,
      total: accounts.length,
      fetched: 0,
      message: '등록된 이메일 주소가 없습니다',
      finishedAt: stamp()
    })
    return state
  }

  broadcast({ phase: 'running', done: 0, total: accounts.length, fetched: 0, message: undefined })

  // 회신 도착을 판정하려면 지금 열려 있는 대기 알림을 먼저 기억해 둔다
  const wasAwaiting = repo.openAwaitingPersonIds()
  const failures: string[] = []
  let fetched = 0

  for (const [i, account] of accounts.entries()) {
    broadcast({ account: account.display_name, done: i })
    try {
      const headers = await readHeaders(account, addresses, sinceFor(account.last_sync_at), ctx)
      const result = repo.upsertMailHeaders(account.id, headers)
      fetched += result.added
      repo.markAccountSynced(account.id)

      for (const item of result.inbound) {
        if (!wasAwaiting.has(item.personId)) continue
        // 기다리던 사람에게서 회신이 왔다 — 대기 알림을 닫고 도착을 알린다
        repo.closeAwaitingFor(item.personId)
        const person = repo.getPerson(item.personId)
        repo.pushNotification({
          kind: 'reply_received',
          personId: item.personId,
          accountId: account.id,
          title: `${person?.name ?? '상대'}님에게서 회신이 왔습니다`,
          body: item.subject || '(제목 없음)',
          dedupeKey: `reply:${item.personId}:${item.messageId}`
        })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failures.push(`${account.display_name}: ${message}`)
      repo.markAccountSynced(account.id, message)
      if (options.notifyErrors !== false) {
        repo.pushNotification({
          kind: 'sync_error',
          accountId: account.id,
          title: `${account.display_name} 동기화 실패`,
          body: message,
          // 같은 오류가 반복돼도 하루에 한 번만 쌓는다
          dedupeKey: `syncerr:${account.id}:${message.slice(0, 60)}:${stamp().slice(0, 10)}`
        })
      }
    }
    broadcast({ done: i + 1, fetched })
  }

  repo.refreshContactTimes(options.personId)
  createAwaitingNotifications()

  broadcast({
    phase: failures.length > 0 ? 'error' : 'done',
    account: undefined,
    fetched,
    message: failures.length > 0 ? failures.join(' / ') : undefined,
    finishedAt: stamp()
  })
  return state
}

/** 답장 대기 상태인 사람마다 알림을 하나씩 쌓는다 (같은 발신 건은 한 번만) */
export function createAwaitingNotifications(): number {
  let created = 0
  for (const person of repo.awaitingReplyPeople()) {
    const sentAt = person.last_outbound_at ?? ''
    const ok = repo.pushNotification({
      kind: 'awaiting_reply',
      personId: person.id,
      title: `${person.name}님 회신 대기`,
      body: `${sentAt.slice(0, 10)}에 보낸 뒤 회신이 없습니다`,
      dedupeKey: `awaiting:${person.id}:${sentAt}`
    })
    if (ok) created += 1
  }
  return created
}

export function registerSyncHandlers(): void {
  ipcMain.handle('sync:state', () => state)
  ipcMain.handle('sync:run', (_e, personId?: number) => runSync({ personId, notifyErrors: false }))
}

/**
 * 앱 시작 시 1회. 상주하지 않으므로 여기서 놓친 알림을 채워 넣는다.
 * 읽기 계정이 없어도 초안 기록만으로 답장 대기 알림은 만들 수 있다.
 */
export function syncOnStartup(): void {
  try {
    createAwaitingNotifications()
  } catch (e) {
    console.error('[sync] 시작 시 알림 생성 실패:', e)
  }
  if (!repo.getSettings().syncOnStartup) return
  if (syncableAccounts().length === 0) return
  // 창이 뜬 뒤에 시작해 초기 렌더를 방해하지 않는다
  setTimeout(() => {
    runSync({ notifyErrors: true }).catch((e) => console.error('[sync] 시작 동기화 실패:', e))
  }, 3000)
}
