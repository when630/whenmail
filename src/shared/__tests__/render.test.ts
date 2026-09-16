import { describe, expect, it } from 'vitest'
import { bodyToHtml, bodyToHtmlFragment, htmlToText, isHtmlBody, renderTemplate } from '../render'
import type { TemplateData } from '../render'

const contact: TemplateData = {
  name: '김서연',
  company: '한빛물산',
  department: '구매팀',
  title: '팀장',
  email: 'sy.kim@hanbit.example',
  phone: '02-1234-5678',
  mobile: '010-1234-5678',
  address: '서울 중구',
  website: 'hanbit.example',
  memo: ''
}

describe('renderTemplate', () => {
  it('기본 변수를 치환한다', () => {
    const r = renderTemplate('{{이름}}님 ({{회사}} {{직함}})', contact)
    expect(r.text).toBe('김서연님 (한빛물산 팀장)')
    expect(r.warnings).toHaveLength(0)
  })

  it('빈 값은 기본값을 쓰고 경고를 남긴다', () => {
    const r = renderTemplate('{{메모|비고 없음}}', contact)
    expect(r.text).toBe('비고 없음')
    expect(r.warnings).toEqual([{ variable: '메모', usedDefault: '비고 없음' }])
  })

  it('빈 값 + 기본값 없음이면 원문 유지 + 경고', () => {
    const r = renderTemplate('{{메모}}', contact)
    expect(r.text).toBe('{{메모}}')
    expect(r.warnings[0]).toEqual({ variable: '메모', usedDefault: null })
  })

  it('알 수 없는 변수는 치환하지 않고 경고한다', () => {
    const r = renderTemplate('{{없는변수}}', contact)
    expect(r.text).toBe('{{없는변수}}')
    expect(r.warnings[0].variable).toBe('없는변수')
  })

  it('보내는날짜는 오늘 날짜로 치환된다', () => {
    const r = renderTemplate('{{보내는날짜}}', contact)
    expect(r.text).toMatch(/^\d{4}년 \d{1,2}월 \d{1,2}일$/)
  })

  it('공백이 있는 표기도 허용한다', () => {
    expect(renderTemplate('{{ 이름 }}', contact).text).toBe('김서연')
  })
})

describe('bodyToHtml', () => {
  it('플레인 텍스트를 문단 HTML로 감싼다', () => {
    const html = bodyToHtml('안녕하세요\n\n감사합니다')
    expect(html).toContain('<p>안녕하세요</p>')
    expect(html).toContain('<p>&nbsp;</p>')
    expect(html).toContain('<p>감사합니다</p>')
  })

  it('HTML 특수문자를 이스케이프한다', () => {
    expect(bodyToHtml('a < b & c')).toContain('a &lt; b &amp; c')
  })

  it('리치 텍스트(HTML) 본문은 그대로 감싼다', () => {
    const html = bodyToHtml('<p>안녕 <b>세진</b>님</p>')
    expect(html).toContain('<p>안녕 <b>세진</b>님</p>')
  })
})

describe('isHtmlBody / htmlToText', () => {
  it('태그 유무로 리치 텍스트를 판별한다', () => {
    expect(isHtmlBody('<p>hi</p>')).toBe(true)
    expect(isHtmlBody('평문\n둘째 줄')).toBe(false)
  })

  it('HTML을 플레인 텍스트로 변환한다', () => {
    expect(htmlToText('<div>안녕<br>하세요</div><ul><li>항목</li></ul>&amp;')).toBe(
      '안녕\n하세요\n항목\n\n&'
    )
  })
})

describe('bodyToHtmlFragment', () => {
  it('플레인 텍스트는 문단으로 감싸고 서명이 없으면 서명 블록을 만들지 않는다', () => {
    const html = bodyToHtmlFragment('안녕하세요\n\n감사합니다')
    expect(html).toContain('<p>안녕하세요</p>')
    expect(html).toContain('<p>&nbsp;</p>')
    expect(html).toContain('<p>감사합니다</p>')
    expect(html).not.toContain('whenmail-signature')
    expect(html.startsWith('<div style=')).toBe(true)
  })

  it('서명은 본문 뒤에 붙는다', () => {
    const html = bodyToHtmlFragment('<p>본문</p>', '<p>홍길동</p>')
    const body = html.indexOf('본문')
    const sig = html.indexOf('whenmail-signature')
    expect(body).toBeGreaterThan(-1)
    expect(sig).toBeGreaterThan(body)
    expect(html).toContain('<p>홍길동</p>')
  })

  it('공백만 있는 서명은 무시한다', () => {
    expect(bodyToHtmlFragment('x', '   ')).not.toContain('whenmail-signature')
  })

  it('bodyToHtml은 조각을 html/body로 감싼다', () => {
    const html = bodyToHtml('x', '<b>s</b>')
    expect(html.startsWith('<html><body')).toBe(true)
    expect(html).toContain('<b>s</b>')
    expect(html.endsWith('</body></html>')).toBe(true)
  })
})
