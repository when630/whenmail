import { app, ipcMain, shell } from 'electron'
import path from 'node:path'
import { renderTemplate, bodyToHtmlFragment, htmlToText, isHtmlBody } from '../shared/render'
import { parseAddressList } from '../shared/address'
import type {
  Account,
  AccountInput,
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicatePolicy,
  ExportFormat,
  FollowUpInput,
  FollowUpStatus,
  NotificationStatus,
  SequenceInput,
  OrganizationInput,
  PersonFilter,
  PersonInput,
  TemplateInput
} from '../shared/types'
import * as repo from './repo'
import { detectOutlookMode } from './outlook'
import { pickAndParse } from './importer'
import { imageToDataUrl, pickAndScanCard } from './ocr'
import { exportBackup, importBackup } from './backup'
import { existingAttachments, pickAttachments } from './attachments'
import { exportPeople } from './exporter'
import { createDraftForAccount, testImapConnection, type DraftMessage } from './adapters'
import { connectOAuth, pendingOAuthKey } from './oauth'
import { secretKeys } from './credentials'
import { createDueNotifications } from './sync'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const adapterCtx = { oauthClient: repo.oauthClientFor }

/** 계정 서명·본문을 합쳐 어댑터 입력을 만든다 */
function buildMessage(
  account: Account,
  to: string,
  subject: string,
  body: string,
  cc: string[],
  bcc: string[],
  attachments: DraftMessage['attachments'],
  includeSignature: boolean | undefined
): DraftMessage {
  const useSignature = account.signature_enabled && includeSignature !== false
  const signature = useSignature ? account.signature_html.trim() : ''
  return {
    to,
    cc,
    bcc,
    subject,
    bodyFragment: bodyToHtmlFragment(body, signature),
    text: isHtmlBody(body) ? htmlToText(body) : body,
    // 앱 서명이 있으면 Outlook 기본 서명은 빼서 두 번 들어가지 않게
    preserveOutlookSignature: signature === '',
    attachments
  }
}

export function registerIpcHandlers(): void {
  // 사람
  ipcMain.handle('people:list', (_e, filter?: PersonFilter) => repo.listPeople(filter))
  ipcMain.handle('people:get', (_e, id: number) => repo.getPerson(id))
  ipcMain.handle('people:recent', (_e, limit?: number) => repo.recentPeople(limit))
  ipcMain.handle('people:create', (_e, input: PersonInput) => repo.createPerson(input))
  ipcMain.handle('people:update', (_e, id: number, input: PersonInput) =>
    repo.updatePerson(id, input)
  )
  ipcMain.handle('people:delete', (_e, id: number) => repo.deletePerson(id))
  ipcMain.handle('people:deleteMany', (_e, ids: number[]) => repo.deletePeople(ids))
  ipcMain.handle('people:bulkUpdate', (_e, ids: number[], patch: BulkPersonPatch) =>
    repo.bulkUpdatePeople(ids, patch)
  )
  ipcMain.handle('people:duplicates', () => repo.findDuplicates())
  ipcMain.handle('people:merge', (_e, targetId: number, sourceIds: number[]) =>
    repo.mergePeople(targetId, sourceIds)
  )
  ipcMain.handle('people:export', (_e, ids: number[], format: ExportFormat) =>
    exportPeople(repo.getPeople(ids), format)
  )

  // 회사
  ipcMain.handle('organizations:list', (_e, search?: string) => repo.listOrganizations(search))
  ipcMain.handle('organizations:get', (_e, id: number) => repo.getOrganization(id))
  ipcMain.handle('organizations:update', (_e, id: number, input: OrganizationInput) =>
    repo.updateOrganization(id, input)
  )
  ipcMain.handle('organizations:delete', (_e, id: number) => repo.deleteOrganization(id))

  // 활동
  ipcMain.handle('activities:list', (_e, personId?: number, limit?: number) =>
    repo.listActivities(personId, limit)
  )
  ipcMain.handle('activities:addNote', (_e, personId: number, text: string) =>
    repo.addNote(personId, text)
  )
  ipcMain.handle('activities:delete', (_e, id: number) => repo.deleteActivity(id))

  // 계정
  ipcMain.handle('accounts:list', () => repo.listAccounts())
  ipcMain.handle('accounts:get', (_e, id: number) => repo.getAccount(id))
  ipcMain.handle('accounts:create', (_e, input: AccountInput) => repo.createAccount(input))
  ipcMain.handle('accounts:update', (_e, id: number, input: AccountInput) =>
    repo.updateAccount(id, input)
  )
  ipcMain.handle('accounts:delete', (_e, id: number) => repo.deleteAccount(id))
  ipcMain.handle('accounts:setDefault', (_e, id: number) => repo.setDefaultAccount(id))
  ipcMain.handle(
    'accounts:connectOAuth',
    async (_e, kind: 'm365' | 'gmail', accountId?: number, withRead?: boolean) => {
      const client = repo.oauthClientFor(kind)
      if (accountId) {
        return connectOAuth(kind, client, secretKeys.oauth(accountId), withRead)
      }
      const pendingKey = pendingOAuthKey()
      const result = await connectOAuth(kind, client, pendingKey, withRead)
      return { ...result, pendingKey }
    }
  )
  ipcMain.handle('accounts:testImap', (_e, input: AccountInput, accountId?: number) =>
    testImapConnection(
      { id: accountId ?? 0, address: input.address, config: input.config },
      input.imapPassword?.trim() || undefined
    )
  )
  ipcMain.handle('accounts:sendTest', async (_e, id: number): Promise<DraftResult> => {
    const account = repo.getAccount(id)
    if (!account) throw new Error('계정을 찾을 수 없습니다')
    const to = account.address.trim()
    if (!to) {
      return {
        personId: 0,
        personName: account.display_name,
        ok: false,
        error: '계정에 발신 주소가 없어 테스트 초안을 만들 수 없습니다'
      }
    }
    try {
      const adapter = await createDraftForAccount(
        account,
        buildMessage(
          account,
          to,
          'whenmail 테스트 초안',
          '이 초안은 whenmail 계정 연결 테스트로 만들어졌습니다. 보내지 않고 삭제해도 됩니다.',
          [],
          [],
          [],
          undefined
        ),
        adapterCtx
      )
      return { personId: 0, personName: account.display_name, ok: true, adapter }
    } catch (e) {
      return {
        personId: 0,
        personName: account.display_name,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })

  // 메일 인덱스 · 알림함
  ipcMain.handle('mail:list', (_e, personId: number, limit?: number) =>
    repo.listMail(personId, limit)
  )
  ipcMain.handle('notifications:list', (_e, includeDone?: boolean) =>
    repo.listNotifications(includeDone)
  )
  ipcMain.handle('notifications:unreadCount', () => repo.unreadNotificationCount())
  ipcMain.handle('notifications:setStatus', (_e, id: number, status: NotificationStatus) =>
    repo.setNotificationStatus(id, status)
  )
  ipcMain.handle('notifications:markAllRead', () => repo.markAllNotificationsRead())
  ipcMain.handle('notifications:clear', (_e, onlyDone?: boolean) =>
    repo.clearNotifications(onlyDone !== false)
  )

  // 후속 리마인더 · 할 일
  ipcMain.handle('followups:list', (_e, personId?: number, includeClosed?: boolean) =>
    repo.listFollowUps(personId, includeClosed)
  )
  ipcMain.handle('followups:create', (_e, input: FollowUpInput) => {
    const fu = repo.createFollowUp(input)
    // 기한이 이미 지났으면 바로 알림함에 올린다
    createDueNotifications()
    return fu
  })
  ipcMain.handle('followups:setStatus', (_e, id: number, status: FollowUpStatus) =>
    repo.setFollowUpStatus(id, status)
  )
  ipcMain.handle('followups:snooze', (_e, id: number, days: number) =>
    repo.snoozeFollowUp(id, days)
  )
  ipcMain.handle('followups:complete', (_e, id: number) => {
    const fu = repo.completeFollowUp(id)
    createDueNotifications()
    return fu
  })
  ipcMain.handle('todos:list', () => {
    createDueNotifications()
    return repo.listTodos()
  })

  // 템플릿 시퀀스
  ipcMain.handle('sequences:list', () => repo.listSequences())
  ipcMain.handle('sequences:create', (_e, input: SequenceInput) => repo.createSequence(input))
  ipcMain.handle('sequences:update', (_e, id: number, input: SequenceInput) =>
    repo.updateSequence(id, input)
  )
  ipcMain.handle('sequences:delete', (_e, id: number) => repo.deleteSequence(id))
  ipcMain.handle('sequences:start', (_e, personId: number, sequenceId: number) => {
    const ps = repo.startSequence(personId, sequenceId)
    createDueNotifications()
    return ps
  })
  ipcMain.handle('sequences:stop', (_e, personSequenceId: number) =>
    repo.stopSequence(personSequenceId)
  )
  ipcMain.handle('sequences:running', (_e, personId?: number) => repo.listPersonSequences(personId))

  ipcMain.handle('tags:list', () => repo.listTags())

  ipcMain.handle('ocr:scanCard', () => pickAndScanCard())
  ipcMain.handle('files:imageDataUrl', (_e, filePath: string) => {
    // 렌더러가 요청할 수 있는 경로를 앱 데이터 폴더 안으로 제한
    const cardsDir = path.join(app.getPath('userData'), 'cards')
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(cardsDir)) throw new Error('허용되지 않은 경로입니다')
    return imageToDataUrl(resolved)
  })

  ipcMain.handle('import:pick', () => pickAndParse())
  ipcMain.handle('import:commit', (_e, rows: PersonInput[], policy: DuplicatePolicy) =>
    repo.importPeople(rows, policy)
  )

  ipcMain.handle('templates:list', () => repo.listTemplates())
  ipcMain.handle('templates:create', (_e, input: TemplateInput) => repo.createTemplate(input))
  ipcMain.handle('templates:update', (_e, id: number, input: TemplateInput) =>
    repo.updateTemplate(id, input)
  )
  ipcMain.handle('templates:delete', (_e, id: number) => repo.deleteTemplate(id))
  ipcMain.handle('templates:pickAttachments', () => pickAttachments())

  ipcMain.handle(
    'drafts:create',
    async (
      _e,
      targets: DraftTarget[],
      templateId: number,
      options: DraftOptions = {}
    ): Promise<DraftResult[]> => {
      const template = repo.getTemplate(templateId)
      if (!template) throw new Error('템플릿을 찾을 수 없습니다')
      const account = options.accountId ? repo.getAccount(options.accountId) : repo.defaultAccount()
      if (!account) throw new Error('보낼 계정이 없습니다. 설정 > 계정에서 계정을 추가하세요')
      const people = repo.getPeople(targets.map((t) => t.personId))
      const attachments = existingAttachments(template.attachments)
      const cc = parseAddressList(options.cc)
      const bcc = parseAddressList(options.bcc)
      const results: DraftResult[] = []

      for (const [i, person] of people.entries()) {
        const chosen = targets.find((t) => t.personId === person.id)?.email?.trim()
        const to = chosen || person.email.trim()
        if (!to) {
          results.push({
            personId: person.id,
            personName: person.name,
            ok: false,
            error: '이메일 주소가 없습니다'
          })
          continue
        }
        try {
          const data = { ...person, email: to }
          const subject = renderTemplate(template.subject_tpl, data).text
          const body = renderTemplate(template.body_tpl, data).text
          const adapter = await createDraftForAccount(
            account,
            buildMessage(
              account,
              to,
              subject,
              body,
              cc,
              bcc,
              attachments,
              options.includeSignature
            ),
            adapterCtx
          )
          const activity = repo.insertActivity({
            personId: person.id,
            kind: 'draft',
            templateId: template.id,
            accountId: account.id,
            personName: person.name,
            personEmail: to,
            templateName: template.name,
            summary: subject,
            adapter
          })
          // 이 초안이 후속(또는 시퀀스 단계)을 처리한 것이면 완료하고 다음 단계를 예약한다
          if (options.fulfillFollowUpId) {
            repo.completeFollowUp(options.fulfillFollowUpId, activity.id)
          }
          // "N일 뒤 답 없으면 알림"을 함께 걸어 둔다
          if (options.followUpDays && options.followUpDays > 0) {
            repo.createFollowUp({
              personId: person.id,
              dueAt: repo.dueInDays(options.followUpDays),
              note: `'${template.name}' 초안 뒤 회신 확인`,
              templateId: template.id
            })
          }
          results.push({ personId: person.id, personName: person.name, ok: true, adapter })
        } catch (e) {
          results.push({
            personId: person.id,
            personName: person.name,
            ok: false,
            error: e instanceof Error ? e.message : String(e)
          })
        }
        // 초안 창이 연속으로 뜰 때 Outlook이 놓치지 않도록 간격을 둔다
        if (i < people.length - 1 && account.kind === 'outlook_local') await sleep(800)
      }

      if (results.some((r) => r.ok)) {
        repo.touchTemplateUsed(template.id)
        createDueNotifications()
      }
      return results
    }
  )

  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('system:outlookDetected', () => detectOutlookMode())
  ipcMain.handle('settings:get', () => repo.getSettings())
  ipcMain.handle('settings:save', (_e, input: AppSettings) => repo.saveSettings(input))
  ipcMain.handle('system:openDataFolder', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('system:showInFolder', (_e, filePath: string) =>
    shell.showItemInFolder(path.resolve(filePath))
  )
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('허용되지 않은 주소입니다')
    return shell.openExternal(url)
  })
  ipcMain.handle('backup:export', () => exportBackup())
  ipcMain.handle('backup:import', () => importBackup())
}
