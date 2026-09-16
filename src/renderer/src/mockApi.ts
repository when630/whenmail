import type { WhenmailApi } from '../../shared/api'
import type {
  Account,
  AccountInput,
  Activity,
  AppNotification,
  AppSettings,
  DuplicateGroup,
  EmailTemplate,
  MailEntry,
  Organization,
  Person,
  PersonInput,
  SyncState
} from '../../shared/types'

/**
 * preload 없이(순수 브라우저에서) 렌더러를 열었을 때만 활성화되는 목 API.
 * UI 개발·디자인 확인용이며, Electron 안에서는 preload의 실제 API가 우선한다.
 */
export function installMockApiIfNeeded(): void {
  if (typeof window === 'undefined' || window.api) return

  const now = '2026-09-01 10:00:00'
  const orgs: Organization[] = [
    {
      id: 1,
      name: '한빛물산',
      domain: 'hanbit.example',
      memo: '연 2회 정기 발주. 구매팀 통해 견적 진행',
      person_count: 2,
      created_at: now,
      updated_at: now
    },
    {
      id: 2,
      name: '대성테크',
      domain: 'daesung.example',
      memo: '',
      person_count: 1,
      created_at: now,
      updated_at: now
    },
    {
      id: 3,
      name: '미래로지스',
      domain: '',
      memo: '',
      person_count: 1,
      created_at: now,
      updated_at: now
    }
  ]

  const base = {
    department: '',
    phone: '',
    mobile: '',
    address: '',
    website: '',
    memo: '',
    cards: [],
    tags: [],
    last_contact_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    awaiting_reply: false,
    created_at: now,
    updated_at: now
  }
  let people: Person[] = [
    {
      ...base,
      id: 1,
      name: '김서연',
      organization_id: 1,
      company: '한빛물산',
      department: '구매팀',
      title: '팀장',
      email: 'sy.kim@hanbit.example',
      emails: [
        { id: 1, address: 'sy.kim@hanbit.example', is_primary: true, label: '회사' },
        { id: 2, address: 'seoyeon.kim@gmail.example', is_primary: false, label: '개인' }
      ],
      phone: '02-1234-5678',
      mobile: '010-1234-5678',
      address: '서울 중구',
      memo: '9월 전시회에서 인사',
      cards: [{ id: 1, image_path: '/mock/card1.png', received_at: now }],
      tags: ['전시회', 'VIP'],
      last_contact_at: '2026-09-10 14:20:00',
      last_outbound_at: '2026-09-10 14:20:00',
      last_inbound_at: '2026-09-02 09:00:00',
      awaiting_reply: true
    },
    {
      ...base,
      id: 2,
      name: '박준호',
      organization_id: 2,
      company: '대성테크',
      title: '대표',
      email: 'jh.park@daesung.example',
      emails: [{ id: 3, address: 'jh.park@daesung.example', is_primary: true, label: '' }],
      mobile: '010-9876-5432',
      website: 'daesung.example',
      tags: ['협력사']
    },
    {
      ...base,
      id: 3,
      name: '이하은',
      organization_id: 3,
      company: '미래로지스',
      department: '영업본부',
      title: '과장',
      email: '',
      emails: [],
      phone: '031-555-0100',
      memo: '이메일 미확보'
    },
    {
      ...base,
      id: 4,
      name: '김서연',
      organization_id: 1,
      company: '한빛물산',
      title: '',
      email: 'sy.kim@hanbit.example',
      emails: [{ id: 4, address: 'sy.kim@hanbit.example', is_primary: true, label: '' }],
      memo: 'CSV 가져오기로 중복 생성된 예시'
    }
  ]
  const templates: EmailTemplate[] = [
    {
      id: 1,
      name: '첫 인사 메일',
      subject_tpl: '[{{회사|whenmail}}] {{이름}}님, 반갑습니다',
      body_tpl:
        '{{이름|고객}}님, 안녕하세요.\n\n지난 미팅에서 인사드린 whenmail입니다.\n{{회사|귀사}}의 {{직함|담당자}}님께 도움이 될 자료를 보내드립니다.\n\n감사합니다.',
      attachments: [{ name: '회사소개서.pdf', path: '/mock/att/회사소개서.pdf', size: 1843200 }],
      last_used_at: now,
      created_at: now,
      updated_at: now
    },
    {
      id: 2,
      name: '자료 송부',
      subject_tpl: '{{이름}}님, 요청하신 자료 보내드립니다',
      body_tpl: '{{이름}}님,\n\n요청하신 자료를 첨부합니다. 확인 후 회신 부탁드립니다.',
      attachments: [],
      last_used_at: null,
      created_at: now,
      updated_at: now
    }
  ]
  let activities: Activity[] = [
    {
      id: 1,
      person_id: 1,
      kind: 'draft',
      template_id: 1,
      account_id: 1,
      person_name: '김서연',
      person_email: 'sy.kim@hanbit.example',
      template_name: '첫 인사 메일',
      summary: '[한빛물산] 김서연님, 반갑습니다',
      adapter: 'com',
      occurred_at: '2026-09-10 14:20:00'
    },
    {
      id: 2,
      person_id: 1,
      kind: 'note',
      template_id: null,
      account_id: null,
      person_name: '김서연',
      person_email: '',
      template_name: '',
      summary: '9/20 오후 미팅 예정, 견적서 준비',
      adapter: '',
      occurred_at: '2026-09-08 09:10:00'
    },
    {
      id: 3,
      person_id: 1,
      kind: 'card',
      template_id: null,
      account_id: null,
      person_name: '김서연',
      person_email: '',
      template_name: '',
      summary: '명함 등록',
      adapter: '',
      occurred_at: now
    },
    {
      id: 4,
      person_id: 2,
      kind: 'draft',
      template_id: 2,
      account_id: 2,
      person_name: '박준호',
      person_email: 'jh.park@daesung.example',
      template_name: '자료 송부',
      summary: '박준호님, 요청하신 자료 보내드립니다',
      adapter: 'eml',
      occurred_at: '2026-09-02 11:00:00'
    }
  ]
  let settings: AppSettings = {
    msClientId: '3f2c1a7e-0000-0000-0000-abcdef123456',
    googleClientId: '',
    hasGoogleClientSecret: false,
    awaitingReplyDays: 7,
    syncOnStartup: true
  }
  const accountBase = {
    signature_enabled: true,
    default_bcc: '',
    default_bcc_enabled: false,
    connected: true,
    can_read: false,
    sync_enabled: false,
    last_sync_at: null,
    last_sync_error: '',
    created_at: now,
    updated_at: now
  }
  let accounts: Account[] = [
    {
      ...accountBase,
      id: 1,
      kind: 'outlook_local',
      display_name: '회사 Outlook',
      address: 'me@hanbit.example',
      signature_html: '<p>홍길동 | 영업팀 과장</p>',
      default_cc: 'team@whenmail.example',
      default_cc_enabled: true,
      is_default: true,
      config: { outlookMode: 'auto' }
    },
    {
      ...accountBase,
      id: 2,
      kind: 'm365',
      display_name: '회사 Microsoft 365',
      address: 'hong@company.example',
      signature_html: '',
      default_cc: '',
      default_cc_enabled: false,
      is_default: false,
      can_read: true,
      sync_enabled: true,
      last_sync_at: '2026-09-16 15:40:00',
      config: {}
    },
    {
      ...accountBase,
      id: 3,
      kind: 'gmail',
      display_name: '개인 Gmail',
      address: 'hong.personal@gmail.example',
      signature_html: '<p>홍길동</p>',
      default_cc: '',
      default_cc_enabled: false,
      is_default: false,
      connected: false,
      config: {}
    },
    {
      ...accountBase,
      id: 4,
      kind: 'imap',
      display_name: '네이버 메일',
      address: 'hong@naver.example',
      signature_html: '',
      default_cc: '',
      default_cc_enabled: false,
      is_default: false,
      config: {
        imapHost: 'imap.naver.com',
        imapPort: 993,
        imapSecure: true,
        imapDraftsPath: 'Drafts'
      }
    }
  ]
  const fromAccountInput = (id: number, input: AccountInput): Account => ({
    ...accountBase,
    ...input,
    id,
    connected: true,
    can_read: input.kind !== 'outlook_local'
  })

  const mails: MailEntry[] = [
    {
      id: 1,
      accountId: 2,
      accountName: '회사 Microsoft 365',
      messageId: 'AAMk-1',
      threadId: 'T1',
      direction: 'out',
      counterpart: 'sy.kim@hanbit.example',
      subject: '[한빛물산] 김서연님, 반갑습니다',
      occurredAt: '2026-09-10 14:22:00',
      openRef: 'https://outlook.office.com/mail/id/AAMk-1'
    },
    {
      id: 2,
      accountId: 2,
      accountName: '회사 Microsoft 365',
      messageId: 'AAMk-2',
      threadId: 'T0',
      direction: 'in',
      counterpart: 'sy.kim@hanbit.example',
      subject: '전시회 부스 위치 문의드립니다',
      occurredAt: '2026-09-02 09:00:00',
      openRef: 'https://outlook.office.com/mail/id/AAMk-2'
    }
  ]

  let notifications: AppNotification[] = [
    {
      id: 1,
      kind: 'awaiting_reply',
      person_id: 1,
      person_name: '김서연',
      account_id: null,
      title: '김서연님 회신 대기',
      body: '2026-09-10에 보낸 뒤 회신이 없습니다',
      status: 'unread',
      created_at: '2026-09-16 09:00:00',
      resolved_at: null
    },
    {
      id: 2,
      kind: 'reply_received',
      person_id: 2,
      person_name: '박준호',
      account_id: 2,
      title: '박준호님에게서 회신이 왔습니다',
      body: 'Re: 박준호님, 요청하신 자료 보내드립니다',
      status: 'unread',
      created_at: '2026-09-15 17:20:00',
      resolved_at: null
    },
    {
      id: 3,
      kind: 'sync_error',
      person_id: null,
      person_name: '',
      account_id: 4,
      title: '네이버 메일 동기화 실패',
      body: 'IMAP 비밀번호가 저장되어 있지 않습니다',
      status: 'read',
      created_at: '2026-09-14 08:10:00',
      resolved_at: null
    }
  ]

  let syncState: SyncState = {
    phase: 'done',
    done: 2,
    total: 2,
    fetched: 3,
    finishedAt: '2026-09-16 15:40:00'
  }

  const fromInput = (id: number, input: PersonInput, prev?: Person): Person => ({
    ...base,
    ...prev,
    id,
    name: input.name,
    organization_id: prev?.organization_id ?? null,
    company: input.company,
    department: input.department,
    title: input.title,
    email: input.emails[0] ?? '',
    emails: input.emails.map((address, i) => ({
      id: id * 100 + i,
      address,
      is_primary: i === 0,
      label: ''
    })),
    phone: input.phone,
    mobile: input.mobile,
    address: input.address,
    website: input.website,
    memo: input.memo,
    tags: input.tags,
    cards: prev?.cards ?? [],
    last_contact_at: prev?.last_contact_at ?? null,
    created_at: prev?.created_at ?? now,
    updated_at: now
  })

  const duplicates = (): DuplicateGroup[] => {
    const byEmail = new Map<string, Person[]>()
    for (const p of people)
      for (const e of p.emails) byEmail.set(e.address, [...(byEmail.get(e.address) ?? []), p])
    return [...byEmail.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([address, list]) => ({
        key: list.map((p) => p.id).join('-'),
        reason: 'email' as const,
        value: address,
        people: list
      }))
  }

  const api: WhenmailApi = {
    people: {
      list: async (filter) => {
        let list = people
        if (filter?.tag) list = list.filter((p) => p.tags.includes(filter.tag!))
        if (filter?.organizationId)
          list = list.filter((p) => p.organization_id === filter.organizationId)
        if (filter?.awaitingReply) list = list.filter((p) => p.awaiting_reply)
        const q = filter?.search?.trim()
        if (q)
          list = list.filter((p) =>
            [p.name, p.company, p.email, ...p.tags].some((v) => v.includes(q))
          )
        return list
      },
      get: async (id) => people.find((p) => p.id === id) ?? null,
      recent: async (limit = 5) => people.slice(0, limit),
      create: async (input) => {
        const p = fromInput(Date.now(), input)
        people = [...people, p]
        return p
      },
      update: async (id, input) => {
        const prev = people.find((p) => p.id === id)
        const next = fromInput(id, input, prev)
        people = people.map((p) => (p.id === id ? next : p))
        return next
      },
      remove: async (id) => {
        people = people.filter((p) => p.id !== id)
      },
      removeMany: async (ids) => {
        people = people.filter((p) => !ids.includes(p.id))
        return ids.length
      },
      bulkUpdate: async (ids) => ids.length,
      duplicates: async () => duplicates(),
      merge: async (targetId, sourceIds) => {
        const target = people.find((p) => p.id === targetId)!
        people = people.filter((p) => !sourceIds.includes(p.id))
        return target
      },
      export: async () => 'C:/mock/whenmail-people-20260916.xlsx'
    },
    organizations: {
      list: async (search) => (search ? orgs.filter((o) => o.name.includes(search)) : orgs),
      get: async (id) => orgs.find((o) => o.id === id) ?? null,
      update: async (id, input) => ({ ...orgs.find((o) => o.id === id)!, ...input }),
      remove: async () => undefined
    },
    activities: {
      list: async (personId) =>
        personId ? activities.filter((a) => a.person_id === personId) : activities,
      addNote: async (personId, text) => {
        const a: Activity = {
          id: Date.now(),
          person_id: personId,
          kind: 'note',
          template_id: null,
          account_id: null,
          person_name: people.find((p) => p.id === personId)?.name ?? '',
          person_email: '',
          template_name: '',
          summary: text,
          adapter: '',
          occurred_at: '2026-09-16 15:00:00'
        }
        activities = [a, ...activities]
        return a
      },
      remove: async (id) => {
        activities = activities.filter((a) => a.id !== id)
      }
    },
    accounts: {
      list: async () => accounts,
      get: async (id) => accounts.find((a) => a.id === id) ?? null,
      create: async (input) => {
        const a = fromAccountInput(Date.now(), input)
        accounts = [...accounts, a]
        return a
      },
      update: async (id, input) => {
        const next = fromAccountInput(id, input)
        accounts = accounts.map((a) => (a.id === id ? next : a))
        return next
      },
      remove: async (id) => {
        accounts = accounts.filter((a) => a.id !== id)
      },
      setDefault: async (id) => {
        accounts = accounts.map((a) => ({ ...a, is_default: a.id === id }))
        return accounts
      },
      connectOAuth: async (kind, _accountId, withRead) => ({
        address: kind === 'm365' ? 'hong@company.example' : 'hong.personal@gmail.example',
        displayName: '홍길동',
        canRead: kind === 'm365' || Boolean(withRead),
        pendingKey: 'pending:mock'
      }),
      testImap: async () => ({ draftsPath: 'Drafts' }),
      sendTest: async (id) => ({
        personId: 0,
        personName: accounts.find((a) => a.id === id)?.display_name ?? '',
        ok: true,
        adapter: 'imap' as const
      })
    },
    mail: {
      list: async (personId) => (personId === 1 ? mails : [])
    },
    notifications: {
      list: async (includeDone) =>
        includeDone ? notifications : notifications.filter((n) => n.status !== 'done'),
      unreadCount: async () => notifications.filter((n) => n.status === 'unread').length,
      setStatus: async (id, status) => {
        notifications = notifications.map((n) => (n.id === id ? { ...n, status } : n))
        return notifications.filter((n) => n.status !== 'done')
      },
      markAllRead: async () => {
        notifications = notifications.map((n) =>
          n.status === 'unread' ? { ...n, status: 'read' as const } : n
        )
        return notifications.filter((n) => n.status !== 'done')
      },
      clear: async (onlyDone) => {
        notifications = onlyDone === false ? [] : notifications.filter((n) => n.status !== 'done')
        return notifications.filter((n) => n.status !== 'done')
      }
    },
    sync: {
      state: async () => syncState,
      run: async () => {
        syncState = { ...syncState, phase: 'done', fetched: 0, finishedAt: '2026-09-16 15:45:00' }
        return syncState
      },
      onState: () => () => undefined
    },
    tags: {
      list: async () => [
        { name: '전시회', count: 1 },
        { name: 'VIP', count: 1 },
        { name: '협력사', count: 1 }
      ]
    },
    import: {
      pick: async () => ({
        fileName: '거래처_연락처.xlsx',
        headers: ['성명', '회사명', '직책', 'E-mail', '추가 이메일', '핸드폰', '비고'],
        rows: [
          [
            '최민수',
            '동방상사',
            '부장',
            'ms.choi@dongbang.example',
            'minsu@gmail.example',
            '010-2222-3333',
            '전시회'
          ],
          ['정유진', '누리소프트', '이사', 'yj.jung@nuri.example', '', '010-4444-5555', ''],
          ['김서연', '한빛물산', '팀장', 'sy.kim@hanbit.example', '', '010-1234-5678', '중복 예시']
        ]
      }),
      commit: async (rows) => ({
        inserted: Math.max(rows.length - 1, 0),
        updated: 0,
        skipped: Math.min(rows.length, 1),
        invalid: 0
      })
    },
    templates: {
      list: async () => templates,
      create: async (input) => ({ ...templates[0], ...input, id: Date.now() }),
      update: async (id, input) => ({ ...templates[0], ...input, id }),
      remove: async () => undefined,
      pickAttachments: async () => [
        { name: '제품카탈로그.pdf', path: '/mock/att/제품카탈로그.pdf', size: 524288 }
      ]
    },
    drafts: {
      create: async (targets, _templateId, options) => {
        const account = accounts.find((a) => a.id === options?.accountId) ?? accounts[0]
        const adapter =
          account?.kind === 'm365'
            ? ('graph' as const)
            : account?.kind === 'gmail'
              ? ('gmail' as const)
              : account?.kind === 'imap'
                ? ('imap' as const)
                : ('eml' as const)
        return targets.map((t) => ({
          personId: t.personId,
          personName: people.find((p) => p.id === t.personId)?.name ?? '?',
          ok: true,
          adapter
        }))
      }
    },
    ocr: {
      scanCard: async () => ({
        fields: {
          name: '오세진',
          company: '(주)가온누리',
          title: '차장',
          emails: ['sj.oh@gaon.example'],
          mobile: '010-7777-8888'
        },
        imagePath: '/mock/card.png',
        imageDataUrl:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#eef2ff"/><text x="20" y="60" font-size="24" fill="#3730a3">오세진 차장</text><text x="20" y="100" font-size="14" fill="#667085">(주)가온누리</text></svg>'
          ),
        rawText: '(주)가온누리\n오세진 차장\nsj.oh@gaon.example\nM. 010-7777-8888'
      })
    },
    files: {
      imageDataUrl: async () =>
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f2f4f7"/><text x="20" y="60" font-size="24" fill="#101828">김서연 팀장</text><text x="20" y="100" font-size="14" fill="#667085">한빛물산 구매팀</text></svg>'
        )
    },
    system: {
      version: async () => '0.0.0-dev',
      outlookDetected: async () => 'eml',
      openDataFolder: async () => '',
      showInFolder: async () => undefined,
      openExternal: async () => undefined
    },
    settings: {
      get: async () => settings,
      save: async (input) => {
        settings = {
          msClientId: input.msClientId,
          googleClientId: input.googleClientId,
          awaitingReplyDays: input.awaitingReplyDays,
          syncOnStartup: input.syncOnStartup,
          hasGoogleClientSecret:
            input.googleClientSecret === 'CLEAR'
              ? false
              : Boolean(input.googleClientSecret) || settings.hasGoogleClientSecret
        }
        return settings
      }
    },
    update: {
      state: async () => ({ status: 'ready', version: '9.9.9' }),
      check: async () => ({ status: 'ready', version: '9.9.9' }),
      install: async () => undefined,
      onState: () => () => undefined
    },
    backup: {
      export: async () => 'C:/mock/whenmail-backup.zip',
      import: async () => false
    }
  }

  window.api = api
}
