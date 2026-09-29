import { describe, expect, it } from 'vitest'
import { accelKeyOf, hotkeyLabel, readAccel } from '../hotkey'

describe('hotkeyLabel', () => {
  it('윈도는 키캡 글자로, Control은 Ctrl로', () => {
    expect(hotkeyLabel('Control+Alt+E')).toBe('Ctrl+Alt+E')
    expect(hotkeyLabel('CommandOrControl+Shift+Left')).toBe('Ctrl+Shift+←')
    expect(hotkeyLabel('Super+E')).toBe('Win+E')
  })
  it('맥은 기호를 Apple 순서로 붙여 쓴다', () => {
    expect(hotkeyLabel('Alt+Control+E', true)).toBe('⌃⌥E')
    expect(hotkeyLabel('Command+Shift+E', true)).toBe('⇧⌘E')
  })
  it('빈 값은 빈 문자열 — 부르는 쪽이 "없음"으로 바꾼다', () => {
    expect(hotkeyLabel('')).toBe('')
    expect(hotkeyLabel(null)).toBe('')
  })
})

describe('readAccel', () => {
  it('수식키+글자가 갖춰지면 Accelerator 문자열', () => {
    expect(readAccel({ code: 'KeyE', ctrlKey: true, altKey: true })).toEqual({
      accel: 'Control+Alt+E'
    })
    expect(readAccel({ code: 'Digit1', shiftKey: true })).toEqual({ accel: 'Shift+1' })
    expect(readAccel({ code: 'ArrowLeft', ctrlKey: true, metaKey: true }, true)).toEqual({
      accel: 'Control+Command+Left'
    })
  })
  it('수식키만 눌렸으면 pending — 미리보기에 쓴다', () => {
    expect(readAccel({ code: 'ControlLeft', ctrlKey: true })).toEqual({ pending: ['Control'] })
  })
  it('수식키 없는 글자 하나는 받지 않는다', () => {
    expect(readAccel({ code: 'KeyE' })).toEqual({ reject: true })
  })
  it('한글 자판에서도 code를 읽으므로 같은 자리가 같은 키다', () => {
    expect(accelKeyOf({ code: 'KeyA', key: 'ㅁ' })).toBe('A')
    expect(accelKeyOf({ code: 'F5' })).toBe('F5')
    expect(accelKeyOf({ code: 'Numpad3' })).toBe('num3')
    expect(accelKeyOf({ code: 'ShiftLeft' })).toBeNull()
  })
})
