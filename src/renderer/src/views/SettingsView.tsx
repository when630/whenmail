import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  Bell,
  CircleAlert,
  Database,
  DownloadCloud,
  FolderOpen,
  KeyRound,
  Loader2,
  MailCheck,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SendHorizontal,
  Star,
  Trash2,
  Users
} from 'lucide-react'
import type {
  Account,
  AppSettings,
  OutlookAdapter,
  SyncState,
  UpdateState
} from '../../../shared/types'
import { ACCOUNT_KIND_LABEL } from '../../../shared/accounts'
import { useDialog } from '../components/dialogs'
import { getThemePref, setThemePref, type ThemePref } from '../theme'
import AccountModal from './AccountModal'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' }
]

const UPDATE_LABEL: Record<UpdateState['status'], string> = {
  idle: '확인 전',
  checking: '확인 중…',
  available: '새 버전 발견',
  none: '최신 버전입니다',
  downloading: '다운로드 중',
  ready: '업데이트 준비 완료 — 재시작하면 적용됩니다',
  error: '확인 실패'
}

const EMPTY_SETTINGS: AppSettings = {
  msClientId: '',
  googleClientId: '',
  hasGoogleClientSecret: false,
  awaitingReplyDays: 7,
  syncOnStartup: true
}

const AZURE_URL =
  'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
const GOOGLE_URL = 'https://console.cloud.google.com/apis/credentials'

export default function SettingsView({
  onAccountsChange
}: {
  /** 계정이 바뀌면 상위(레일 표시)에 알린다 */
  onAccountsChange: (accounts: Account[]) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [detected, setDetected] = useState<OutlookAdapter | null>(null)
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS)
  const [msId, setMsId] = useState('')
  const [googleId, setGoogleId] = useState('')
  const [googleSecret, setGoogleSecret] = useState('')
  const [savingApps, setSavingApps] = useState(false)
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [sync, setSync] = useState<SyncState | null>(null)
  const [days, setDays] = useState(7)
  const [onStartup, setOnStartup] = useState(true)
  const [savingSync, setSavingSync] = useState(false)
  const { confirm, toast } = useDialog()

  const reloadAccounts = useCallback(async () => {
    const list = await window.api.accounts.list()
    setAccounts(list)
    onAccountsChange(list)
  }, [onAccountsChange])

  useEffect(() => {
    window.api.system.version().then(setVersion)
    window.api.update.state().then(setUpdate)
    window.api.system.outlookDetected().then(setDetected)
    window.api.accounts.list().then((list) => {
      setAccounts(list)
      onAccountsChange(list)
    })
    window.api.settings.get().then((s) => {
      setSettings(s)
      setMsId(s.msClientId)
      setGoogleId(s.googleClientId)
      setDays(s.awaitingReplyDays)
      setOnStartup(s.syncOnStartup)
    })
    window.api.sync.state().then(setSync)
    const offSync = window.api.sync.onState(setSync)
    const offUpdate = window.api.update.onState(setUpdate)
    return () => {
      offSync()
      offUpdate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const appsDirty =
    msId !== settings.msClientId || googleId !== settings.googleClientId || googleSecret !== ''

  const saveApps = async (): Promise<void> => {
    setSavingApps(true)
    try {
      const saved = await window.api.settings.save({
        ...settings,
        msClientId: msId,
        googleClientId: googleId,
        googleClientSecret: googleSecret || undefined
      })
      setSettings(saved)
      setMsId(saved.msClientId)
      setGoogleId(saved.googleClientId)
      setGoogleSecret('')
      toast('연동 앱 설정이 저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSavingApps(false)
    }
  }

  const clearGoogleSecret = async (): Promise<void> => {
    const saved = await window.api.settings.save({ ...settings, googleClientSecret: 'CLEAR' })
    setSettings(saved)
    toast('Google 클라이언트 시크릿을 삭제했습니다')
  }

  const saveSync = async (): Promise<void> => {
    setSavingSync(true)
    try {
      const saved = await window.api.settings.save({
        ...settings,
        awaitingReplyDays: days,
        syncOnStartup: onStartup
      })
      setSettings(saved)
      setDays(saved.awaitingReplyDays)
      setOnStartup(saved.syncOnStartup)
      toast('알림 설정이 저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSavingSync(false)
    }
  }

  const changeTheme = (pref: ThemePref): void => {
    setThemePref(pref)
    setTheme(pref)
  }

  const removeAccount = async (a: Account): Promise<void> => {
    const ok = await confirm({
      title: '계정 삭제',
      message: `'${a.display_name}' 계정을 삭제할까요?\n연결 토큰·비밀번호가 함께 지워지고, 이 계정으로 만든 초안 기록은 남습니다.`,
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await window.api.accounts.remove(a.id)
    await reloadAccounts()
    toast('삭제되었습니다')
  }

  const makeDefault = async (a: Account): Promise<void> => {
    const list = await window.api.accounts.setDefault(a.id)
    setAccounts(list)
    onAccountsChange(list)
  }

  const sendTest = async (a: Account): Promise<void> => {
    setTesting(a.id)
    try {
      const r = await window.api.accounts.sendTest(a.id)
      if (r.ok) toast(`테스트 초안을 만들었습니다 (${r.adapter})`)
      else toast(r.error ?? '실패', 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setTesting(null)
    }
  }

  const exportBackup = async (): Promise<void> => {
    setBusy('export')
    try {
      const saved = await window.api.backup.export()
      if (saved) toast(`백업이 저장되었습니다 — ${saved}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const importBackup = async (): Promise<void> => {
    const ok = await confirm({
      title: '백업에서 복원',
      message:
        '복원하면 현재 사람·회사·템플릿·활동·계정 목록이 백업 파일 내용으로 교체되고 앱이 다시 시작됩니다.\n계정의 연결 토큰·비밀번호는 백업에 들어 있지 않아 복원 후 다시 연결해야 합니다.\n계속할까요?',
      confirmLabel: '복원',
      danger: true
    })
    if (!ok) return
    setBusy('import')
    try {
      await window.api.backup.import()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const localModeText = (a: Account): string => {
    if (a.config.outlookMode === 'com') return '클래식'
    if (a.config.outlookMode === 'eml') return '새 Outlook'
    if (detected === 'com') return '자동(클래식)'
    if (detected === 'eml') return '자동(새 Outlook)'
    return '자동'
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>설정</h1>
      </header>

      <section className="settings-section">
        <h2>
          <Users size={16} />
          계정
        </h2>
        <p className="muted">
          초안을 만들 메일 계정입니다. 계정 종류가 초안 생성 경로를 정하고, 서명·기본 참조는
          계정마다 따로 둡니다. 어떤 종류든 메일을 자동 전송하지 않고 초안까지만 만듭니다.
        </p>
        {accounts === null ? null : accounts.length === 0 ? (
          <p className="settings-warn">
            <CircleAlert size={14} />
            계정이 없어 초안을 만들 수 없습니다. 계정을 추가하세요.
          </p>
        ) : (
          <ul className="account-list">
            {accounts.map((a) => (
              <li key={a.id} className={a.is_default ? 'is-default' : ''}>
                <span className={`badge kind-${a.kind}`}>{ACCOUNT_KIND_LABEL[a.kind]}</span>
                <span className="account-main">
                  <strong>
                    {a.display_name}
                    {a.is_default && (
                      <span className="badge neutral account-default-badge">
                        <Star size={10} /> 기본
                      </span>
                    )}
                  </strong>
                  <small className="muted">
                    {a.address || (a.kind === 'outlook_local' ? '이 PC에 설치된 Outlook' : '')}
                    {a.kind === 'outlook_local' && ` · ${localModeText(a)}`}
                  </small>
                </span>
                {!a.connected && <span className="badge warn">재연결 필요</span>}
                {a.connected && a.sync_enabled && a.can_read && (
                  <span className="badge mode-com" title="이 계정에서 메일 왕래를 읽어 옵니다">
                    읽기 켜짐
                  </span>
                )}
                {a.connected && a.sync_enabled && !a.can_read && (
                  <span className="badge warn">읽기 권한 필요</span>
                )}
                <span className="spacer" />
                {!a.is_default && (
                  <button className="btn ghost sm" onClick={() => makeDefault(a)}>
                    기본으로
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  onClick={() => sendTest(a)}
                  disabled={testing !== null || !a.connected || !a.address}
                  title={
                    a.address
                      ? '내 주소로 테스트 초안 만들기'
                      : '발신 주소가 있어야 테스트할 수 있습니다'
                  }
                >
                  {testing === a.id ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <SendHorizontal size={14} />
                  )}
                  테스트
                </button>
                <button
                  className="btn ghost sm icon-only"
                  aria-label={`${a.display_name} 편집`}
                  onClick={() => setEditing(a)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn ghost sm icon-only danger"
                  aria-label={`${a.display_name} 삭제`}
                  onClick={() => removeAccount(a)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="settings-actions">
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} />
            계정 추가
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>
          <KeyRound size={16} />
          연동 앱 (Microsoft 365 · Gmail)
        </h2>
        <p className="muted">
          Microsoft 365와 Gmail 계정은 OAuth로 연결합니다. 본인 명의의 앱을 한 번 등록하고
          클라이언트 ID를 여기에 넣으면 됩니다. 클라이언트 ID는 공개 정보이며, 메일 비밀번호는 앱에
          저장되지 않습니다.
        </p>
        <div className="form-grid">
          <label className="form-field form-field-wide">
            <span>
              Azure 앱(클라이언트) ID{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => window.api.system.openExternal(AZURE_URL)}
              >
                Azure 포털 열기
              </button>
            </span>
            <input
              value={msId}
              placeholder="예: 3f2c1a7e-…"
              onChange={(e) => setMsId(e.target.value)}
            />
            <span className="muted hint-inline">
              앱 등록 → 인증 → 플랫폼 추가 &quot;모바일 및 데스크톱 애플리케이션&quot; → 리디렉션
              URI <code>http://localhost</code>. API 권한(위임): Mail.ReadWrite, User.Read
            </span>
          </label>
          <label className="form-field">
            <span>
              Google OAuth 클라이언트 ID{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => window.api.system.openExternal(GOOGLE_URL)}
              >
                Google Cloud 콘솔 열기
              </button>
            </span>
            <input
              value={googleId}
              placeholder="예: 1234-….apps.googleusercontent.com"
              onChange={(e) => setGoogleId(e.target.value)}
            />
            <span className="muted hint-inline">
              사용자 인증 정보 → OAuth 클라이언트 ID → 유형 &quot;데스크톱 앱&quot;. Gmail API를
              사용 설정하고, OAuth 동의 화면의 테스트 사용자에 본인 계정을 추가하세요
            </span>
          </label>
          <label className="form-field">
            <span>
              Google 클라이언트 시크릿{' '}
              {settings.hasGoogleClientSecret && (
                <>
                  <span className="badge mode-com">저장됨</span>{' '}
                  <button type="button" className="link-btn" onClick={clearGoogleSecret}>
                    삭제
                  </button>
                </>
              )}
            </span>
            <input
              type="password"
              value={googleSecret}
              autoComplete="off"
              placeholder={
                settings.hasGoogleClientSecret
                  ? '(변경할 때만 입력)'
                  : '데스크톱 앱 유형은 시크릿을 함께 발급합니다'
              }
              onChange={(e) => setGoogleSecret(e.target.value)}
            />
          </label>
        </div>
        <div className="settings-actions settings-actions-end">
          {appsDirty && (
            <span className="dirty-hint">
              <CircleAlert size={14} />
              저장되지 않음
            </span>
          )}
          <button className="btn primary" onClick={saveApps} disabled={savingApps || !appsDirty}>
            {savingApps ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            저장
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>
          <Bell size={16} />
          알림과 메일 확인
        </h2>
        <p className="muted">
          whenmail은 백그라운드에 상주하지 않습니다. 앱을 켤 때와 직접 누를 때만 메일을 확인하고, 그
          사이에 생긴 일은 알림함에 쌓아 둡니다. 계정별 읽기 사용 여부는 계정 편집에서 켭니다.
        </p>
        <div className="form-grid">
          <label className="form-field">
            <span>
              회신 대기 판정 기간{' '}
              <em className="muted hint-inline">— 보낸 뒤 이만큼 지나도 답이 없으면 알림</em>
            </span>
            <div className="days-row">
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
              <span className="muted">일</span>
            </div>
          </label>
          <label className="option-row">
            <input
              type="checkbox"
              checked={onStartup}
              onChange={(e) => setOnStartup(e.target.checked)}
            />
            앱을 켤 때 메일을 한 번 확인
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="btn"
            disabled={sync?.phase === 'running'}
            onClick={() => window.api.sync.run()}
          >
            {sync?.phase === 'running' ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            지금 메일 확인
          </button>
          <span className="spacer" />
          {(days !== settings.awaitingReplyDays || onStartup !== settings.syncOnStartup) && (
            <span className="dirty-hint">
              <CircleAlert size={14} />
              저장되지 않음
            </span>
          )}
          <button
            className="btn primary"
            onClick={saveSync}
            disabled={
              savingSync ||
              (days === settings.awaitingReplyDays && onStartup === settings.syncOnStartup)
            }
          >
            {savingSync ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            저장
          </button>
        </div>
        <p className="muted settings-status">
          {sync?.phase === 'running' && (
            <>
              {sync.account ? `${sync.account} 확인 중` : '확인 중'} ({sync.done}/{sync.total})
            </>
          )}
          {sync?.phase === 'done' && (
            <>
              마지막 확인 {sync.finishedAt?.slice(5, 16) ?? '—'}
              {sync.fetched > 0 ? ` · 새 메일 ${sync.fetched}건` : ''}
              {sync.message ? ` · ${sync.message}` : ''}
            </>
          )}
          {sync?.phase === 'error' && <span className="field-error">{sync.message}</span>}
          {(!sync || sync.phase === 'idle') && '아직 확인하지 않았습니다'}
        </p>
      </section>

      <section className="settings-section">
        <h2>
          <Palette size={16} />
          화면
        </h2>
        <p className="muted">테마를 선택합니다. 시스템은 Windows 설정을 따라갑니다.</p>
        <div className="segment" role="radiogroup" aria-label="테마">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="radio"
              aria-checked={theme === opt.value}
              className={theme === opt.value ? 'active' : ''}
              onClick={() => changeTheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>
          <DownloadCloud size={16} />
          업데이트
        </h2>
        <p>
          현재 버전: <span className="badge neutral">v{version || '…'}</span>{' '}
          <span className="muted">
            {UPDATE_LABEL[update.status]}
            {update.status === 'downloading' && update.percent !== undefined
              ? ` (${update.percent}%)`
              : ''}
            {update.status === 'error' && update.message ? ` — ${update.message}` : ''}
          </span>
        </p>
        <p className="muted">새 버전이 GitHub 릴리즈에 올라오면 자동으로 내려받아 둡니다.</p>
        <div className="settings-actions">
          <button
            className="btn"
            onClick={() => window.api.update.check()}
            disabled={update.status === 'checking' || update.status === 'downloading'}
          >
            {update.status === 'checking' || update.status === 'downloading' ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            업데이트 확인
          </button>
          {update.status === 'ready' && (
            <button className="btn primary" onClick={() => window.api.update.install()}>
              지금 재시작하여 v{update.version} 적용
            </button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>
          <Database size={16} />
          데이터
        </h2>
        <p className="muted">
          사람·회사·템플릿·활동·계정·명함 이미지는 이 PC의 로컬 데이터 폴더에만 저장됩니다. 연결
          토큰과 IMAP 비밀번호는 별도 파일에 OS 암호화로 보관되며 백업 zip에는 들어가지 않습니다.
        </p>
        <div className="settings-actions">
          <button className="btn" onClick={() => window.api.system.openDataFolder()}>
            <FolderOpen size={15} />
            데이터 폴더 열기
          </button>
          <button className="btn" onClick={exportBackup} disabled={busy !== null}>
            {busy === 'export' ? <Loader2 size={15} className="spin" /> : <Archive size={15} />}
            백업 내보내기 (zip)
          </button>
          <button className="btn" onClick={importBackup} disabled={busy !== null}>
            {busy === 'import' ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
            백업에서 복원…
          </button>
        </div>
        <p className="muted settings-status">
          <MailCheck size={14} /> whenmail은 어떤 계정으로도 메일을 자동 전송하지 않습니다.
        </p>
      </section>

      {editing && (
        <AccountModal
          account={editing === 'new' ? null : editing}
          settings={settings}
          detected={detected}
          isNew={editing === 'new'}
          onSaved={async (saved, wasNew) => {
            setEditing(null)
            await reloadAccounts()
            toast(wasNew ? `'${saved.display_name}' 계정을 추가했습니다` : '저장되었습니다')
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
