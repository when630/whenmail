import type { WhenmailApi } from '../../shared/api'
import type { AppSettings, Contact, DraftLog, EmailTemplate } from '../../shared/types'

/**
 * preload 없이(순수 브라우저에서) 렌더러를 열었을 때만 활성화되는 목 API.
 * UI 개발·디자인 확인용이며, Electron 안에서는 preload의 실제 API가 우선한다.
 */
export function installMockApiIfNeeded(): void {
  if (typeof window === 'undefined' || window.api) return

  const now = '2026-09-01 10:00:00'
  const contacts: Contact[] = [
    {
      id: 1,
      name: '김서연',
      company: '한빛물산',
      department: '구매팀',
      title: '팀장',
      email: 'sy.kim@hanbit.example',
      phone: '02-1234-5678',
      mobile: '010-1234-5678',
      address: '서울 중구',
      website: '',
      memo: '9월 전시회에서 인사',
      card_image_path: '',
      tags: ['전시회', 'VIP'],
      created_at: now,
      updated_at: now
    },
    {
      id: 2,
      name: '박준호',
      company: '대성테크',
      department: '',
      title: '대표',
      email: 'jh.park@daesung.example',
      phone: '',
      mobile: '010-9876-5432',
      address: '',
      website: 'daesung.example',
      memo: '',
      card_image_path: '',
      tags: ['협력사'],
      created_at: now,
      updated_at: now
    },
    {
      id: 3,
      name: '이하은',
      company: '미래로지스',
      department: '영업본부',
      title: '과장',
      email: '',
      phone: '031-555-0100',
      mobile: '',
      address: '',
      website: '',
      memo: '이메일 미확보',
      card_image_path: '',
      tags: [],
      created_at: now,
      updated_at: now
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
    }
  ]
  const logs: DraftLog[] = [
    {
      id: 1,
      contact_id: 1,
      template_id: 1,
      contact_name: '김서연',
      contact_email: 'sy.kim@hanbit.example',
      template_name: '첫 인사 메일',
      subject_rendered: '[한빛물산] 김서연님, 반갑습니다',
      adapter: 'eml',
      created_at: now
    }
  ]

  let settings: AppSettings = {
    outlookMode: 'auto',
    signatureHtml: '<p>홍길동 | whenmail</p>',
    signatureEnabled: true,
    defaultCc: 'team@whenmail.example',
    defaultCcEnabled: true,
    defaultBcc: '',
    defaultBccEnabled: false
  }

  const api: WhenmailApi = {
    tags: {
      list: async () => [
        { name: '전시회', count: 1 },
        { name: 'VIP', count: 1 },
        { name: '협력사', count: 1 }
      ]
    },
    contacts: {
      list: async (search?: string, tag?: string) => {
        let list = contacts
        if (tag) list = list.filter((c) => c.tags.includes(tag))
        if (search?.trim())
          list = list.filter((c) => [c.name, c.company, c.email].some((v) => v.includes(search)))
        return list
      },
      recent: async (limit = 5) => contacts.slice(0, limit),
      create: async (input) => ({ ...contacts[0], ...input, id: Date.now() }),
      update: async (id, input) => ({ ...contacts[0], ...input, id }),
      remove: async () => undefined,
      removeMany: async (ids) => ids.length,
      bulkUpdate: async (ids) => ids.length
    },
    import: {
      pick: async () => ({
        fileName: '거래처_연락처.xlsx',
        headers: ['성명', '회사명', '직책', 'E-mail', '핸드폰', '비고'],
        rows: [
          ['최민수', '동방상사', '부장', 'ms.choi@dongbang.example', '010-2222-3333', '전시회'],
          ['정유진', '누리소프트', '이사', 'yj.jung@nuri.example', '010-4444-5555', ''],
          ['김서연', '한빛물산', '팀장', 'sy.kim@hanbit.example', '010-1234-5678', '중복 예시']
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
      create: async (contactIds) =>
        contactIds.map((id) => ({
          contactId: id,
          contactName: contacts.find((c) => c.id === id)?.name ?? '?',
          ok: true,
          adapter: 'eml' as const
        })),
      history: async () => logs
    },
    ocr: {
      scanCard: async () => ({
        fields: {
          name: '오세진',
          company: '(주)가온누리',
          title: '차장',
          email: 'sj.oh@gaon.example',
          mobile: '010-7777-8888',
          card_image_path: '/mock/card.png'
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
      imageDataUrl: async () => ''
    },
    system: {
      version: async () => '0.0.0-dev',
      outlookMode: async () => (settings.outlookMode === 'com' ? 'com' : 'eml'),
      outlookDetected: async () => 'eml',
      openDataFolder: async () => ''
    },
    settings: {
      get: async () => settings,
      save: async (input) => {
        settings = { ...input }
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
