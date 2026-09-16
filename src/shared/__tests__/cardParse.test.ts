import { describe, expect, it } from 'vitest'
import { parseCardLines } from '../cardParse'

describe('parseCardLines', () => {
  it('전형적인 한글 명함에서 전 필드를 추출한다', () => {
    const fields = parseCardLines([
      { text: '(주)가온누리', height: 20 },
      { text: '오세진', height: 42 },
      { text: '영업본부 솔루션영업팀 / 차장', height: 16 },
      { text: 'T. 02-555-1234  F. 02-555-1235', height: 14 },
      { text: 'M. 010-7777-8888', height: 14 },
      { text: 'E. sj.oh@gaon.example', height: 14 },
      { text: 'www.gaon.example', height: 14 },
      { text: '서울특별시 강남구 테헤란로 123, 10층', height: 13 }
    ])
    expect(fields).toMatchObject({
      name: '오세진',
      company: '(주)가온누리',
      department: '영업본부 솔루션영업팀',
      title: '차장',
      emails: ['sj.oh@gaon.example'],
      phone: '02-555-1234',
      mobile: '010-7777-8888',
      website: 'www.gaon.example',
      address: '서울특별시 강남구 테헤란로 123, 10층'
    })
  })

  it('팩스 번호는 전화로 오인하지 않는다', () => {
    const fields = parseCardLines([{ text: 'Fax. 02-555-1235' }])
    expect(fields.phone).toBeUndefined()
  })

  it('이름 후보가 여럿이면 글자 높이가 큰 라인을 고른다', () => {
    const fields = parseCardLines([
      { text: '박준호', height: 40 },
      { text: '김미소', height: 14 }
    ])
    expect(fields.name).toBe('박준호')
  })

  it('직함 라인에서 이름을 함께 추출한다', () => {
    const fields = parseCardLines([{ text: '홍길동 부장' }])
    expect(fields.name).toBe('홍길동')
    expect(fields.title).toBe('부장')
  })

  it('+82 국가번호를 0으로 정규화한다', () => {
    const fields = parseCardLines([{ text: 'M. +82 10-1234-5678' }])
    expect(fields.mobile).toBe('010-1234-5678')
  })

  it('빈 입력이면 빈 결과를 낸다', () => {
    expect(parseCardLines([])).toEqual({})
  })
})
