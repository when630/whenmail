import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeAppearance, chooseAppearance, type AppearanceState } from './appearance-state'

/** Each app owns its preferences in its existing userData directory. */
export function registerAppearance(): void {
  let current: AppearanceState | undefined
  const filename = (): string => path.join(app.getPath('userData'), 'appearance.json')
  const read = (): AppearanceState => {
    if (!current) {
      let stored: unknown
      try { stored = JSON.parse(fs.readFileSync(filename(), 'utf8')) } catch { /* first run or corrupt settings */ }
      current = normalizeAppearance(stored)
    }
    return current
  }
  ipcMain.on('appearance:get', (event) => {
    event.returnValue = BrowserWindow.fromWebContents(event.sender) ? read() : normalizeAppearance(null)
  })
  ipcMain.handle('appearance:set', (event, patch: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { ok: false, error: '앱 창에서만 변경할 수 있습니다.' }
    const temp = filename() + '.tmp'
    try {
      const next = chooseAppearance(read(), patch)
      fs.mkdirSync(path.dirname(filename()), { recursive: true })
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
      fs.renameSync(temp, filename())
      current = next
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('appearance:changed', next)
      }
      return { ok: true, state: next }
    } catch {
      try { fs.unlinkSync(temp) } catch { /* no temporary file */ }
      return { ok: false, error: '화면 설정을 저장하지 못했습니다. 다시 시도해 주세요.' }
    }
  })
}
