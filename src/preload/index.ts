import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  BulkContactPatch,
  Contact,
  ContactInput,
  DraftLog,
  DraftOptions,
  DraftResult,
  DuplicatePolicy,
  EmailTemplate,
  ImportParseResult,
  ImportSummary,
  OcrScanResult,
  OutlookAdapter,
  TagCount,
  TemplateAttachment,
  TemplateInput,
  UpdateState
} from '../shared/types'
import type { WhenmailApi } from '../shared/api'

const api: WhenmailApi = {
  tags: {
    list: (): Promise<TagCount[]> => ipcRenderer.invoke('tags:list')
  },
  contacts: {
    list: (search?: string, tag?: string): Promise<Contact[]> =>
      ipcRenderer.invoke('contacts:list', search, tag),
    recent: (limit?: number): Promise<Contact[]> => ipcRenderer.invoke('contacts:recent', limit),
    create: (input: ContactInput): Promise<Contact> => ipcRenderer.invoke('contacts:create', input),
    update: (id: number, input: ContactInput): Promise<Contact> =>
      ipcRenderer.invoke('contacts:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('contacts:delete', id),
    removeMany: (ids: number[]): Promise<number> => ipcRenderer.invoke('contacts:deleteMany', ids),
    bulkUpdate: (ids: number[], patch: BulkContactPatch): Promise<number> =>
      ipcRenderer.invoke('contacts:bulkUpdate', ids, patch)
  },
  import: {
    pick: (): Promise<ImportParseResult | null> => ipcRenderer.invoke('import:pick'),
    commit: (rows: ContactInput[], policy: DuplicatePolicy): Promise<ImportSummary> =>
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
      contactIds: number[],
      templateId: number,
      options?: DraftOptions
    ): Promise<DraftResult[]> =>
      ipcRenderer.invoke('drafts:create', contactIds, templateId, options),
    history: (): Promise<DraftLog[]> => ipcRenderer.invoke('drafts:history')
  },
  system: {
    version: (): Promise<string> => ipcRenderer.invoke('system:version'),
    outlookMode: (): Promise<OutlookAdapter> => ipcRenderer.invoke('system:outlookMode'),
    outlookDetected: (): Promise<OutlookAdapter> => ipcRenderer.invoke('system:outlookDetected'),
    openDataFolder: (): Promise<string> => ipcRenderer.invoke('system:openDataFolder')
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
