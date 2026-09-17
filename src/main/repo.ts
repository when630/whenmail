import { getDb } from './db'
import { pruneAttachments } from './attachments'
import {
  deleteAccountSecrets,
  deleteSecret,
  getSecret,
  hasSecret,
  secretKeys,
  setSecret
} from './credentials'
import { canReadKind } from './readers'
import { tokenCanRead } from './oauth'
import type {
  Account,
  AccountConfig,
  AccountInput,
  Activity,
  AppNotification,
  MailEntry,
  MailHeader,
  NotificationKind,
  NotificationStatus,
  AppSettings,
  BulkPersonPatch,
  BusinessCard,
  DraftAdapterKind,
  DuplicateGroup,
  DuplicatePolicy,
  EmailAddress,
  EmailTemplate,
  FollowUp,
  FollowUpInput,
  FollowUpStatus,
  ImportSummary,
  Organization,
  OrganizationInput,
  Person,
  PersonSequence,
  Sequence,
  SequenceInput,
  SequenceStep,
  TodoItem,
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

type PersonRow = Omit<Person, 'email' | 'emails' | 'cards' | 'tags' | 'awaiting_reply'>

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

  const cutoff = awaitingCutoff()
  return rows.map((r) => {
    const list = emailMap.get(r.id) ?? []
    return {
      ...r,
      emails: list,
      email: list.find((e) => e.is_primary)?.address ?? list[0]?.address ?? '',
      cards: cardMap.get(r.id) ?? [],
      tags: tagMap.get(r.id) ?? [],
      awaiting_reply: isAwaiting(r.last_outbound_at, r.last_inbound_at, cutoff)
    }
  })
}

/** 답장 대기 판정 기준 시각 — 이보다 전에 보냈는데 그 뒤 회신이 없으면 대기 */
function awaitingCutoff(): string {
  const days = getSettings().awaitingReplyDays
  const d = new Date(Date.now() - days * 86400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

function isAwaiting(lastOut: string | null, lastIn: string | null, cutoff: string): boolean {
  if (!lastOut) return false
  if (lastOut > cutoff) return false
  return !lastIn || lastIn < lastOut
}

/** 답장 대기 조건을 SQL로 (목록 필터용) */
const AWAITING_SQL = `p.last_outbound_at IS NOT NULL AND p.last_outbound_at <= @cutoff
  AND (p.last_inbound_at IS NULL OR p.last_inbound_at < p.last_outbound_at)`

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
  if (filter.awaitingReply) {
    where.push(AWAITING_SQL.replace(/@cutoff/g, '?'))
    params.push(awaitingCutoff())
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
  relinkMail(id)
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
  relinkMail(id)
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
    // mail_index·notification은 person을 ON DELETE CASCADE로 참조하므로
    // 원본 사람을 지우기 전에 옮겨야 기록이 사라지지 않는다
    db.prepare(`UPDATE mail_index SET person_id = ? WHERE person_id IN (${ph})`).run(
      targetId,
      ...sources
    )
    db.prepare(`UPDATE notification SET person_id = ? WHERE person_id IN (${ph})`).run(
      targetId,
      ...sources
    )
    db.prepare(`DELETE FROM person WHERE id IN (${ph})`).run(...sources)

    refreshContactTimes(targetId)
    db.prepare(`UPDATE person SET updated_at = datetime('now','localtime') WHERE id = ?`).run(
      targetId
    )

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
  accountId?: number | null
  summary: string
  adapter?: DraftAdapterKind
}): Activity {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO activity
       (person_id, kind, template_id, account_id, person_name, person_email, template_name, summary, adapter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.personId,
      entry.kind,
      entry.templateId ?? null,
      entry.accountId ?? null,
      entry.personName,
      entry.personEmail ?? '',
      entry.templateName ?? '',
      entry.summary,
      entry.adapter ?? ''
    )
  if (entry.kind === 'draft' && entry.personId) {
    db.prepare(
      `UPDATE person SET last_contact_at = datetime('now','localtime'),
         last_outbound_at = datetime('now','localtime') WHERE id = ?`
    ).run(entry.personId)
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

/* ────────────────────────── 계정 ────────────────────────── */

type AccountRow = Omit<
  Account,
  | 'signature_enabled'
  | 'default_cc_enabled'
  | 'default_bcc_enabled'
  | 'is_default'
  | 'config'
  | 'connected'
  | 'sync_enabled'
> & {
  signature_enabled: number
  default_cc_enabled: number
  default_bcc_enabled: number
  is_default: number
  config_json: string
  sync_enabled: number
}

function parseConfig(json: string): AccountConfig {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as AccountConfig) : {}
  } catch {
    return {}
  }
}

function rowToAccount(r: AccountRow): Account {
  const connected =
    r.kind === 'outlook_local'
      ? true
      : r.kind === 'imap'
        ? hasSecret(secretKeys.imap(r.id))
        : hasSecret(secretKeys.oauth(r.id))
  const canRead =
    !canReadKind(r.kind) || !connected
      ? false
      : r.kind === 'imap'
        ? true
        : tokenCanRead(r.kind as 'm365' | 'gmail', r.id)
  return {
    id: r.id,
    kind: r.kind,
    display_name: r.display_name,
    address: r.address,
    signature_html: r.signature_html,
    signature_enabled: Boolean(r.signature_enabled),
    default_cc: r.default_cc,
    default_cc_enabled: Boolean(r.default_cc_enabled),
    default_bcc: r.default_bcc,
    default_bcc_enabled: Boolean(r.default_bcc_enabled),
    is_default: Boolean(r.is_default),
    config: parseConfig(r.config_json),
    connected,
    can_read: canRead,
    sync_enabled: Boolean(r.sync_enabled),
    last_sync_at: r.last_sync_at,
    last_sync_error: r.last_sync_error,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

export function listAccounts(): Account[] {
  return (
    getDb().prepare('SELECT * FROM account ORDER BY is_default DESC, id').all() as AccountRow[]
  ).map(rowToAccount)
}

export function getAccount(id: number): Account | null {
  const row = getDb().prepare('SELECT * FROM account WHERE id = ?').get(id) as
    AccountRow | undefined
  return row ? rowToAccount(row) : null
}

/** 기본 계정 — 없으면 첫 계정 */
export function defaultAccount(): Account | null {
  const list = listAccounts()
  return list.find((a) => a.is_default) ?? list[0] ?? null
}

const ACCOUNT_KINDS = ['outlook_local', 'm365', 'gmail', 'imap'] as const

function accountValues(input: AccountInput): Record<string, string | number> {
  if (!ACCOUNT_KINDS.includes(input.kind)) throw new Error('알 수 없는 계정 종류입니다')
  const config: AccountConfig = { ...(input.config ?? {}) }
  if (input.kind === 'outlook_local') {
    config.outlookMode =
      config.outlookMode === 'com' || config.outlookMode === 'eml' ? config.outlookMode : 'auto'
  }
  if (input.kind === 'imap') {
    if (!normalizeText(config.imapHost)) throw new Error('IMAP 서버 주소를 입력하세요')
    config.imapHost = normalizeText(config.imapHost)
    config.imapUser = normalizeText(config.imapUser)
    config.imapDraftsPath = normalizeText(config.imapDraftsPath)
    config.imapPort = Number(config.imapPort) || (config.imapSecure === false ? 143 : 993)
  }
  const display = normalizeText(input.display_name) || normalizeText(input.address)
  if (!display) throw new Error('계정 이름을 입력하세요')
  return {
    kind: input.kind,
    display_name: display,
    address: normalizeText(input.address).toLowerCase(),
    signature_html: String(input.signature_html ?? ''),
    signature_enabled: input.signature_enabled === false ? 0 : 1,
    default_cc: normalizeText(input.default_cc),
    default_cc_enabled: input.default_cc_enabled === false ? 0 : 1,
    default_bcc: normalizeText(input.default_bcc),
    default_bcc_enabled: input.default_bcc_enabled === false ? 0 : 1,
    // 읽기를 못 하는 종류는 동기화를 켤 수 없다
    sync_enabled: input.sync_enabled && canReadKind(input.kind) ? 1 : 0,
    config_json: JSON.stringify(config)
  }
}

/** 비밀값 저장 — IMAP 비밀번호, 임시 OAuth 토큰을 계정 키로 옮기기 */
function saveAccountSecrets(id: number, input: AccountInput): void {
  if (input.kind === 'imap' && normalizeText(input.imapPassword)) {
    setSecret(secretKeys.imap(id), String(input.imapPassword))
  }
  if ((input.kind === 'm365' || input.kind === 'gmail') && input.pendingOAuthKey) {
    const token = getSecret(input.pendingOAuthKey)
    if (token) {
      setSecret(secretKeys.oauth(id), token)
      deleteSecret(input.pendingOAuthKey)
    }
  }
}

export function createAccount(input: AccountInput): Account {
  const db = getDb()
  const values = accountValues(input)
  const cols = Object.keys(values)
  const id = db.transaction(() => {
    const noAccounts = (db.prepare('SELECT COUNT(*) c FROM account').get() as { c: number }).c === 0
    const makeDefault = input.is_default || noAccounts
    const info = db
      .prepare(
        `INSERT INTO account (${cols.join(', ')}, is_default)
         VALUES (${cols.map((c) => `@${c}`).join(', ')}, @is_default)`
      )
      .run({ ...values, is_default: makeDefault ? 1 : 0 })
    const newId = Number(info.lastInsertRowid)
    if (makeDefault) db.prepare('UPDATE account SET is_default = 0 WHERE id <> ?').run(newId)
    return newId
  })()
  saveAccountSecrets(id, input)
  return getAccount(id)!
}

export function updateAccount(id: number, input: AccountInput): Account {
  const db = getDb()
  const existing = getAccount(id)
  if (!existing) throw new Error('계정을 찾을 수 없습니다')
  const fixed = { ...input, kind: existing.kind }
  const values = accountValues(fixed)
  const sets = Object.keys(values)
    .map((c) => `${c} = @${c}`)
    .join(', ')
  db.transaction(() => {
    db.prepare(
      `UPDATE account SET ${sets}, updated_at = datetime('now','localtime') WHERE id = @id`
    ).run({ ...values, id })
    if (input.is_default) {
      db.prepare('UPDATE account SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id)
    }
  })()
  saveAccountSecrets(id, fixed)
  return getAccount(id)!
}

export function deleteAccount(id: number): void {
  const db = getDb()
  db.transaction(() => {
    const wasDefault = getAccount(id)?.is_default
    db.prepare('DELETE FROM account WHERE id = ?').run(id)
    if (wasDefault) {
      const first = db.prepare('SELECT id FROM account ORDER BY id LIMIT 1').get() as
        { id: number } | undefined
      if (first) db.prepare('UPDATE account SET is_default = 1 WHERE id = ?').run(first.id)
    }
  })()
  deleteAccountSecrets(id)
}

/** 계정 동기화 결과 기록 */
export function markAccountSynced(id: number, error = ''): void {
  getDb()
    .prepare(
      `UPDATE account SET last_sync_at = datetime('now','localtime'), last_sync_error = ? WHERE id = ?`
    )
    .run(error, id)
}

export function setDefaultAccount(id: number): Account[] {
  getDb().prepare('UPDATE account SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id)
  return listAccounts()
}

/* ────────────────────────── 메일 인덱스 ────────────────────────── */

/** 주소 → 사람 매핑 (동기화에서 받은 헤더를 사람에 붙일 때 쓴다) */
export function addressOwners(): Map<string, { personId: number; emailId: number }> {
  const rows = getDb().prepare('SELECT id, person_id, address FROM email_address').all() as {
    id: number
    person_id: number
    address: string
  }[]
  return new Map(rows.map((r) => [r.address, { personId: r.person_id, emailId: r.id }]))
}

/** 동기화 대상 주소 — 등록된 사람의 모든 주소 (personId를 주면 그 사람만) */
export function syncAddresses(personId?: number): string[] {
  const db = getDb()
  const rows = personId
    ? (db
        .prepare('SELECT address FROM email_address WHERE person_id = ? ORDER BY is_primary DESC')
        .all(personId) as { address: string }[])
    : (db.prepare('SELECT address FROM email_address ORDER BY address').all() as {
        address: string
      }[])
  return rows.map((r) => r.address)
}

/** 헤더 저장 결과 — 새로 들어온 수와, 새 수신 메일이 생긴 사람들 */
export interface MailUpsertResult {
  added: number
  inbound: { personId: number; subject: string; messageId: string }[]
}

/** 헤더를 저장한다. 이미 있는 메시지는 건너뛴다 */
export function upsertMailHeaders(accountId: number, headers: MailHeader[]): MailUpsertResult {
  if (headers.length === 0) return { added: 0, inbound: [] }
  const db = getDb()
  const owners = addressOwners()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO mail_index
       (account_id, person_id, email_address_id, message_id, thread_id, direction,
        counterpart, subject, occurred_at, open_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const run = db.transaction((items: MailHeader[]): MailUpsertResult => {
    const result: MailUpsertResult = { added: 0, inbound: [] }
    for (const h of items) {
      if (!h.messageId || !h.occurredAt) continue
      const owner = owners.get(h.counterpart)
      const info = insert.run(
        accountId,
        owner?.personId ?? null,
        owner?.emailId ?? null,
        h.messageId,
        h.threadId,
        h.direction,
        h.counterpart,
        h.subject,
        h.occurredAt,
        h.openRef
      )
      if (info.changes === 0) continue
      result.added += 1
      if (h.direction === 'in' && owner) {
        result.inbound.push({
          personId: owner.personId,
          subject: h.subject,
          messageId: h.messageId
        })
      }
    }
    return result
  })
  return run(headers)
}

/** 사람의 메일 왕래 (최신순) */
export function listMail(personId: number, limit = 200): MailEntry[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.account_id AS accountId, COALESCE(a.display_name, '') AS accountName,
              m.message_id AS messageId, m.thread_id AS threadId, m.direction,
              m.counterpart, m.subject, m.occurred_at AS occurredAt, m.open_ref AS openRef
       FROM mail_index m LEFT JOIN account a ON a.id = m.account_id
       WHERE m.person_id = ? ORDER BY m.occurred_at DESC, m.id DESC LIMIT ?`
    )
    .all(personId, limit) as MailEntry[]
}

/**
 * 메일 인덱스와 초안 기록으로 사람의 연락 시각 캐시를 다시 계산한다.
 * personId를 주면 그 사람만, 없으면 전체.
 */
export function refreshContactTimes(personId?: number): void {
  const db = getDb()
  const where = personId ? 'WHERE person.id = @id' : ''
  const params = personId ? { id: personId } : {}
  db.prepare(
    `UPDATE person SET
       last_inbound_at = (
         SELECT MAX(occurred_at) FROM mail_index m
         WHERE m.person_id = person.id AND m.direction = 'in'),
       last_outbound_at = NULLIF(MAX(
         COALESCE((SELECT MAX(occurred_at) FROM mail_index m
                   WHERE m.person_id = person.id AND m.direction = 'out'), ''),
         COALESCE((SELECT MAX(occurred_at) FROM activity a
                   WHERE a.person_id = person.id AND a.kind = 'draft'), '')
       ), ''),
       last_contact_at = NULLIF(MAX(
         COALESCE((SELECT MAX(occurred_at) FROM mail_index m WHERE m.person_id = person.id), ''),
         COALESCE((SELECT MAX(occurred_at) FROM activity a
                   WHERE a.person_id = person.id AND a.kind = 'draft'), '')
       ), '')
     ${where}`
  ).run(params)
}

/** 사람의 주소로 이미 받아둔 메일을 그 사람에게 연결한다 (사람 추가·이메일 변경 후) */
export function relinkMail(personId: number): void {
  getDb()
    .prepare(
      `UPDATE mail_index SET
         person_id = (SELECT e.person_id FROM email_address e WHERE e.address = mail_index.counterpart),
         email_address_id = (SELECT e.id FROM email_address e WHERE e.address = mail_index.counterpart)
       WHERE counterpart IN (SELECT address FROM email_address WHERE person_id = ?)`
    )
    .run(personId)
  refreshContactTimes(personId)
}

/* ────────────────────────── 알림함 ────────────────────────── */

const NOTIFICATION_SELECT = `
  SELECT n.id, n.kind, n.person_id, COALESCE(p.name, '') AS person_name, n.account_id,
         n.follow_up_id, n.title, n.body, n.status, n.created_at, n.resolved_at
  FROM notification n LEFT JOIN person p ON p.id = n.person_id`

export function listNotifications(includeDone = false, limit = 200): AppNotification[] {
  const where = includeDone ? '' : `WHERE n.status <> 'done'`
  return getDb()
    .prepare(
      `${NOTIFICATION_SELECT} ${where}
       ORDER BY (n.status = 'unread') DESC, n.created_at DESC, n.id DESC LIMIT ?`
    )
    .all(limit) as AppNotification[]
}

export function unreadNotificationCount(): number {
  return (
    getDb().prepare(`SELECT COUNT(*) c FROM notification WHERE status = 'unread'`).get() as {
      c: number
    }
  ).c
}

/** 같은 사건이 두 번 쌓이지 않게 dedupe_key로 막는다. 새로 만들어졌으면 true */
export function pushNotification(entry: {
  kind: NotificationKind
  personId?: number | null
  accountId?: number | null
  followUpId?: number | null
  title: string
  body?: string
  dedupeKey: string
}): boolean {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notification
         (kind, person_id, account_id, follow_up_id, title, body, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.kind,
      entry.personId ?? null,
      entry.accountId ?? null,
      entry.followUpId ?? null,
      entry.title,
      entry.body ?? '',
      entry.dedupeKey
    )
  return info.changes > 0
}

export function setNotificationStatus(id: number, status: NotificationStatus): AppNotification[] {
  getDb()
    .prepare(
      `UPDATE notification SET status = ?,
         resolved_at = CASE WHEN ? = 'done' THEN datetime('now','localtime') ELSE resolved_at END
       WHERE id = ?`
    )
    .run(status, status, id)
  return listNotifications()
}

export function markAllNotificationsRead(): AppNotification[] {
  getDb().prepare(`UPDATE notification SET status = 'read' WHERE status = 'unread'`).run()
  return listNotifications()
}

/** 처리 완료한 알림을 지운다 (onlyDone=false면 전부) */
export function clearNotifications(onlyDone = true): AppNotification[] {
  getDb()
    .prepare(
      onlyDone ? `DELETE FROM notification WHERE status = 'done'` : 'DELETE FROM notification'
    )
    .run()
  return listNotifications()
}

/** 아직 열려 있는 답장 대기 알림이 붙은 사람들 */
export function openAwaitingPersonIds(): Set<number> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT person_id FROM notification
       WHERE kind = 'awaiting_reply' AND status <> 'done' AND person_id IS NOT NULL`
    )
    .all() as { person_id: number }[]
  return new Set(rows.map((r) => r.person_id))
}

/** 회신이 도착한 사람의 대기 알림을 자동으로 닫는다 */
export function closeAwaitingFor(personId: number): void {
  getDb()
    .prepare(
      `UPDATE notification SET status = 'done', resolved_at = datetime('now','localtime')
       WHERE person_id = ? AND kind = 'awaiting_reply' AND status <> 'done'`
    )
    .run(personId)
}

/** 답장 대기 중인 사람 (알림 생성용) */
export function awaitingReplyPeople(): Person[] {
  const rows = getDb()
    .prepare(`${PERSON_SELECT} WHERE ${AWAITING_SQL} ORDER BY p.last_outbound_at`)
    .all({ cutoff: awaitingCutoff() }) as PersonRow[]
  return hydrate(rows)
}

/* ────────────────────────── 후속 리마인더 ────────────────────────── */

const FOLLOW_UP_SELECT = `
  SELECT f.id, f.person_id, COALESCE(p.name, '') AS person_name,
         COALESCE(o.name, '') AS company,
         f.due_at, f.reason, f.note, f.status, f.auto_close_on_reply,
         f.template_id, COALESCE(t.name, '') AS template_name,
         f.sequence_id, COALESCE(sq.name, '') AS sequence_name, f.step_no,
         f.created_at, f.resolved_at,
         CASE WHEN f.due_at <= datetime('now','localtime') THEN 1 ELSE 0 END AS overdue
  FROM follow_up f
  LEFT JOIN person p ON p.id = f.person_id
  LEFT JOIN organization o ON o.id = p.organization_id
  LEFT JOIN template t ON t.id = f.template_id
  LEFT JOIN sequence sq ON sq.id = f.sequence_id`

type FollowUpRow = Omit<FollowUp, 'auto_close_on_reply' | 'overdue'> & {
  auto_close_on_reply: number
  overdue: number
}

function rowToFollowUp(r: FollowUpRow): FollowUp {
  return {
    ...r,
    auto_close_on_reply: Boolean(r.auto_close_on_reply),
    overdue: Boolean(r.overdue)
  }
}

export function listFollowUps(personId?: number, includeClosed = false): FollowUp[] {
  const where: string[] = []
  const params: (number | string)[] = []
  if (personId) {
    where.push('f.person_id = ?')
    params.push(personId)
  }
  if (!includeClosed) where.push(`f.status = 'open'`)
  const sql = `${FOLLOW_UP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (f.status = 'open') DESC, f.due_at`
  return (
    getDb()
      .prepare(sql)
      .all(...params) as FollowUpRow[]
  ).map(rowToFollowUp)
}

export function getFollowUp(id: number): FollowUp | null {
  const row = getDb().prepare(`${FOLLOW_UP_SELECT} WHERE f.id = ?`).get(id) as
    FollowUpRow | undefined
  return row ? rowToFollowUp(row) : null
}

/** 'YYYY-MM-DD'만 오면 그날 오전 9시로 본다 */
function normalizeDue(value: string): string {
  const v = normalizeText(value)
  if (!v) throw new Error('기한을 입력하세요')
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 09:00:00`
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return `${v}:00`
  return v
}

/** 오늘로부터 n일 뒤 (로컬) */
export function dueInDays(days: number): string {
  const d = new Date(Date.now() + Math.max(days, 0) * 86400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function createFollowUp(input: FollowUpInput): FollowUp {
  const db = getDb()
  if (!getPerson(input.personId)) throw new Error('사람을 찾을 수 없습니다')
  const info = db
    .prepare(
      `INSERT INTO follow_up (person_id, due_at, reason, note, template_id, auto_close_on_reply)
       VALUES (?, ?, 'manual', ?, ?, ?)`
    )
    .run(
      input.personId,
      normalizeDue(input.dueAt),
      normalizeText(input.note),
      input.templateId ?? null,
      input.autoCloseOnReply === false ? 0 : 1
    )
  return getFollowUp(Number(info.lastInsertRowid))!
}

export function setFollowUpStatus(id: number, status: FollowUpStatus): FollowUp | null {
  getDb()
    .prepare(
      `UPDATE follow_up SET status = ?,
         resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','localtime') END
       WHERE id = ?`
    )
    .run(status, status, id)
  // 이 후속으로 만들어진 알림도 함께 정리한다
  if (status !== 'open') {
    getDb()
      .prepare(
        `UPDATE notification SET status = 'done', resolved_at = datetime('now','localtime')
         WHERE follow_up_id = ? AND status <> 'done'`
      )
      .run(id)
  }
  return getFollowUp(id)
}

/** 기한을 미룬다. 이미 뜬 알림은 닫고 다음 기한에 다시 뜨게 한다 */
export function snoozeFollowUp(id: number, days: number): FollowUp | null {
  const db = getDb()
  db.prepare(
    `UPDATE follow_up SET due_at = ?, status = 'open', resolved_at = NULL WHERE id = ?`
  ).run(dueInDays(days), id)
  db.prepare(
    `UPDATE notification SET status = 'done', resolved_at = datetime('now','localtime')
     WHERE follow_up_id = ? AND status <> 'done'`
  ).run(id)
  return getFollowUp(id)
}

/** 기한이 된 열린 후속 */
export function dueFollowUps(): FollowUp[] {
  return (
    getDb()
      .prepare(
        `${FOLLOW_UP_SELECT} WHERE f.status = 'open' AND f.due_at <= datetime('now','localtime')
         ORDER BY f.due_at`
      )
      .all() as FollowUpRow[]
  ).map(rowToFollowUp)
}

/** 열린 후속이 걸린 사람 (전역 답장 대기 알림과 겹치지 않게 쓴다) */
export function openFollowUpPersonIds(): Set<number> {
  const rows = getDb()
    .prepare(`SELECT DISTINCT person_id FROM follow_up WHERE status = 'open'`)
    .all() as { person_id: number }[]
  return new Set(rows.map((r) => r.person_id))
}

/** 회신이 오면 자동 종료 대상인 후속을 닫는다. 닫힌 수를 반환 */
export function autoCloseFollowUps(personId: number): number {
  const db = getDb()
  const ids = db
    .prepare(
      `SELECT id FROM follow_up
       WHERE person_id = ? AND status = 'open' AND auto_close_on_reply = 1`
    )
    .all(personId) as { id: number }[]
  for (const { id } of ids) setFollowUpStatus(id, 'auto_closed')
  return ids.length
}

/* ────────────────────────── 할 일 ────────────────────────── */

/**
 * 할 일 목록 — 직접 건 후속(기한 순) + 규칙으로 잡힌 답장 대기.
 * 후속이 걸린 사람은 답장 대기에서 빼서 같은 사람이 두 번 보이지 않게 한다.
 */
export function listTodos(): TodoItem[] {
  const follows = listFollowUps()
  const covered = new Set(follows.map((f) => f.person_id))
  const items: TodoItem[] = follows.map((f) => ({
    kind: 'follow_up',
    key: `f-${f.id}`,
    personId: f.person_id,
    personName: f.person_name,
    company: f.company,
    at: f.due_at,
    overdue: f.overdue,
    note: f.note,
    templateId: f.template_id,
    templateName: f.template_name,
    sequenceName: f.sequence_name,
    stepNo: f.step_no,
    followUpId: f.id
  }))

  for (const p of awaitingReplyPeople()) {
    if (covered.has(p.id)) continue
    items.push({
      kind: 'awaiting',
      key: `a-${p.id}`,
      personId: p.id,
      personName: p.name,
      company: p.company,
      at: p.last_outbound_at ?? '',
      overdue: true,
      note: '',
      templateId: null,
      templateName: '',
      sequenceName: '',
      stepNo: null,
      followUpId: null
    })
  }
  // 기한이 지난 것 먼저, 그다음 기한 순
  return items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  })
}

/* ────────────────────────── 템플릿 시퀀스 ────────────────────────── */

export function listSequences(): Sequence[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM person_sequence ps
                    WHERE ps.sequence_id = s.id AND ps.status = 'running') AS running_count
       FROM sequence s ORDER BY s.name`
    )
    .all() as (Omit<Sequence, 'steps'> & { running_count: number })[]
  if (rows.length === 0) return []
  const ph = placeholders(rows.length)
  const steps = db
    .prepare(
      `SELECT st.id, st.sequence_id, st.step_no, st.template_id,
              COALESCE(t.name, '') AS template_name, st.delay_days, st.label
       FROM sequence_step st LEFT JOIN template t ON t.id = st.template_id
       WHERE st.sequence_id IN (${ph}) ORDER BY st.step_no`
    )
    .all(...rows.map((r) => r.id)) as (SequenceStep & { sequence_id: number })[]
  const byId = new Map<number, SequenceStep[]>()
  for (const st of steps) {
    const arr = byId.get(st.sequence_id) ?? []
    arr.push({
      id: st.id,
      step_no: st.step_no,
      template_id: st.template_id,
      template_name: st.template_name,
      delay_days: st.delay_days,
      label: st.label
    })
    byId.set(st.sequence_id, arr)
  }
  return rows.map((r) => ({ ...r, steps: byId.get(r.id) ?? [] }))
}

export function getSequence(id: number): Sequence | null {
  return listSequences().find((s) => s.id === id) ?? null
}

function saveSteps(sequenceId: number, input: SequenceInput): void {
  const db = getDb()
  db.prepare('DELETE FROM sequence_step WHERE sequence_id = ?').run(sequenceId)
  const insert = db.prepare(
    `INSERT INTO sequence_step (sequence_id, step_no, template_id, delay_days, label)
     VALUES (?, ?, ?, ?, ?)`
  )
  input.steps.forEach((step, i) => {
    insert.run(
      sequenceId,
      i + 1,
      step.template_id ?? null,
      // 1단계는 바로 시작하므로 지연이 없다
      i === 0 ? 0 : Math.max(Number(step.delay_days) || 0, 0),
      normalizeText(step.label)
    )
  })
}

export function createSequence(input: SequenceInput): Sequence {
  const db = getDb()
  const name = normalizeText(input.name)
  if (!name) throw new Error('시퀀스 이름을 입력하세요')
  if (!input.steps?.length) throw new Error('단계를 하나 이상 추가하세요')
  const id = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO sequence (name, memo) VALUES (?, ?)')
      .run(name, normalizeText(input.memo))
    const newId = Number(info.lastInsertRowid)
    saveSteps(newId, input)
    return newId
  })()
  return getSequence(id)!
}

export function updateSequence(id: number, input: SequenceInput): Sequence {
  const db = getDb()
  const name = normalizeText(input.name)
  if (!name) throw new Error('시퀀스 이름을 입력하세요')
  if (!input.steps?.length) throw new Error('단계를 하나 이상 추가하세요')
  db.transaction(() => {
    db.prepare(
      `UPDATE sequence SET name = ?, memo = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(name, normalizeText(input.memo), id)
    saveSteps(id, input)
  })()
  const seq = getSequence(id)
  if (!seq) throw new Error('시퀀스를 찾을 수 없습니다')
  return seq
}

export function deleteSequence(id: number): void {
  getDb().prepare('DELETE FROM sequence WHERE id = ?').run(id)
}

export function listPersonSequences(personId?: number): PersonSequence[] {
  const db = getDb()
  const where = personId ? 'WHERE ps.person_id = ?' : ''
  const params = personId ? [personId] : []
  return db
    .prepare(
      `SELECT ps.id, ps.person_id, COALESCE(p.name, '') AS person_name, ps.sequence_id,
              COALESCE(s.name, '') AS sequence_name, ps.done_steps,
              (SELECT COUNT(*) FROM sequence_step st WHERE st.sequence_id = ps.sequence_id) AS total_steps,
              ps.status, ps.started_at, ps.updated_at
       FROM person_sequence ps
       LEFT JOIN person p ON p.id = ps.person_id
       LEFT JOIN sequence s ON s.id = ps.sequence_id
       ${where}
       ORDER BY ps.updated_at DESC`
    )
    .all(...params) as PersonSequence[]
}

/** 시퀀스 1단계를 바로 할 일로 띄운다. 자동 전송은 없고 초안 만들기만 안내한다 */
export function startSequence(personId: number, sequenceId: number): PersonSequence {
  const db = getDb()
  const person = getPerson(personId)
  if (!person) throw new Error('사람을 찾을 수 없습니다')
  const seq = getSequence(sequenceId)
  if (!seq) throw new Error('시퀀스를 찾을 수 없습니다')
  if (seq.steps.length === 0) throw new Error('단계가 없는 시퀀스입니다')

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM person_sequence WHERE person_id = ? AND sequence_id = ?')
      .get(personId, sequenceId) as { id: number } | undefined
    if (existing) {
      db.prepare(
        `UPDATE person_sequence SET status = 'running', done_steps = 0,
           started_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
         WHERE id = ?`
      ).run(existing.id)
      // 진행 중이던 이 시퀀스의 후속은 정리하고 다시 시작한다
      db.prepare(
        `UPDATE follow_up SET status = 'canceled', resolved_at = datetime('now','localtime')
         WHERE person_id = ? AND sequence_id = ? AND status = 'open'`
      ).run(personId, sequenceId)
    } else {
      db.prepare('INSERT INTO person_sequence (person_id, sequence_id) VALUES (?, ?)').run(
        personId,
        sequenceId
      )
    }
    const first = seq.steps[0]
    db.prepare(
      `INSERT INTO follow_up (person_id, due_at, reason, note, template_id, sequence_id, step_no)
       VALUES (?, datetime('now','localtime'), 'sequence', ?, ?, ?, 1)`
    ).run(personId, first.label || `${seq.name} 1단계`, first.template_id, sequenceId)
  })()

  return listPersonSequences(personId).find((ps) => ps.sequence_id === sequenceId)!
}

export function stopSequence(personSequenceId: number): void {
  const db = getDb()
  const row = db
    .prepare('SELECT person_id, sequence_id FROM person_sequence WHERE id = ?')
    .get(personSequenceId) as { person_id: number; sequence_id: number } | undefined
  if (!row) return
  db.transaction(() => {
    db.prepare(
      `UPDATE person_sequence SET status = 'stopped', updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(personSequenceId)
    const ids = db
      .prepare(
        `SELECT id FROM follow_up WHERE person_id = ? AND sequence_id = ? AND status = 'open'`
      )
      .all(row.person_id, row.sequence_id) as { id: number }[]
    for (const { id } of ids) setFollowUpStatus(id, 'canceled')
  })()
}

/**
 * 후속을 처리했을 때 호출. 시퀀스 단계였으면 다음 단계를 예약한다.
 * 마지막 단계였으면 시퀀스를 완료로 바꾼다.
 */
export function completeFollowUp(id: number, sourceActivityId?: number): FollowUp | null {
  const db = getDb()
  const fu = getFollowUp(id)
  if (!fu) return null
  db.transaction(() => {
    db.prepare(
      `UPDATE follow_up SET status = 'done', resolved_at = datetime('now','localtime'),
         source_activity_id = COALESCE(?, source_activity_id) WHERE id = ?`
    ).run(sourceActivityId ?? null, id)
    db.prepare(
      `UPDATE notification SET status = 'done', resolved_at = datetime('now','localtime')
       WHERE follow_up_id = ? AND status <> 'done'`
    ).run(id)

    if (!fu.sequence_id || !fu.step_no) return
    const seq = getSequence(fu.sequence_id)
    const ps = db
      .prepare('SELECT id FROM person_sequence WHERE person_id = ? AND sequence_id = ?')
      .get(fu.person_id, fu.sequence_id) as { id: number } | undefined
    if (!seq || !ps) return
    db.prepare(
      `UPDATE person_sequence SET done_steps = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(fu.step_no, ps.id)

    const next = seq.steps.find((st) => st.step_no === fu.step_no! + 1)
    if (!next) {
      db.prepare(`UPDATE person_sequence SET status = 'done' WHERE id = ?`).run(ps.id)
      return
    }
    db.prepare(
      `INSERT INTO follow_up (person_id, due_at, reason, note, template_id, sequence_id, step_no)
       VALUES (?, ?, 'sequence', ?, ?, ?, ?)`
    ).run(
      fu.person_id,
      dueInDays(next.delay_days),
      next.label || `${seq.name} ${next.step_no}단계`,
      next.template_id,
      fu.sequence_id,
      next.step_no
    )
  })()
  return getFollowUp(id)
}

/* ────────────────────────── 설정 (연동 앱) ────────────────────────── */

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM setting').all() as {
    key: string
    value: string
  }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const days = Number(map.get('awaiting_reply_days'))
  return {
    msClientId: map.get('oauth_ms_client_id') ?? '',
    googleClientId: map.get('oauth_google_client_id') ?? '',
    hasGoogleClientSecret: hasSecret(secretKeys.googleClientSecret),
    awaitingReplyDays: Number.isFinite(days) && days > 0 ? days : 7,
    syncOnStartup: map.get('sync_on_startup') !== '0',
    followUpDays: Number(map.get('follow_up_days')) > 0 ? Number(map.get('follow_up_days')) : 7,
    followUpDefaultOn: map.get('follow_up_default_on') === '1'
  }
}

export function saveSettings(input: AppSettings): AppSettings {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    upsert.run('oauth_ms_client_id', normalizeText(input.msClientId))
    upsert.run('oauth_google_client_id', normalizeText(input.googleClientId))
    const days = Math.min(Math.max(Math.round(Number(input.awaitingReplyDays) || 7), 1), 90)
    upsert.run('awaiting_reply_days', String(days))
    upsert.run('sync_on_startup', input.syncOnStartup === false ? '0' : '1')
    const fu = Math.min(Math.max(Math.round(Number(input.followUpDays) || 7), 1), 365)
    upsert.run('follow_up_days', String(fu))
    upsert.run('follow_up_default_on', input.followUpDefaultOn ? '1' : '0')
  })()
  const secret = input.googleClientSecret
  if (secret === 'CLEAR') deleteSecret(secretKeys.googleClientSecret)
  else if (secret && secret.trim()) setSecret(secretKeys.googleClientSecret, secret.trim())
  return getSettings()
}

/** 어댑터가 쓰는 OAuth 클라이언트 정보 */
export function oauthClientFor(kind: 'm365' | 'gmail'): {
  clientId: string
  clientSecret?: string
} {
  const s = getSettings()
  if (kind === 'm365') return { clientId: s.msClientId }
  return {
    clientId: s.googleClientId,
    clientSecret: getSecret(secretKeys.googleClientSecret) ?? undefined
  }
}
