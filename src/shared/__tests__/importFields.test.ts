import { describe, expect, it } from 'vitest'
import {
  EXPORT_HEADERS,
  guessMapping,
  personToRow,
  rowToPersonInput,
  splitList
} from '../importFields'
import type { Person } from '../types'

const person: Person = {
  id: 1,
  name: '김서연',
  organization_id: 1,
  company: '한빛물산',
  department: '구매팀',
  title: '팀장',
  email: 'sy.kim@hanbit.example',
  emails: [
    { id: 1, address: 'sy.kim@hanbit.example', is_primary: true, label: '회사' },
    { id: 2, address: 'seoyeon@gmail.example', is_primary: false, label: '개인' }
  ],
  phone: '02-1234-5678',
  mobile: '010-1234-5678',
  address: '서울 중구',
  website: 'hanbit.example',
  memo: '9월 전시회',
  cards: [],
  tags: ['전시회', 'VIP'],
  last_contact_at: null,
  last_inbound_at: null,
  last_outbound_at: null,
  awaiting_reply: false,
  created_at: '',
  updated_at: ''
}

describe('내보내기 ↔ 가져오기 왕복', () => {
  it('내보낸 행을 헤더 자동 매핑으로 다시 읽으면 같은 사람이 된다', () => {
    const mapping = guessMapping(EXPORT_HEADERS)
    const back = rowToPersonInput(personToRow(person), mapping)
    expect(back).toEqual({
      name: '김서연',
      company: '한빛물산',
      department: '구매팀',
      title: '팀장',
      emails: ['sy.kim@hanbit.example', 'seoyeon@gmail.example'],
      phone: '02-1234-5678',
      mobile: '010-1234-5678',
      address: '서울 중구',
      website: 'hanbit.example',
      memo: '9월 전시회',
      tags: ['전시회', 'VIP']
    })
  })

  it('"추가 이메일" 열이 "이메일"에 먹히지 않는다', () => {
    const mapping = guessMapping(['추가 이메일', '이름', '이메일'])
    expect(mapping.email).toBe(2)
    expect(mapping.emails_extra).toBe(0)
    expect(mapping.name).toBe(1)
  })

  it('헤더 별칭(성명, E-mail, 핸드폰, 비고)을 인식한다', () => {
    const mapping = guessMapping(['성명', '회사명', 'E-mail', '핸드폰', '비고'])
    expect(mapping).toMatchObject({ name: 0, company: 1, email: 2, mobile: 3, memo: 4 })
  })

  it('한 셀의 여러 이메일·태그를 나눈다', () => {
    expect(splitList('a@x.com; b@y.com / c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
    const mapping = guessMapping(['이름', '이메일'])
    expect(rowToPersonInput(['홍길동', 'A@X.com, a@x.com'], mapping).emails).toEqual(['a@x.com'])
  })
})
