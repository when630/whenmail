import { describe, expect, it } from 'vitest'
import { COMMANDS, buildManifest, fromArgv, parseDeepLink } from '../deeplink'

describe('딥링크 파싱 (when-protocol)', () => {
  it('whenmail://<명령>?<인자> 를 풀고 값은 URL 디코딩한다', () => {
    expect(parseDeepLink('whenmail://search?q=%EA%B9%80%EB%B6%80%EC%9E%A5')).toEqual({
      command: 'search',
      args: { q: '김부장' }
    })
    expect(parseDeepLink('whenmail://activity')).toEqual({ command: 'activity', args: {} })
    expect(parseDeepLink('whenmail://open/')).toEqual({ command: 'open', args: {} })
    expect(parseDeepLink('WHENMAIL://Search')).toEqual({ command: 'search', args: {} })
  })

  it('다른 스킴·모르는 명령·쓰레기는 null', () => {
    expect(parseDeepLink('whennote://open')).toBeNull()
    expect(parseDeepLink('whenmail://send-everything')).toBeNull()
    expect(parseDeepLink('https://example.com')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
    expect(parseDeepLink(null)).toBeNull()
  })

  it('fromArgv는 argv 어디에 있든 첫 whenmail:// 를 집는다', () => {
    expect(fromArgv(['C:\\whenmail.exe', '--x', 'whenmail://open'])).toBe('whenmail://open')
    expect(fromArgv(['electron', '.'])).toBeNull()
    expect(fromArgv(undefined)).toBeNull()
  })
})

describe('매니페스트', () => {
  it('규약 v1 모양이고 광고한 명령을 앱이 전부 받는다', () => {
    const m = buildManifest({ platformName: 'win32', exePath: null, packaged: false })
    expect(m.protocol).toBe(1)
    expect(m.id).toBe('whenmail')
    expect(m.scheme).toBe('whenmail')
    expect(m.verify.win32).toMatch(/whenmail\.exe$/)
    expect(m.verify.darwin).toMatch(/\.app$/)
    expect(m.commands).toHaveLength(COMMANDS.length)
    for (const c of m.commands) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]{1,31}$/)
      expect(c.title.trim()).not.toBe('')
      for (const a of c.args ?? []) expect(a.type).toBe('string')
      expect(parseDeepLink(`whenmail://${c.id}`)?.command).toBe(c.id)
    }
  })

  it('args 없는 명령은 키 자체가 없다 — JSON 왕복이 같게', () => {
    const m = buildManifest({ platformName: 'win32', exePath: null, packaged: false })
    const open = m.commands.find((c) => c.id === 'open')!
    expect('args' in open).toBe(false)
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })

  it('패키징본은 실제 실행 파일을 verify에 적는다 — macOS는 .app 번들까지만', () => {
    expect(
      buildManifest({
        platformName: 'win32',
        exePath: 'D:\\Apps\\whenmail\\whenmail.exe',
        packaged: true
      }).verify.win32
    ).toBe('D:\\Apps\\whenmail\\whenmail.exe')
    expect(
      buildManifest({
        platformName: 'darwin',
        exePath: '/Applications/whenmail.app/Contents/MacOS/whenmail',
        packaged: true
      }).verify.darwin
    ).toBe('/Applications/whenmail.app')
    expect(
      buildManifest({ platformName: 'win32', exePath: 'D:\\x\\electron.exe', packaged: false })
        .verify.win32
    ).toMatch(/%LOCALAPPDATA%/)
  })
})
