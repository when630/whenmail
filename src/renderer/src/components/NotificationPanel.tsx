import { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  CalendarClock,
  CheckCheck,
  CircleAlert,
  Clock,
  Loader2,
  MailOpen,
  RefreshCw,
  SendHorizontal,
  Trash2,
  X
} from 'lucide-react'
import type { AppNotification, NotificationKind, SyncState } from '../../../shared/types'
import Avatar from './Avatar'

const KIND_META: Record<NotificationKind, { label: string; Icon: typeof Bell }> = {
  awaiting_reply: { label: '회신 대기', Icon: Clock },
  follow_up: { label: '후속', Icon: CalendarClock },
  reply_received: { label: '회신 도착', Icon: MailOpen },
  sync_error: { label: '동기화 오류', Icon: CircleAlert }
}

interface Props {
  /** 목록이 바뀌면 상위(레일 배지)에 알린다 */
  onChanged: (items: AppNotification[]) => void
  /** 알림에서 사람 열기 */
  onOpenPerson: (personId: number) => void
  /** 알림에서 바로 초안 만들기 (후속이면 그 후속을 처리한다) */
  onCompose: (personId: number, templateId?: number | null, followUpId?: number | null) => void
  onClose: () => void
}

/**
 * 알림함. 앱이 상주하지 않으므로 OS 알림 대신 여기에 쌓아 두고,
 * 앱을 켰을 때 밀린 알림을 확인한다.
 */
export default function NotificationPanel({
  onChanged,
  onOpenPerson,
  onCompose,
  onClose
}: Props): React.JSX.Element {
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [includeDone, setIncludeDone] = useState(false)
  const [sync, setSync] = useState<SyncState | null>(null)

  const apply = useCallback(
    (list: AppNotification[]) => {
      setItems(list)
      onChanged(list)
    },
    [onChanged]
  )

  useEffect(() => {
    window.api.notifications.list(includeDone).then(apply)
  }, [includeDone, apply])

  useEffect(() => {
    window.api.sync.state().then(setSync)
    return window.api.sync.onState((s) => {
      setSync(s)
      // 동기화가 끝나면 새로 쌓인 알림을 바로 반영한다
      if (s.phase === 'done' || s.phase === 'error') {
        window.api.notifications.list(includeDone).then(apply)
      }
    })
  }, [includeDone, apply])

  const act = async (fn: () => Promise<AppNotification[]>, keepScroll = true): Promise<void> => {
    const list = await fn()
    if (!keepScroll) setItems(null)
    apply(list)
  }

  const running = sync?.phase === 'running'
  const unread = (items ?? []).filter((n) => n.status === 'unread').length

  return (
    <div className="notify-backdrop" onClick={onClose}>
      <aside
        className="notify-panel"
        role="dialog"
        aria-label="알림함"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notify-header">
          <h2>
            <Bell size={16} /> 알림함
            {unread > 0 && <span className="badge warn">{unread}</span>}
          </h2>
          <button
            className="btn ghost sm"
            disabled={running}
            onClick={() => window.api.sync.run()}
            title="등록한 계정에서 메일 왕래를 다시 확인합니다"
          >
            {running ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {running ? '확인 중…' : '지금 확인'}
          </button>
          <button className="btn ghost sm icon-only" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="notify-sub">
          {sync?.phase === 'running' && (
            <span className="muted">
              {sync.account ? `${sync.account} 확인 중` : '확인 중'} ({sync.done}/{sync.total})
            </span>
          )}
          {sync?.phase === 'error' && (
            <span className="field-error">
              <CircleAlert size={13} />
              {sync.message}
            </span>
          )}
          {sync?.phase === 'done' && (
            <span className="muted">
              {sync.finishedAt?.slice(5, 16)} 확인
              {sync.fetched > 0 ? ` · 새 메일 ${sync.fetched}건` : ''}
              {sync.message ? ` · ${sync.message}` : ''}
            </span>
          )}
          <span className="spacer" />
          <label className="option-inline">
            <input
              type="checkbox"
              checked={includeDone}
              onChange={(e) => setIncludeDone(e.target.checked)}
            />
            처리한 알림도 보기
          </label>
        </div>

        {items === null ? null : items.length === 0 ? (
          <div className="empty notify-empty">
            <Bell size={30} strokeWidth={1.4} />
            <span className="empty-title">새 알림이 없습니다</span>
            <span>
              메일을 보낸 뒤 회신이 없으면 여기에 쌓입니다. 앱을 켤 때마다 확인하면 됩니다.
            </span>
          </div>
        ) : (
          <ul className="notify-list">
            {items.map((n) => {
              const meta = KIND_META[n.kind]
              return (
                <li key={n.id} className={`notify-item ${n.status} kind-${n.kind}`}>
                  <span className="notify-icon">
                    {n.person_id ? <Avatar name={n.person_name} /> : <meta.Icon size={16} />}
                  </span>
                  <div className="notify-body">
                    <div className="notify-meta">
                      <span className={`badge kind-${n.kind}`}>{meta.label}</span>
                      <span className="muted nowrap">{n.created_at.slice(5, 16)}</span>
                      {n.status === 'unread' && (
                        <span className="notify-dot" aria-label="안 읽음" />
                      )}
                    </div>
                    <div className="notify-title">{n.title}</div>
                    {n.body && <div className="muted notify-text">{n.body}</div>}
                    <div className="notify-actions">
                      {n.person_id && (n.kind === 'follow_up' || n.kind === 'awaiting_reply') && (
                        <button
                          className="btn sm"
                          onClick={() => {
                            onCompose(n.person_id!, null, n.follow_up_id)
                            onClose()
                          }}
                        >
                          <SendHorizontal size={13} />
                          초안 만들기
                        </button>
                      )}
                      {n.person_id && (
                        <button
                          className="btn ghost sm"
                          onClick={() => {
                            onOpenPerson(n.person_id!)
                            if (n.status === 'unread') {
                              act(() => window.api.notifications.setStatus(n.id, 'read'))
                            }
                            onClose()
                          }}
                        >
                          사람 열기
                        </button>
                      )}
                      {n.status !== 'done' && (
                        <button
                          className="btn ghost sm"
                          onClick={() =>
                            act(() => window.api.notifications.setStatus(n.id, 'done'))
                          }
                        >
                          <CheckCheck size={13} />
                          처리함
                        </button>
                      )}
                      {n.status === 'unread' && (
                        <button
                          className="btn ghost sm"
                          onClick={() =>
                            act(() => window.api.notifications.setStatus(n.id, 'read'))
                          }
                        >
                          읽음
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <footer className="notify-footer">
          <button
            className="btn ghost sm"
            disabled={unread === 0}
            onClick={() => act(() => window.api.notifications.markAllRead())}
          >
            <CheckCheck size={14} />
            모두 읽음
          </button>
          <span className="spacer" />
          <button
            className="btn ghost sm danger"
            onClick={() => act(() => window.api.notifications.clear(true))}
          >
            <Trash2 size={14} />
            처리한 알림 비우기
          </button>
        </footer>
      </aside>
    </div>
  )
}
