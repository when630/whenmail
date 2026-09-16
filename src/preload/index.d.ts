import { ElectronAPI } from '@electron-toolkit/preload'
import type { WhenmailApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: WhenmailApi
  }
}
