// 단축키 표기·읽기 — main과 renderer가 같은 규칙을 쓴다.
//
// 저장은 Electron Accelerator 문법 그대로(`Control+Alt+E`), 보여줄 때만 사람이 읽는 꼴로 편다.
// **키캡에 새겨진 것을 그대로 적는다**가 기준이다 — 맥 키보드에는 `Alt`가 없고(⌥) 수식키는 기호로
// 읽는다. 윈도는 키캡에 기호가 없으니 글자로 적는다.

const MAC: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧'
}
const WIN: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Cmd: 'Win',
  Super: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift'
}
const ARROWS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' }
// 맥은 수식키를 누르는 순서가 아니라 정해진 순서로 적는다(Apple 관례)
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']

/** Accelerator → 화면 표기. 빈 값은 빈 문자열 — 부르는 쪽이 "없음" 같은 문구로 갈아 끼운다. */
export function hotkeyLabel(accel: string | null | undefined, mac = false): string {
  const table = mac ? MAC : WIN
  const mods: string[] = []
  const keys: string[] = []
  for (const part of String(accel ?? '')
    .split('+')
    .filter(Boolean)) {
    const mod = table[part]
    if (mod) {
      if (!mods.includes(mod)) mods.push(mod)
      continue
    }
    keys.push(ARROWS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
  }
  if (!mods.length && !keys.length) return ''
  if (!mac) return [...mods, ...keys].join('+')
  mods.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
  return [...mods, ...keys].join('')
}

// KeyboardEvent.code → Accelerator 키 이름. 레이아웃에 흔들리지 않게 code를 쓴다
// (key를 쓰면 한글 자판에서 'ㅁ' 같은 것이 온다).
const CODE_TO_ACCEL: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Quote: "'"
}

export interface KeyLike {
  code?: string
  key?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

/** 눌린 키의 Accelerator 이름. 수식키만 눌렸거나 모르는 키면 null. */
export function accelKeyOf(e: KeyLike): string | null {
  const code = e.code ?? ''
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6)
  return CODE_TO_ACCEL[code] ?? null
}

/** 눌려 있는 수식키들(Accelerator 이름). */
export function accelModsOf(e: KeyLike, mac = false): string[] {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push(mac ? 'Command' : 'Super')
  return mods
}

/**
 * 키 이벤트 하나를 조합으로 읽는다.
 *  - `{ accel }`   — 수식키+키가 갖춰졌다
 *  - `{ pending }` — 수식키만 눌린 상태(미리보기용)
 *  - `{ reject }`  — 수식키 없는 키 하나. 전역 단축키가 맨 글자를 가로채면 다른 앱에서 그 글자를 못 친다
 */
export function readAccel(
  e: KeyLike,
  mac = false
): { accel: string } | { pending: string[] } | { reject: true } {
  const mods = accelModsOf(e, mac)
  const key = accelKeyOf(e)
  if (!key) return { pending: mods }
  if (!mods.length) return { reject: true }
  return { accel: [...mods, key].join('+') }
}
