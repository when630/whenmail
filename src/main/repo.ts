import { getDb } from './db'
import { pruneAttachments } from './attachments'
import type {
  Activity,
  AppSettings,
  BulkPersonPatch,
  BusinessCard,
  DuplicateGroup,
  DuplicatePolicy,
  EmailAddress,
  EmailTemplate,
  ImportSummary,
  Organization,
  OrganizationInput,
  OutlookAdapter,
  Person,
  PersonFilter,
  PersonInput,
  TemplateAttachment,
  TemplateInput
} from '../shared/types'

/* ────────────────────────── 공통 ────────────────────────── */

const PERSON_FIELDS = [
  'name',
  'department',
  'title',
  'phone',
  'mobile',
  'address',
  'website',
  'memo'
] as const

type PersonRow = Omit<Person, 'email' | 'emails' | 'cards' | 'tags'>

function normalizeText(v: unknown): string {
  return String(v ?? '').trim()
}

function normalizeList(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))]
}

function normalizeEmails(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',')

/* ────────────────────────── 회사 ────────────────────────── */

const ORG_SELECT = `
  SELECT o.*, (SELECT COUNT(*) FROM person p WHERE p.organization_id = o.id) AS person_count
  FROM organization o`

export function listOrganizations(search?: string): Organization[] {
  const db = getDb()
  const q = normalizeText(search)
  if (q) {
    const like = `%${q}%`
    return db
      .prepare(
        `${ORG_SELECT} WHERE o.name LIKE ? OR o.domain LIKE ? OR o.memo LIKE ? ORDER BY o.name`
      )
      .all(like, like, like) as Organization[]
  }
  return db.prepare(`${ORG_SELECT} ORDER BY o.name`).all() as Organization[]
}

export function getOrganization(id: number): Organization | null {
  return (
    (getDb().prepare(`${ORG_SELECT} WHERE o.id = ?`).get(id) as Organization | undefined) ?? null
  )
}

/** 이름으로 회사를 찾거나 만든다. 빈 이름이면 null */
function ensureOrganization(name: string): number | null {
  const n = normalizeText(name)
  if (!n) return null
  const db = getDb()
  const found = db.prepare('SELECT id FROM organization WHERE name = ?').get(n) as
    { id: number } | undefined
  if (found) return found.id
  const info = db.prepare('INSERT INTO organization (name) VALUES (?)').run(n)
  return Number(info.lastInsertRowid)
}

/** 소속 사람이 없고 메모도 없는 회사는 정리한다 (사람 저장·삭제 후) */
function pruneOrganizations(): void {
  getDb()
    .prepare(
      `DELETE FROM organization
       WHERE memo = '' AND NOT EXISTS (SELECT 1 FROM person p WHERE p.organization_id = organization.id)`
    )
    .run()
}

export function updateOrganization(id: number, input: OrganizationInput): Organization {
  const db = getDb()
  const name = normalizeText(input.name)
  if (!name) throw new Error('회사 이름은 필수입니다')
  const clash = db
    .prepare('SELECT id FROM organization WHERE name = ? AND id <> ?')
    .get(name, id) as { id: number } | undefined
  if (clash)
    throw new Error(`'${name}' 회사가 이미 있습니다. 회사 화면에서 합치려면 사람을 옮겨 주세요`)
  db.prepare(
    `UPDATE organization SET name = ?, domain = ?, memo = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(name, normalizeText(input.domain).toLowerCase(), normalizeText(input.memo), id)
  const org = getOrganization(id)
  if (!org) throw new Error('회사를 찾을 수 없습니다')
  return org
}

/** 회사 삭제 — 소속 사람의 organization_id는 FK로 null이 된다 */
export function deleteOrganization(id: number): void {
  getDb().prepare('DELETE FROM organization WHERE id = ?').run(id)
}

/* ────────────────────────── 태그 ────────────────────────── */

function savePersonTags(personId: number, tags: string[] | undefined): void {
  const db = getDb()
  const names = normalizeList(tags)
  db.prepare('DELETE FROM person_tag WHERE person_id = ?').run(personId)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tag (name) VALUES (?)')
  const getTag = db.prepare('SELECT id FROM tag WHERE name = ?')
  const link = db.prepare('INSERT OR IGNORE INTO person_tag (person_id, tag_id) VALUES (?, ?)')
  for (const name of names) {
    insertTag.run(name)
    const t = getTag.get(name) as { id: number }
    link.run(personId, t.id)
  }
  pruneTags()
}

function pruneTags(): void {
  getDb().prepare('DELETE FROM tag WHERE id NOT IN (SELECT DISTINCT tag_id FROM person_tag)').run()
}

export function listTags(): { name: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT t.name, COUNT(pt.person_id) AS count FROM tag t
       JOIN person_tag pt ON pt.tag_id = t.id
       GROUP BY t.id ORDER BY count DESC, t.name`
    )
    .all() as { name: string; count: number }[]
}

/* ────────────────────────── 사람 ────────────────────────── */

const PERSON_SELECT = `
  SELECT p.*, COALESCE(o.name, '') AS company
  FROM person p LEFT JOIN organization o ON o.id = p.organization_id`

/** 조회된 사람들에 이메일·명함·태그를 붙인다 */
function hydrate(rows: PersonRow[]): Person[] {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)
  const ph = placeholders(ids.length)

  const emails = db
    .prepare(
      `SELECT id, person_id, address, is_primary, label FROM email_address
       WHERE person_id IN (${ph}) ORDER BY is_primary DESC, id`
    )
    .all(...ids) as {
    id: number
    person_id: number
    address: string
    is_primary: number
    label: string
  }[]
  const cards = db
    .prepare(
      `SELECT id, person_id, image_path, received_at FROM business_card
       WHERE person_id IN (${ph}) ORDER BY id`
    )
    .all(...ids) as (BusinessCard & { person_id: number })[]
  const tags = db
    .prepare(
      `SELECT pt.person_id, t.name FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
       WHERE pt.person_id IN (${ph}) ORDER BY t.name`
    )
    .all(...ids) as { person_id: number; name: string }[]

  const emailMap = new Map<number, EmailAddress[]>()
  for (const e of emails) {
    const arr = emailMap.get(e.person_id) ?? []
    arr.push({ id: e.id, address: e.address, is_primary: Boolean(e.is_primary), label: e.label })
    emailMap.set(e.person_id, arr)
  }
  const cardMap = new Map<number, BusinessCard[]>()
  for (const c of cards) {
    const arr = cardMap.get(c.person_id) ?? []
    arr.push({ id: c.id, image_path: c.image_path, received_at: c.received_at })
    cardMap.set(c.person_id, arr)
  }
  const tagMap = new Map<number, string[]>()
  for (const t of tags) {
    const arr = tagMap.get(t.person_id) ?? []
    arr.push(t.name)
    tagMap.set(t.person_id, arr)
  }

  return rows.map((r) => {
    const list = emailMap.get(r.id) ?? []
    return {
      ...r,
      emails: list,
      email: list.find((e) => e.is_primary)?.address ?? list[0]?.address ?? '',
      cards: cardMap.get(r.id) ?? [],
      tags: tagMap.get(r.id) ?? []
    }
  })
}

export function listPeople(filter: PersonFilter = {}): Person[] {
  const db = getDb()
  const where: string[] = []
  const params: (string | number)[] = []
  const search = normalizeText(filter.search)
  if (search) {
    const q = `%${search}%`
    where.push(`(p.name LIKE ? OR o.name LIKE ? OR p.title LIKE ? OR p.department LIKE ? OR p.memo LIKE ?
      OR EXISTS (SELECT 1 FROM email_address e WHERE e.person_id = p.id AND e.address LIKE ?)
      OR EXISTS (SELECT 1 FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
                 WHERE pt.person_id = p.id AND t.name LIKE ?))`)
    params.push(q, q, q, q, q, q, q)
  }
  const tag = normalizeText(filter.tag)
  if (tag) {
    where.push(`EXISTS (SELECT 1 FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
                WHERE pt.person_id = p.id AND t.name = ?)`)
    params.push(tag)
  }
  if (filter.organizationId) {
    where.push('p.organization_id = ?')
    params.push(filter.organizationId)
  }
  const sql = `${PERSON_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name`
  return hydrate(db.prepare(sql).all(...params) as PersonRow[])
}

export function getPeople(ids: number[]): Person[] {
  if (ids.length === 0) return []
  const rows = getDb()
    .prepare(`${PERSON_SELECT} WHERE p.id IN (${placeholders(ids.length)})`)
    .all(...ids) as PersonRow[]
  // 요청 순서 유지
  const byId = new Map(hydrate(rows).map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p))
}

export function getPerson(id: number): Person | null {
  return getPeople([id])[0] ?? null
}

function saveEmails(personId: number, emails: string[]): void {
  const db = getDb()
  const wanted = normalizeEmails(emails)
  const existing = db
    .prepare('SELECT id, address FROM email_address WHERE person_id = ?')
    .all(personId) as { id: number; address: string }[]
  const keep = new Set(wanted)
  for (const e of existing) {
    if (!keep.has(e.address)) db.prepare('DELETE FROM email_address WHERE id = ?').run(e.id)
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO email_address (person_id, address, is_primary) VALUES (?, ?, 0)'
  )
  for (const address of wanted) insert.run(personId, address)
  db.prepare('UPDATE email_address SET is_primary = 0 WHERE person_id = ?').run(personId)
  if (wanted[0]) {
    db.prepare('UPDATE email_address SET is_primary = 1 WHERE person_id = ? AND address = ?').run(
      personId,
      wanted[0]
    )
  }
}

function saveCards(personId: number, personName: string, input: PersonInput): void {
  const db = getDb()
  for (const id of input.remove_card_ids ?? []) {
    db.prepare('DELETE FROM business_card WHERE id = ? AND person_id = ?').run(id, personId)
  }
  const insert = db.prepare('INSERT INTO business_card (person_id, image_path) VALUES (?, ?)')
  for (const p of normalizeList(input.new_card_paths)) {
    insert.run(personId, p)
    insertActivity({ personId, kind: 'card', personName, summary: '명함 등록' })
  }
}

function personValues(input: PersonInput): Record<string, string | number | null> {
  const row: Record<string, string | number | null> = {}
  for (const f of PERSON_FIELDS) row[f] = normalizeText(input[f])
  row.organization_id = ensureOrganization(input.company)
  return row
}

export function createPerson(input: PersonInput): Person {
  const db = getDb()
  if (!normalizeText(input.name)) throw new Error('이름은 필수입니다')
  const run = db.transaction(() => {
    const row = personValues(input)
    const cols = [...PERSON_FIELDS, 'organization_id']
    const info = db
      .prepare(
        `INSERT INTO person (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
      )
      .run(row)
    const id = Number(info.lastInsertRowid)
    saveEmails(id, input.emails)
    savePersonTags(id, input.tags)
    saveCards(id, String(row.name), input)
    return id
  })
  const id = run()
  return getPerson(id)!
}

export function updatePerson(id: number, input: PersonInput): Person {
  const db = getDb()
  if (!normalizeText(input.name)) throw new Error('이름은 필수입니다')
  db.transaction(() => {
    const row = personValues(input)
    const sets = [...PERSON_FIELDS, 'organization_id'].map((f) => `${f} = @${f}`).join(', ')
    db.prepare(
      `UPDATE person SET ${sets}, updated_at = datetime('now','localtime') WHERE id = @id`
    ).run({ ...row, id })
    saveEmails(id, input.emails)
    savePersonTags(id, input.tags)
    saveCards(id, String(row.name), input)
    pruneOrganizations()
  })()
  const person = getPerson(id)
  if (!person) throw new Error('사람을 찾을 수 없습니다')
  return person
}

export function deletePerson(id: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM person WHERE id = ?').run(id)
    pruneTags()
    pruneOrganizations()
  })()
}

/** 여러 사람을 한 트랜잭션으로 삭제. 실제 삭제된 수를 반환 */
export function deletePeople(ids: number[]): number {
  if (ids.length === 0) return 0
  const db = getDb()
  const run = db.transaction((targets: number[]) => {
    const info = db
      .prepare(`DELETE FROM person WHERE id IN (${placeholders(targets.length)})`)
      .run(...targets)
    pruneTags()
    pruneOrganizations()
    return info.changes
  })
  return run(ids)
}

const BULK_FIELDS = ['company', 'department', 'title', 'phone', 'address', 'website'] as const

/**
 * 여러 사람에 공통 값을 일괄 적용. 지정된 필드만 덮어쓰고 태그는 추가/제거/교체.
 * 한 트랜잭션으로 처리하며 수정된 사람 수를 반환한다.
 */
export function bulkUpdatePeople(ids: number[], patch: BulkPersonPatch): number {
  if (ids.length === 0) return 0
  const db = getDb()
  const fields = BULK_FIELDS.filter((f) => patch.fields[f] !== undefined)
  const tagPatch = patch.tags
  if (fields.length === 0 && !tagPatch) return 0

  const plain = fields.filter((f) => f !== 'company')
  const update =
    plain.length > 0
      ? db.prepare(
          `UPDATE person SET ${plain.map((f) => `${f} = @${f}`).join(', ')},
           updated_at = datetime('now','localtime') WHERE id = @id`
        )
      : null
  const setOrg = db.prepare(
    `UPDATE person SET organization_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  )
  const touch = db.prepare(
    `UPDATE person SET updated_at = datetime('now','localtime') WHERE id = ?`
  )
  const values: Record<string, string> = {}
  for (const f of plain) values[f] = normalizeText(patch.fields[f])
  const patchTags = normalizeList(tagPatch?.values)
  const orgId = fields.includes('company')
    ? ensureOrganization(patch.fields.company ?? '')
    : undefined

  const run = db.transaction((targets: number[]) => {
    const existing = getPeople(targets)
    for (const p of existing) {
      if (update) update.run({ ...values, id: p.id })
      if (orgId !== undefined) setOrg.run(orgId, p.id)
      if (tagPatch) {
        let next: string[]
        if (tagPatch.mode === 'replace') next = patchTags
        else if (tagPatch.mode === 'remove') next = p.tags.filter((t) => !patchTags.includes(t))
        else next = [...p.tags, ...patchTags]
        savePersonTags(p.id, next)
        if (!update && orgId === undefined) touch.run(p.id)
      }
    }
    pruneOrganizations()
    return existing.length
  })
  return run(ids)
}

/** 최근 초안을 보낸 사람 우선, 그다음 최근 수정 */
export function recentPeople(limit = 5): Person[] {
  const rows = getDb()
    .prepare(
      `${PERSON_SELECT}
       ORDER BY (p.last_contact_at IS NULL), p.last_contact_at DESC, p.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as PersonRow[]
  return hydrate(rows)
}

/** 주소로 사람 찾기 (가져오기 중복 판정용) */
function findPersonByEmail(address: string): number | null {
  const row = getDb()
    .prepare('SELECT person_id FROM email_address WHERE address = ? LIMIT 1')
    .get(address.trim().toLowerCase()) as { person_id: number } | undefined
  return row?.person_id ?? null
}

/** 일괄 가져오기 — 이메일이 하나라도 겹치면 같은 사람으로 판정. 트랜잭션으로 처리 */
export function importPeople(rows: PersonInput[], policy: DuplicatePolicy): ImportSummary {
  const db = getDb()
  const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, invalid: 0 }

  const run = db.transaction((items: PersonInput[]) => {
    for (const item of items) {
      if (!normalizeText(item.name)) {
        summary.invalid += 1
        continue
      }
      const emails = normalizeEmails(item.emails)
      let existingId: number | null = null
      for (const e of emails) {
        existingId = findPersonByEmail(e)
        if (existingId) break
      }
      if (existingId) {
        if (policy === 'overwrite') {
          const current = getPerson(existingId)
          // 파일에 태그 열이 없으면 기존 태그를 지우지 않고 유지.
          // 이메일은 합집합이되 기존 대표 주소는 그대로 대표로 남긴다
          const tags = item.tags?.length ? item.tags : (current?.tags ?? [])
          const existingEmails = current?.emails.map((e) => e.address) ?? []
          const merged = [...(current?.email ? [current.email] : []), ...emails, ...existingEmails]
          updatePerson(existingId, { ...item, emails: merged, tags })
          summary.updated += 1
        } else {
          summary.skipped += 1
        }
        continue
      }
      createPerson({ ...item, emails })
      summary.inserted += 1
    }
  })
  run(rows)
  return summary
}

/* ────────────────────────── 중복·병합 ────────────────────────── */

export function findDuplicates(): DuplicateGroup[] {
  const db = getDb()
  const groups: DuplicateGroup[] = []
  const seen = new Set<string>()

  const byEmail = db
    .prepare(
      `SELECT address, GROUP_CONCAT(DISTINCT person_id) AS ids FROM email_address
       GROUP BY address HAVING COUNT(DISTINCT person_id) > 1`
    )
    .all() as { address: string; ids: string }[]
  for (const g of byEmail) {
    const ids = g.ids
      .split(',')
      .map(Number)
      .sort((a, b) => a - b)
    const key = ids.join('-')
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({ key, reason: 'email', value: g.address, people: getPeople(ids) })
  }

  const byName = db
    .prepare(
      `SELECT p.name, COALESCE(o.name, '') AS company, GROUP_CONCAT(p.id) AS ids
       FROM person p LEFT JOIN organization o ON o.id = p.organization_id
       WHERE trim(p.name) <> ''
       GROUP BY lower(trim(p.name)), p.organization_id HAVING COUNT(*) > 1`
    )
    .all() as { name: string; company: string; ids: string }[]
  for (const g of byName) {
    const ids = g.ids
      .split(',')
      .map(Number)
      .sort((a, b) => a - b)
    const key = ids.join('-')
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      key,
      reason: 'name_company',
      value: g.company ? `${g.name} · ${g.company}` : g.name,
      people: getPeople(ids)
    })
  }
  return groups
}

/**
 * sourceIds를 targetId에 합친다. 대상의 값은 유지하고 빈 필드만 원본에서 채운다.
 * 이메일·명함·태그·활동은 합집합으로 옮기고 원본은 삭제한다.
 */
export function mergePeople(targetId: number, sourceIds: number[]): Person {
  const db = getDb()
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId)
  if (sources.length === 0) throw new Error('합칠 사람을 선택하세요')

  db.transaction(() => {
    const target = getPerson(targetId)
    if (!target) throw new Error('대상 사람을 찾을 수 없습니다')
    const others = getPeople(sources)
    if (others.length === 0) throw new Error('합칠 사람을 찾을 수 없습니다')

    // 빈 필드 보충
    const fill: Record<string, string | number | null> = {}
    for (const f of PERSON_FIELDS) {
      if (!target[f]) {
        const v = others.map((o) => o[f]).find(Boolean)
        if (v) fill[f] = v
      }
    }
    if (!target.organization_id) {
      const org = others.map((o) => o.organization_id).find((v) => v !== null)
      if (org) fill.organization_id = org
    }
    if (Object.keys(fill).length > 0) {
      const sets = Object.keys(fill)
        .map((k) => `${k} = @${k}`)
        .join(', ')
      db.prepare(`UPDATE person SET ${sets} WHERE id = @id`).run({ ...fill, id: targetId })
    }

    // 이메일: 대상의 대표는 유지, 나머지는 추가
    const addEmail = db.prepare(
      'INSERT OR IGNORE INTO email_address (person_id, address, is_primary, label) VALUES (?, ?, 0, ?)'
    )
    for (const o of others) for (const e of o.emails) addEmail.run(targetId, e.address, e.label)
    if (target.emails.length === 0) {
      const first = db
        .prepare('SELECT id FROM email_address WHERE person_id = ? ORDER BY id LIMIT 1')
        .get(targetId) as { id: number } | undefined
      if (first) db.prepare('UPDATE email_address SET is_primary = 1 WHERE id = ?').run(first.id)
    }

    const ph = placeholders(sources.length)
    db.prepare(`UPDATE business_card SET person_id = ? WHERE person_id IN (${ph})`).run(
      targetId,
      ...sources
    )
    db.prepare(
      `INSERT OR IGNORE INTO person_tag (person_id, tag_id)
       SELECT ?, tag_id FROM person_tag WHERE person_id IN (${ph})`
    ).run(targetId, ...sources)
    db.prepare(`UPDATE activity SET person_id = ? WHERE person_id IN (${ph})`).run(
      targetId,
      ...sources
    )
    db.prepare(`DELETE FROM person WHERE id IN (${ph})`).run(...sources)

    db.prepare(
      `UPDATE person SET
         last_contact_at = (SELECT MAX(occurred_at) FROM activity a WHERE a.person_id = ? AND a.kind = 'draft'),
         updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(targetId, targetId)

    insertActivity({
      personId: targetId,
      kind: 'merge',
      personName: target.name,
      summary: `${others.map((o) => o.name).join(', ')} 병합 (${others.length}명)`
    })
    pruneTags()
    pruneOrganizations()
  })()

  return getPerson(targetId)!
}

/* ────────────────────────── 활동 ────────────────────────── */

export function insertActivity(entry: {
  personId: number | null
  kind: Activity['kind']
  personName: string
  personEmail?: string
  templateId?: number | null
  templateName?: string
  summary: string
  adapter?: OutlookAdapter
}): Activity {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO activity
       (person_id, kind, template_id, person_name, person_email, template_name, summary, adapter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.personId,
      entry.kind,
      entry.templateId ?? null,
      entry.personName,
      entry.personEmail ?? '',
      entry.templateName ?? '',
      entry.summary,
      entry.adapter ?? ''
    )
  if (entry.kind === 'draft' && entry.personId) {
    db.prepare(`UPDATE person SET last_contact_at = datetime('now','localtime') WHERE id = ?`).run(
      entry.personId
    )
  }
  return db
    .prepare('SELECT * FROM activity WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as Activity
}

export function listActivities(personId?: number, limit = 300): Activity[] {
  const db = getDb()
  if (personId) {
    return db
      .prepare(
        'SELECT * FROM activity WHERE person_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?'
      )
      .all(personId, limit) as Activity[]
  }
  return db
    .prepare('SELECT * FROM activity ORDER BY occurred_at DESC, id DESC LIMIT ?')
    .all(limit) as Activity[]
}

export function addNote(personId: number, text: string): Activity {
  const body = normalizeText(text)
  if (!body) throw new Error('메모 내용을 입력하세요')
  const person = getPerson(personId)
  if (!person) throw new Error('사람을 찾을 수 없습니다')
  return insertActivity({ personId, kind: 'note', personName: person.name, summary: body })
}

export function deleteActivity(id: number): void {
  getDb().prepare('DELETE FROM activity WHERE id = ?').run(id)
}

/* ────────────────────────── 템플릿 ────────────────────────── */

type TemplateRow = Omit<EmailTemplate, 'attachments'> & { attachments: string }

function parseAttachments(json: string): TemplateAttachment[] {
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((a) => a && typeof a.path === 'string' && typeof a.name === 'string')
      .map((a) => ({ name: a.name, path: a.path, size: Number(a.size) || 0 }))
  } catch {
    return []
  }
}

function rowToTemplate(row: TemplateRow): EmailTemplate {
  return { ...row, attachments: parseAttachments(row.attachments) }
}

function serializeAttachments(list: TemplateAttachment[] | undefined): string {
  return JSON.stringify(
    (list ?? []).map((a) => ({ name: a.name, path: a.path, size: Number(a.size) || 0 }))
  )
}

/** 모든 템플릿이 참조하는 첨부 경로로 앱 데이터 폴더의 첨부 파일을 정리 */
function pruneTemplateAttachments(): void {
  const rows = getDb().prepare('SELECT attachments FROM template').all() as {
    attachments: string
  }[]
  pruneAttachments(rows.flatMap((r) => parseAttachments(r.attachments).map((a) => a.path)))
}

export function listTemplates(): EmailTemplate[] {
  return (
    getDb()
      .prepare('SELECT * FROM template ORDER BY last_used_at DESC NULLS LAST, updated_at DESC')
      .all() as TemplateRow[]
  ).map(rowToTemplate)
}

export function getTemplate(id: number): EmailTemplate | undefined {
  const row = getDb().prepare('SELECT * FROM template WHERE id = ?').get(id) as
    TemplateRow | undefined
  return row ? rowToTemplate(row) : undefined
}

export function createTemplate(input: TemplateInput): EmailTemplate {
  const db = getDb()
  if (!input.name?.trim()) throw new Error('템플릿 이름은 필수입니다')
  const info = db
    .prepare('INSERT INTO template (name, subject_tpl, body_tpl, attachments) VALUES (?, ?, ?, ?)')
    .run(
      input.name.trim(),
      input.subject_tpl ?? '',
      input.body_tpl ?? '',
      serializeAttachments(input.attachments)
    )
  pruneTemplateAttachments()
  return getTemplate(Number(info.lastInsertRowid))!
}

export function updateTemplate(id: number, input: TemplateInput): EmailTemplate {
  const db = getDb()
  if (!input.name?.trim()) throw new Error('템플릿 이름은 필수입니다')
  db.prepare(
    `UPDATE template SET name = ?, subject_tpl = ?, body_tpl = ?, attachments = ?,
     updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(
    input.name.trim(),
    input.subject_tpl ?? '',
    input.body_tpl ?? '',
    serializeAttachments(input.attachments),
    id
  )
  pruneTemplateAttachments()
  return getTemplate(id)!
}

export function deleteTemplate(id: number): void {
  getDb().prepare('DELETE FROM template WHERE id = ?').run(id)
  pruneTemplateAttachments()
}

export function touchTemplateUsed(id: number): void {
  getDb()
    .prepare(`UPDATE template SET last_used_at = datetime('now','localtime') WHERE id = ?`)
    .run(id)
}

/* ────────────────────────── 설정 ────────────────────────── */

const DEFAULT_SETTINGS: AppSettings = {
  outlookMode: 'auto',
  signatureHtml: '',
  signatureEnabled: true,
  defaultCc: '',
  defaultCcEnabled: true,
  defaultBcc: '',
  defaultBccEnabled: true
}

/** '1'/'0'로 저장된 불리언 설정. 값이 없으면 기본값 */
const flag = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : v === '1'

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM setting').all() as {
    key: string
    value: string
  }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const mode = map.get('outlook_mode')
  return {
    outlookMode: mode === 'com' || mode === 'eml' ? mode : DEFAULT_SETTINGS.outlookMode,
    signatureHtml: map.get('signature_html') ?? DEFAULT_SETTINGS.signatureHtml,
    signatureEnabled: flag(map.get('signature_enabled'), DEFAULT_SETTINGS.signatureEnabled),
    defaultCc: map.get('default_cc') ?? DEFAULT_SETTINGS.defaultCc,
    defaultCcEnabled: flag(map.get('default_cc_enabled'), DEFAULT_SETTINGS.defaultCcEnabled),
    defaultBcc: map.get('default_bcc') ?? DEFAULT_SETTINGS.defaultBcc,
    defaultBccEnabled: flag(map.get('default_bcc_enabled'), DEFAULT_SETTINGS.defaultBccEnabled)
  }
}

export function saveSettings(input: AppSettings): AppSettings {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const mode =
    input.outlookMode === 'com' || input.outlookMode === 'eml' ? input.outlookMode : 'auto'
  db.transaction(() => {
    upsert.run('outlook_mode', mode)
    upsert.run('signature_html', String(input.signatureHtml ?? ''))
    upsert.run('signature_enabled', input.signatureEnabled === false ? '0' : '1')
    upsert.run('default_cc', String(input.defaultCc ?? '').trim())
    upsert.run('default_cc_enabled', input.defaultCcEnabled === false ? '0' : '1')
    upsert.run('default_bcc', String(input.defaultBcc ?? '').trim())
    upsert.run('default_bcc_enabled', input.defaultBccEnabled === false ? '0' : '1')
  })()
  return getSettings()
}
