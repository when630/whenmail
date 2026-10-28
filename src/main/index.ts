import { registerAppearance } from './appearance'
registerAppearance()
import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { initUpdater } from './updater'
import { migrateLegacyData } from './migrate'
import { registerSyncHandlers, syncOnStartup } from './sync'
import { applyHotkey, releaseHotkey, setHotkeyAction } from './hotkey'
import { getSettings } from './repo'
import {
  APP_ID as LINK_ID,
  SCHEME,
  buildManifest,
  fromArgv,
  parseDeepLink,
  type DeepLink
} from '../shared/deeplink'

let mainWindow: BrowserWindow | null = null
let pendingLink: DeepLink | null = null // 창이 로딩 중일 때 온 딥링크 — did-finish-load에서 넘긴다(push는 로딩 중이면 사라진다)

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'whenmail',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingLink && mainWindow) {
      mainWindow.webContents.send('deeplink', pendingLink)
      pendingLink = null
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── 형제 앱 연동(D-14, when-protocol) — WHENCOMMAND가 whenmail://<명령>?<인자> 로 부른다. 모르는 URL은 조용히 무시한다.
function focusMain(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const win = mainWindow!
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

// 전역 단축키가 하는 일 — 창을 앞으로. 이미 앞에 있으면 내린다(최소화). 숨기지는 않는다 —
// 트레이가 없는 앱이라 숨긴 창은 단축키 말고는 되찾을 길이 없다.
function toggleMain(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.minimize()
    return
  }
  focusMain()
}

function handleDeepLink(raw: string): boolean {
  const link = parseDeepLink(raw)
  if (!link) return false
  const win = focusMain()
  if (link.command === 'open') return true
  if (win.webContents.isLoading()) pendingLink = link
  else win.webContents.send('deeplink', link)
  return true
}

// 매니페스트 — 실행될 때마다 덮어쓴다. 실패해도 앱은 멈추지 않는다: 연동은 더해지는 것이지 전제가 아니다.
function writeManifest(): void {
  try {
    const dir = path.join(os.homedir(), '.when', 'apps')
    fs.mkdirSync(dir, { recursive: true })
    const manifest = buildManifest({
      platformName: process.platform,
      exePath: app.getPath('exe'),
      packaged: app.isPackaged
    })
    fs.writeFileSync(
      path.join(dir, `${LINK_ID}.json`),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    )
  } catch {
    /* 연동은 선택이다 */
  }
}

// 딥링크 스킴. 패키징본은 electron-builder.yml의 protocols가 OS에 등록해 두지만, 개발 실행은 electron.exe와 앱 경로를
// 함께 넘겨야 OS가 이 프로젝트로 연다.
try {
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)
  else app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])])
} catch {
  /* 등록 실패는 앱을 멈추지 않는다 */
}

// 두 번째 인스턴스는 argv에 딥링크를 싣고 온다(Windows/Linux) — 첫 인스턴스가 받아 처리한다.
// 전에는 락이 없어 아이콘을 두 번 누르면 창이 둘 떴다 — 이제 한 인스턴스가 창을 앞으로 가져온다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = fromArgv(argv)
    if (!url || !handleDeepLink(url)) focusMain()
  })
  app.on('open-url', (e, url) => {
    e.preventDefault() // macOS — ready 전에도 올 수 있다
    if (app.isReady()) handleDeepLink(url)
    else pendingUrl = url
  })
}
let pendingUrl: string | null = null

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.when630.whenimail')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  migrateLegacyData()
  registerIpcHandlers()
  registerSyncHandlers()
  initUpdater()

  createWindow()
  syncOnStartup()
  writeManifest()

  // 전역 단축키 — 조합은 설정(DB)에 있다. 못 잡아도 앱은 뜬다: 설정 화면이 그 사실을 빨갛게 적는다
  setHotkeyAction(toggleMain)
  applyHotkey(getSettings().hotkey)

  // 첫 실행의 argv(Windows)나 ready 전에 온 open-url(macOS)에 딥링크가 있으면 처리한다
  const first = fromArgv(process.argv) ?? pendingUrl
  pendingUrl = null
  if (first) handleDeepLink(first)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('will-quit', () => releaseHotkey())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
