import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Account,
  AccountInput,
  Activity,
  AppNotification,
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicateGroup,
  DuplicatePolicy,
  EmailTemplate,
  ExportFormat,
  FollowUp,
  FollowUpInput,
  FollowUpStatus,
  ImportParseResult,
  ImportSummary,
  MailEntry,
  NotificationStatus,
  OAuthResult,
  OcrScanResult,
  Organization,
  OrganizationInput,
  OutlookAdapter,
  Person,
  PersonFilter,
  PersonInput,
  PersonSequence,
  Sequence,
  SequenceInput,
  SyncState,
  TagCount,
  TemplateAttachment,
  TemplateInput,
  TodoItem,
  UpdateState
} from '../shared/types'
import type { WhenmailApi } from '../shared/api'

const api: WhenmailApi = {
  people: {
    list: (filter?: PersonFilter): Promise<Person[]> => ipcRenderer.invoke('people:list', filter),
    get: (id: number): Promise<Person | null> => ipcRenderer.invoke('people:get', id),
    recent: (limit?: number): Promise<Person[]> => ipcRenderer.invoke('people:recent', limit),
    create: (input: PersonInput): Promise<Person> => ipcRenderer.invoke('people:create', input),
    update: (id: number, input: PersonInput): Promise<Person> =>
      ipcRenderer.invoke('people:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('people:delete', id),
    removeMany: (ids: number[]): Promise<number> => ipcRenderer.invoke('people:deleteMany', ids),
    bulkUpdate: (ids: number[], patch: BulkPersonPatch): Promise<number> =>
      ipcRenderer.invoke('people:bulkUpdate', ids, patch),
    duplicates: (): Promise<DuplicateGroup[]> => ipcRenderer.invoke('people:duplicates'),
    merge: (targetId: number, sourceIds: number[]): Promise<Person> =>
      ipcRenderer.invoke('people:merge', targetId, sourceIds),
    export: (ids: number[], format: ExportFormat): Promise<string | null> =>
      ipcRenderer.invoke('people:export', ids, format)
  },
  organizations: {
    list: (search?: string): Promise<Organization[]> =>
      ipcRenderer.invoke('organizations:list', search),
    get: (id: number): Promise<Organization | null> => ipcRenderer.invoke('organizations:get', id),
    update: (id: number, input: OrganizationInput): Promise<Organization> =>
      ipcRenderer.invoke('organizations:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('organizations:delete', id)
  },
  activities: {
    list: (personId?: number, limit?: number): Promise<Activity[]> =>
      ipcRenderer.invoke('activities:list', personId, limit),
    addNote: (personId: number, text: string): Promise<Activity> =>
      ipcRenderer.invoke('activities:addNote', personId, text),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('activities:delete', id)
  },
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
    get: (id: number): Promise<Account | null> => ipcRenderer.invoke('accounts:get', id),
    create: (input: AccountInput): Promise<Account> => ipcRenderer.invoke('accounts:create', input),
    update: (id: number, input: AccountInput): Promise<Account> =>
      ipcRenderer.invoke('accounts:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('accounts:delete', id),
    setDefault: (id: number): Promise<Account[]> => ipcRenderer.invoke('accounts:setDefault', id),
    connectOAuth: (
      kind: 'm365' | 'gmail',
      accountId?: number,
      withRead?: boolean
    ): Promise<OAuthResult> =>
      ipcRenderer.invoke('accounts:connectOAuth', kind, accountId, withRead),
    testImap: (input: AccountInput, accountId?: number): Promise<{ draftsPath: string }> =>
      ipcRenderer.invoke('accounts:testImap', input, accountId),
    sendTest: (id: number): Promise<DraftResult> => ipcRenderer.invoke('accounts:sendTest', id)
  },
  mail: {
    list: (personId: number, limit?: number): Promise<MailEntry[]> =>
      ipcRenderer.invoke('mail:list', personId, limit)
  },
  notifications: {
    list: (includeDone?: boolean): Promise<AppNotification[]> =>
      ipcRenderer.invoke('notifications:list', includeDone),
    unreadCount: (): Promise<number> => ipcRenderer.invoke('notifications:unreadCount'),
    setStatus: (id: number, status: NotificationStatus): Promise<AppNotification[]> =>
      ipcRenderer.invoke('notifications:setStatus', id, status),
    markAllRead: (): Promise<AppNotification[]> => ipcRenderer.invoke('notifications:markAllRead'),
    clear: (onlyDone?: boolean): Promise<AppNotification[]> =>
      ipcRenderer.invoke('notifications:clear', onlyDone)
  },
  followUps: {
    list: (personId?: number, includeClosed?: boolean): Promise<FollowUp[]> =>
      ipcRenderer.invoke('followups:list', personId, includeClosed),
    create: (input: FollowUpInput): Promise<FollowUp> =>
      ipcRenderer.invoke('followups:create', input),
    setStatus: (id: number, status: FollowUpStatus): Promise<FollowUp | null> =>
      ipcRenderer.invoke('followups:setStatus', id, status),
    snooze: (id: number, days: number): Promise<FollowUp | null> =>
      ipcRenderer.invoke('followups:snooze', id, days),
    complete: (id: number): Promise<FollowUp | null> => ipcRenderer.invoke('followups:complete', id)
  },
  todos: {
    list: (): Promise<TodoItem[]> => ipcRenderer.invoke('todos:list')
  },
  sequences: {
    list: (): Promise<Sequence[]> => ipcRenderer.invoke('sequences:list'),
    create: (input: SequenceInput): Promise<Sequence> =>
      ipcRenderer.invoke('sequences:create', input),
    update: (id: number, input: SequenceInput): Promise<Sequence> =>
      ipcRenderer.invoke('sequences:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('sequences:delete', id),
    start: (personId: number, sequenceId: number): Promise<PersonSequence> =>
      ipcRenderer.invoke('sequences:start', personId, sequenceId),
    stop: (personSequenceId: number): Promise<void> =>
      ipcRenderer.invoke('sequences:stop', personSequenceId),
    running: (personId?: number): Promise<PersonSequence[]> =>
      ipcRenderer.invoke('sequences:running', personId)
  },
  sync: {
    state: (): Promise<SyncState> => ipcRenderer.invoke('sync:state'),
    run: (personId?: number): Promise<SyncState> => ipcRenderer.invoke('sync:run', personId),
    onState: (cb: (state: SyncState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: SyncState): void => cb(state)
      ipcRenderer.on('sync:state', listener)
      return () => ipcRenderer.removeListener('sync:state', listener)
    }
  },
  tags: {
    list: (): Promise<TagCount[]> => ipcRenderer.invoke('tags:list')
  },
  import: {
    pick: (): Promise<ImportParseResult | null> => ipcRenderer.invoke('import:pick'),
    commit: (rows: PersonInput[], policy: DuplicatePolicy): Promise<ImportSummary> =>
      ipcRenderer.invoke('import:commit', rows, policy)
  },
  ocr: {
    scanCard: (): Promise<OcrScanResult | null> => ipcRenderer.invoke('ocr:scanCard')
  },
  files: {
    imageDataUrl: (path: string): Promise<string> => ipcRenderer.invoke('files:imageDataUrl', path)
  },
  templates: {
    list: (): Promise<EmailTemplate[]> => ipcRenderer.invoke('templates:list'),
    create: (input: TemplateInput): Promise<EmailTemplate> =>
      ipcRenderer.invoke('templates:create', input),
    update: (id: number, input: TemplateInput): Promise<EmailTemplate> =>
      ipcRenderer.invoke('templates:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('templates:delete', id),
    pickAttachments: (): Promise<TemplateAttachment[] | null> =>
      ipcRenderer.invoke('templates:pickAttachments')
  },
  drafts: {
    create: (
      targets: DraftTarget[],
      templateId: number,
      options?: DraftOptions
    ): Promise<DraftResult[]> => ipcRenderer.invoke('drafts:create', targets, templateId, options)
  },
  system: {
    version: (): Promise<string> => ipcRenderer.invoke('system:version'),
    outlookDetected: (): Promise<OutlookAdapter> => ipcRenderer.invoke('system:outlookDetected'),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('system:openDataFolder'),
    showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('system:showInFolder', path),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    save: (input: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', input)
  },
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onState: (cb: (state: UpdateState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => cb(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },
  backup: {
    export: (): Promise<string | null> => ipcRenderer.invoke('backup:export'),
    import: (): Promise<boolean> => ipcRenderer.invoke('backup:import')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
