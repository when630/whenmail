import type { Activity, ActivityKind } from '../../shared/types'

export const KIND_LABEL: Record<ActivityKind, string> = {
  card: '명함',
  draft: '초안',
  note: '메모',
  merge: '병합'
}

export function activityText(a: Activity): string {
  if (a.kind === 'draft') return a.summary || '(제목 없음)'
  return a.summary
}
