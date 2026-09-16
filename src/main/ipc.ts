import { app, ipcMain, shell } from 'electron'
import path from 'node:path'
import { renderTemplate, bodyToHtmlFragment, htmlToText, isHtmlBody } from '../shared/render'
import { parseAddressList } from '../shared/address'
import type {
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicatePolicy,
  ExportFormat,
  OrganizationInput,
  PersonFilter,
  PersonInput,
  TemplateInput
} from '../shared/types'
import * as repo from './repo'
import { detectOutlookMode, effectiveOutlookMode, openDraft } from './outlook'
import { pickAndParse } from './importer'
import { imageToDataUrl, pickAndScanCard } from './ocr'
import { exportBackup, importBackup } from './backup'
import { existingAttachments, pickAttachments } from './attachments'
import { exportPeople } from './exporter'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
      const people = repo.getPeople(targets.map((t) => t.personId))
      const settings = repo.getSettings()
      const mode = await effectiveOutlookMode(settings.outlookMode)
      // 서명: 설정에서 켜져 있고, 이번 초안에서 끄지 않았을 때만
      const useSignature = settings.signatureEnabled && options.includeSignature !== false
      const signature = useSignature ? settings.signatureHtml.trim() : ''
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
          const adapter = await openDraft(
            {
              to,
              cc,
              bcc,
              subject,
              bodyFragment: bodyToHtmlFragment(body, signature),
              text: isHtmlBody(body) ? htmlToText(body) : body,
              // 앱 서명이 있으면 Outlook 기본 서명은 빼서 두 번 들어가지 않게
              preserveOutlookSignature: signature === '',
              attachments
            },
            mode
          )
          repo.insertActivity({
            personId: person.id,
            kind: 'draft',
            templateId: template.id,
            personName: person.name,
            personEmail: to,
            templateName: template.name,
            summary: subject,
            adapter
          })
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
        if (i < people.length - 1) await sleep(800)
      }

      if (results.some((r) => r.ok)) repo.touchTemplateUsed(template.id)
      return results
    }
  )

  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('system:outlookMode', () => effectiveOutlookMode(repo.getSettings().outlookMode))
  ipcMain.handle('system:outlookDetected', () => detectOutlookMode())
  ipcMain.handle('settings:get', () => repo.getSettings())
  ipcMain.handle('settings:save', (_e, input: AppSettings) => repo.saveSettings(input))
  ipcMain.handle('system:openDataFolder', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('system:showInFolder', (_e, filePath: string) =>
    shell.showItemInFolder(path.resolve(filePath))
  )
  ipcMain.handle('backup:export', () => exportBackup())
  ipcMain.handle('backup:import', () => importBackup())
}
