import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const DB_FILE = 'whenmail.db'
/** whenimail → whenmail 개명(v0.5.0) 이전의 데이터 폴더·DB 파일명 */
export const LEGACY_APP_NAME = 'whenimail'
export const LEGACY_DB_FILE = 'whenimail.db'

const DB_SUFFIXES = ['', '-wal', '-shm']

/**
 * 개명 이전(whenimail) 사용자 데이터를 현재 userData로 이전한다. 앱 시작 시 DB 열기 전에 1회 호출.
 * 1) %APPDATA%/whenimail 폴더가 있고 새 폴더에 DB가 없으면 내용을 복사(기존 폴더는 남겨둠)
 * 2) whenimail.db(-wal/-shm) → whenmail.db 로 파일명 변경
 * 실패해도 앱 실행을 막지 않는다(새 DB로 시작).
 */
export function migrateLegacyData(): void {
  const userData = app.getPath('userData')
  try {
    const legacyDir = path.join(path.dirname(userData), LEGACY_APP_NAME)
    const hasNewDb =
      fs.existsSync(path.join(userData, DB_FILE)) ||
      fs.existsSync(path.join(userData, LEGACY_DB_FILE))
    if (
      !hasNewDb &&
      legacyDir !== userData &&
      fs.existsSync(path.join(legacyDir, LEGACY_DB_FILE))
    ) {
      fs.mkdirSync(userData, { recursive: true })
      // force:false → 새 폴더에 이미 있는 파일(Electron 캐시 등)은 덮어쓰지 않음
      fs.cpSync(legacyDir, userData, { recursive: true, force: false })
    }
    renameLegacyDb(userData)
  } catch (e) {
    console.error('[migrate] 이전 데이터 이전 실패:', e)
  }
}

/** dir 안의 whenimail.db(-wal/-shm)를 whenmail.db로 바꾼다. 새 이름이 이미 있으면 건너뜀 */
export function renameLegacyDb(dir: string): void {
  if (fs.existsSync(path.join(dir, DB_FILE))) return
  for (const suffix of DB_SUFFIXES) {
    const from = path.join(dir, LEGACY_DB_FILE + suffix)
    if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, DB_FILE + suffix))
  }
}
