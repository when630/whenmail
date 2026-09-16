import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Activity,
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicateGroup,
  DuplicatePolicy,
  EmailTemplate,
  ExportFormat,
  ImportParseResult,
  ImportSummary,
  OcrScanResult,
  Organization,
  OrganizationInput,
  OutlookAdapter,
  Person,
  PersonFilter,
  PersonInput,
  TagCount,
  TemplateAttachment,
  TemplateInput,
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
    outlookMode: (): Promise<OutlookAdapter> => ipcRenderer.invoke('system:outlookMode'),
    outlookDetected: (): Promise<OutlookAdapter> => ipcRenderer.invoke('system:outlookDetected'),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('system:openDataFolder'),
    showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('system:showInFolder', path)
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
