export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'theme'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolve(pref)
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* 저장 실패는 무시 */
  }
  apply(pref)
}

/** 앱 시작 시 저장된 테마 적용 + OS 테마 변화 추적(시스템 모드일 때) */
export function initTheme(): void {
  apply(getThemePref())
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (getThemePref() === 'system') apply('system')
    })
}
