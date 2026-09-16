import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { DB_FILE } from './migrate'
import { migrateDatabase } from './schema'

let db: Database.Database | null = null

/** 백업 복원 등 파일 교체 전에 DB 연결을 닫는다 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, DB_FILE)
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrateDatabase(db, file)
  return db
}
