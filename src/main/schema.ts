import fs from 'node:fs'
import type Database from 'better-sqlite3'

/**
 * 스키마 버전 관리.
 *  v1: contact(명함 1장 = 연락처 1건, 이메일 1개) · template · draft_log · tag · contact_tag · setting
 *  v2: person / email_address(1:N) / organization / business_card(1:N) / person_tag / activity
 */
export const SCHEMA_VERSION = 2

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
  )
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  return cols.some((c) => c.name === column)
}

function readVersion(db: Database.Database): number | null {
  if (!tableExists(db, 'schema_version')) return null
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    { version: number } | undefined
  return row?.version ?? null
}

function writeVersion(db: Database.Database, version: number): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)
  db.exec('DELETE FROM schema_version')
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
}

/** 열린 DB를 최신 스키마로 올린다. 새 DB면 바로 최신 스키마를 만든다 */
export function migrateDatabase(db: Database.Database, file: string): void {
  let version = readVersion(db)

  if (version === null) {
    if (tableExists(db, 'contact')) {
      // 버전 표기가 없는 기존(v1) DB
      version = 1
    } else {
      // 새 DB — 최신 스키마를 바로 만든다
      createSchemaV2(db)
      writeVersion(db, SCHEMA_VERSION)
      return
    }
  }

  if (version < 2) {
    backupBeforeMigration(db, file, version)
    db.transaction(() => {
      migrateV1toV2(db)
      writeVersion(db, 2)
    })()
    version = 2
  }
}

/** 큰 구조 변경 전에 DB 파일 사본을 남긴다 (whenmail.db.bak-v1). 실패해도 이전은 진행 */
function backupBeforeMigration(db: Database.Database, file: string, from: number): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    const dest = `${file}.bak-v${from}`
    if (!fs.existsSync(dest)) fs.copyFileSync(file, dest)
  } catch (e) {
    console.error('[db] 이전 전 백업 실패:', e)
  }
}

/** v2에서 새로 생기는 테이블 (v1 → v2 이전과 신규 생성이 공유) */
const V2_TABLES = `
  CREATE TABLE IF NOT EXISTS organization (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    organization_id INTEGER REFERENCES organization(id) ON DELETE SET NULL,
    department TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    mobile TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    last_contact_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_person_name ON person(name);
  CREATE INDEX IF NOT EXISTS idx_person_org ON person(organization_id);

  CREATE TABLE IF NOT EXISTS email_address (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT '',
    UNIQUE (person_id, address)
  );
  CREATE INDEX IF NOT EXISTS idx_email_address ON email_address(address);

  CREATE TABLE IF NOT EXISTS business_card (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    ocr_text TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_card_person ON business_card(person_id);

  CREATE TABLE IF NOT EXISTS tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS person_tag (
    person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    template_id INTEGER REFERENCES template(id) ON DELETE SET NULL,
    person_name TEXT NOT NULL DEFAULT '',
    person_email TEXT NOT NULL DEFAULT '',
    template_name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    adapter TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_person ON activity(person_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity(occurred_at);
`

const COMMON_TABLES = `
  CREATE TABLE IF NOT EXISTS template (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject_tpl TEXT NOT NULL DEFAULT '',
    body_tpl TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`

function createSchemaV2(db: Database.Database): void {
  db.exec(COMMON_TABLES)
  db.exec(V2_TABLES)
}

/** 무료 메일 도메인 — 회사 도메인 자동 추출에서 제외 */
const FREE_MAIL_DOMAINS = [
  'gmail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'kakao.com',
  'nate.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.kr',
  'icloud.com',
  'me.com'
]

/**
 * v1 → v2: contact → person + email_address + organization + business_card,
 * contact_tag → person_tag, draft_log → activity(draft). 옛 테이블은 삭제한다.
 * 사람 id는 contact id를 그대로 유지한다.
 */
function migrateV1toV2(db: Database.Database): void {
  // v1 안에서도 뒤늦게 추가된 컬럼이 없을 수 있다
  if (!columnExists(db, 'contact', 'card_image_path')) {
    db.exec(`ALTER TABLE contact ADD COLUMN card_image_path TEXT NOT NULL DEFAULT ''`)
  }
  db.exec(COMMON_TABLES)
  if (!columnExists(db, 'template', 'attachments')) {
    db.exec(`ALTER TABLE template ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS contact_tag (
      contact_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (contact_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS draft_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER, template_id INTEGER,
      contact_name TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
      template_name TEXT NOT NULL DEFAULT '', subject_rendered TEXT NOT NULL DEFAULT '',
      adapter TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)

  db.exec(V2_TABLES)

  // 회사: 같은 이름(공백 정리)끼리 1건
  db.exec(`
    INSERT OR IGNORE INTO organization (name)
    SELECT DISTINCT trim(company) FROM contact WHERE trim(company) <> ''
  `)

  // 사람: id 유지
  db.exec(`
    INSERT INTO person (id, name, organization_id, department, title, phone, mobile, address,
                        website, memo, created_at, updated_at)
    SELECT c.id, c.name, o.id, c.department, c.title, c.phone, c.mobile, c.address,
           c.website, c.memo, c.created_at, c.updated_at
    FROM contact c LEFT JOIN organization o ON o.name = trim(c.company)
  `)

  // 이메일: 대표 주소 1건. 다른 사람과 같은 주소여도 그대로 두고 병합 후보로 안내한다
  db.exec(`
    INSERT OR IGNORE INTO email_address (person_id, address, is_primary)
    SELECT id, lower(trim(email)), 1 FROM contact WHERE trim(email) <> ''
  `)

  // 회사 도메인: 소속 사람의 회사 주소 도메인 중 무료 메일이 아닌 첫 것
  const freeList = FREE_MAIL_DOMAINS.map((d) => `'${d}'`).join(',')
  db.exec(`
    UPDATE organization SET domain = COALESCE((
      SELECT substr(e.address, instr(e.address, '@') + 1)
      FROM email_address e JOIN person p ON p.id = e.person_id
      WHERE p.organization_id = organization.id
        AND instr(e.address, '@') > 0
        AND substr(e.address, instr(e.address, '@') + 1) NOT IN (${freeList})
      GROUP BY substr(e.address, instr(e.address, '@') + 1)
      ORDER BY COUNT(*) DESC LIMIT 1
    ), '')
  `)

  // 명함 이미지
  db.exec(`
    INSERT INTO business_card (person_id, image_path, received_at)
    SELECT id, card_image_path, created_at FROM contact WHERE trim(card_image_path) <> ''
  `)

  // 태그 연결
  db.exec(`
    INSERT OR IGNORE INTO person_tag (person_id, tag_id)
    SELECT ct.contact_id, ct.tag_id FROM contact_tag ct
    JOIN person p ON p.id = ct.contact_id JOIN tag t ON t.id = ct.tag_id
  `)

  // 활동: 명함 등록 → 초안 생성 순으로 타임라인 구성
  db.exec(`
    INSERT INTO activity (person_id, kind, person_name, summary, occurred_at)
    SELECT c.id, 'card', c.name, '명함 등록', c.created_at
    FROM contact c WHERE trim(c.card_image_path) <> ''
  `)
  db.exec(`
    INSERT INTO activity (person_id, kind, template_id, person_name, person_email,
                          template_name, summary, adapter, occurred_at)
    SELECT CASE WHEN p.id IS NULL THEN NULL ELSE d.contact_id END, 'draft',
           CASE WHEN t.id IS NULL THEN NULL ELSE d.template_id END,
           d.contact_name, d.contact_email, d.template_name, d.subject_rendered, d.adapter,
           d.created_at
    FROM draft_log d
    LEFT JOIN person p ON p.id = d.contact_id
    LEFT JOIN template t ON t.id = d.template_id
    ORDER BY d.id
  `)

  // 마지막 연락일 캐시
  db.exec(`
    UPDATE person SET last_contact_at = (
      SELECT MAX(occurred_at) FROM activity a WHERE a.person_id = person.id AND a.kind = 'draft'
    )
  `)

  db.exec(`
    DROP TABLE contact_tag;
    DROP TABLE draft_log;
    DROP TABLE contact;
  `)
}
