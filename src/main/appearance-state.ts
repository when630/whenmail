export interface AppearanceState {
  skin: string
  theme: string
  skinThemes: Record<string, string>
}

export const SKIN_THEMES: Record<string, readonly string[]> = {
  soft: ['soft-light', 'soft-sand', 'soft-dark'],
  zen: ['zen-sage', 'zen-paper', 'zen-ink'],
  glass: ['glass-day', 'glass-night', 'glass-dusk'],
  poster: ['poster', 'paper', 'sage', 'sumi', 'night']
}
const ownSkin = (key: unknown): key is string =>
  typeof key === 'string' && Object.hasOwn(SKIN_THEMES, key)
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}

/** Untrusted/corrupt preferences cannot select arbitrary CSS or prototype keys. */
export function normalizeAppearance(value: unknown): AppearanceState {
  const input = record(value)
  const skin = ownSkin(input.skin) ? input.skin : 'soft'
  const stored = record(input.skinThemes)
  const skinThemes: Record<string, string> = {}
  for (const [id, options] of Object.entries(SKIN_THEMES)) {
    const theme = stored[id]
    skinThemes[id] = typeof theme === 'string' && options.includes(theme) ? theme : options[0]
  }
  const theme = typeof input.theme === 'string' && SKIN_THEMES[skin].includes(input.theme)
    ? input.theme : skinThemes[skin]
  skinThemes[skin] = theme
  return { skin, theme, skinThemes }
}

/** A skin restores its own last theme; a theme must belong to that skin. */
export function chooseAppearance(value: unknown, patch: unknown): AppearanceState {
  const current = normalizeAppearance(value)
  const change = record(patch)
  if ('skin' in change && !ownSkin(change.skin)) throw new Error('Unknown skin')
  const skin = ownSkin(change.skin) ? change.skin : current.skin
  if ('theme' in change && (typeof change.theme !== 'string' || !SKIN_THEMES[skin].includes(change.theme))) {
    throw new Error('Theme does not belong to skin')
  }
  const theme = typeof change.theme === 'string' ? change.theme : current.skinThemes[skin]
  return normalizeAppearance({ skin, theme, skinThemes: { ...current.skinThemes, [skin]: theme } })
}
