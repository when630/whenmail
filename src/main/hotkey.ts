// 전역 단축키 — 창을 앞으로 가져오는 조합 하나. 형제 앱(WHENWORK·WHENNOTE·WHENCALENDAR·WHENMUSIC)과 같은 규칙이다.
//
// globalShortcut.register()는 다른 앱이 이미 쥔 조합이면 **조용히 false를 돌려준다.** 확인하지 않으면
// 사용자는 "눌러도 아무 일이 없다"만 겪는다 — 등록 성공 여부를 남겨 설정 화면이 빨갛게 적을 근거로 쓴다.
// 이 앱은 트레이에 상주하지 않으므로 단축키는 앱이 떠 있는 동안만 산다.
import { globalShortcut } from 'electron'

/** 기본 조합. WHENWORK `Ctrl+Alt+Space`·WHENNOTE `M`·`N`·WHENCALENDAR `C`·`O`·WHENMUSIC `S`·`P`·←·→와 겹치지 않는다. */
export const DEFAULT_HOTKEY = 'Control+Alt+E'

let current = ''
let ok = false
let action: () => void = () => {}

/** 단축키가 눌렸을 때 할 일. 창 모듈이 준비된 뒤 index.ts가 한 번 건다. */
export function setHotkeyAction(fn: () => void): void {
  action = fn
}

/** 조합을 (다시) 잡는다. 빈 문자열은 "안 쓴다"라 실패가 아니다. 등록 성공 여부를 돌려준다. */
export function applyHotkey(accel: string): boolean {
  globalShortcut.unregisterAll()
  current = String(accel ?? '').trim()
  ok = false
  if (!current) return true
  try {
    ok = globalShortcut.register(current, () => action()) && globalShortcut.isRegistered(current)
  } catch {
    ok = false // 조합 문자열 자체가 잘못되면 register가 던진다
  }
  return ok
}

/** 지금 잡혀 있는 조합과 그 등록 성공 여부. 비어 있으면 ok는 true — 안 쓰기로 한 것이지 실패가 아니다. */
export function hotkeyState(): { hotkey: string; hotkeyOk: boolean } {
  return { hotkey: current, hotkeyOk: current ? ok : true }
}

export function releaseHotkey(): void {
  globalShortcut.unregisterAll()
}
