import { useEffect, useState } from 'react'
import {
  Archive,
  CircleAlert,
  Database,
  DownloadCloud,
  FolderOpen,
  Loader2,
  MailCheck,
  Palette,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save
} from 'lucide-react'
import type {
  AppSettings,
  OutlookAdapter,
  OutlookModePref,
  UpdateState
} from '../../../shared/types'
import { invalidAddresses } from '../../../shared/address'
import { useDialog } from '../components/dialogs'
import RichEditor from '../components/RichEditor'
import { getThemePref, setThemePref, type ThemePref } from '../theme'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' }
]

const OUTLOOK_OPTIONS: { value: OutlookModePref; label: string }[] = [
  { value: 'auto', label: '자동 감지' },
  { value: 'com', label: '클래식 Outlook' },
  { value: 'eml', label: '새 Outlook' }
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

const MODE_DESC: Record<OutlookAdapter, string> = {
  com: '클래식 Outlook의 COM 자동화로 초안을 엽니다. HTML 본문·참조·숨은 참조가 완전하게 지원되고, Outlook 기본 서명이 본문 아래에 유지됩니다.',
  eml: '.eml(X-Unsent) 파일로 새 Outlook(또는 기본 메일 앱)에서 초안을 엽니다. 새 Outlook 버전에 따라 HTML 본문이나 서명 위치가 제한될 수 있습니다.',
  mailto: 'mailto 링크로 기본 메일 앱을 엽니다. 제목·텍스트 본문만 전달됩니다.'
}

const DEFAULT_SETTINGS: AppSettings = {
  outlookMode: 'auto',
  signatureHtml: '',
  signatureEnabled: true,
  defaultCc: '',
  defaultCcEnabled: true,
  defaultBcc: '',
  defaultBccEnabled: true
}

/** 라벨 옆에 놓는 on/off 스위치 */
function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
      <span className="switch-text">{checked ? '사용' : '사용 안 함'}</span>
    </button>
  )
}

export default function SettingsView({
  outlookMode,
  onOutlookModeChange
}: {
  outlookMode: OutlookAdapter | null
  /** 연동 방식 설정을 바꾼 뒤 실제 어댑터가 달라지면 상위(레일 표시)에 알린다 */
  onOutlookModeChange: (mode: OutlookAdapter) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [detected, setDetected] = useState<OutlookAdapter | null>(null)
  const [signatureDraft, setSignatureDraft] = useState('')
  const [ccDraft, setCcDraft] = useState('')
  const [bccDraft, setBccDraft] = useState('')
  const [sigOn, setSigOn] = useState(true)
  const [ccOn, setCcOn] = useState(true)
  const [bccOn, setBccOn] = useState(true)
  const [mailSaving, setMailSaving] = useState(false)
  const { confirm, toast } = useDialog()

  const mailDirty =
    signatureDraft !== settings.signatureHtml ||
    ccDraft !== settings.defaultCc ||
    bccDraft !== settings.defaultBcc ||
    sigOn !== settings.signatureEnabled ||
    ccOn !== settings.defaultCcEnabled ||
    bccOn !== settings.defaultBccEnabled
  const ccInvalid = invalidAddresses(ccDraft)
  const bccInvalid = invalidAddresses(bccDraft)
  const mailInvalid = ccInvalid.length > 0 || bccInvalid.length > 0

  const changeTheme = (pref: ThemePref): void => {
    setThemePref(pref)
    setTheme(pref)
  }

  useEffect(() => {
    window.api.system.version().then(setVersion)
    window.api.update.state().then(setUpdate)
    window.api.system.outlookDetected().then(setDetected)
    window.api.settings.get().then((s) => {
      setSettings(s)
      setSignatureDraft(s.signatureHtml)
      setCcDraft(s.defaultCc)
      setBccDraft(s.defaultBcc)
      setSigOn(s.signatureEnabled)
      setCcOn(s.defaultCcEnabled)
      setBccOn(s.defaultBccEnabled)
    })
    return window.api.update.onState(setUpdate)
  }, [])

  const changeOutlookMode = async (pref: OutlookModePref): Promise<void> => {
    const prev = settings
    setSettings((s) => ({ ...s, outlookMode: pref }))
    try {
      const saved = await window.api.settings.save({ ...settings, outlookMode: pref })
      setSettings(saved)
      onOutlookModeChange(await window.api.system.outlookMode())
    } catch (e) {
      setSettings(prev)
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const saveMailDefaults = async (): Promise<void> => {
    if (mailInvalid) return
    setMailSaving(true)
    try {
      const saved = await window.api.settings.save({
        ...settings,
        signatureHtml: signatureDraft,
        signatureEnabled: sigOn,
        defaultCc: ccDraft,
        defaultCcEnabled: ccOn,
        defaultBcc: bccDraft,
        defaultBccEnabled: bccOn
      })
      setSettings(saved)
      setSignatureDraft(saved.signatureHtml)
      setCcDraft(saved.defaultCc)
      setBccDraft(saved.defaultBcc)
      setSigOn(saved.signatureEnabled)
      setCcOn(saved.defaultCcEnabled)
      setBccOn(saved.defaultBccEnabled)
      toast('메일 기본값이 저장되었습니다')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setMailSaving(false)
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
        '복원하면 현재 사람·회사·템플릿·활동이 백업 파일 내용으로 교체되고 앱이 다시 시작됩니다.\n계속할까요?',
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

  return (
    <div className="view">
      <header className="view-header">
        <h1>설정</h1>
      </header>
      <section className="settings-section">
        <h2>
          <MailCheck size={16} />
          Outlook 연동
        </h2>
        <p className="muted">
          초안을 열 Outlook을 선택합니다. 자동 감지는 클래식 Outlook이 설치되어 있으면 COM, 없으면
          .eml 방식을 사용합니다.
        </p>
        <div className="segment" role="radiogroup" aria-label="Outlook 연동 방식">
          {OUTLOOK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="radio"
              aria-checked={settings.outlookMode === opt.value}
              className={settings.outlookMode === opt.value ? 'active' : ''}
              onClick={() => changeOutlookMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="settings-status">
          현재 모드:{' '}
          <span className={`badge ${outlookMode ? `mode-${outlookMode}` : 'neutral'}`}>
            {outlookMode ?? '확인 중…'}
          </span>
          {detected && (
            <span className="muted">
              {' '}
              · 감지 결과: {detected === 'com' ? '클래식 Outlook 설치됨' : '클래식 Outlook 없음'}
            </span>
          )}
        </p>
        {outlookMode && <p className="muted">{MODE_DESC[outlookMode]}</p>}
        {settings.outlookMode === 'com' && detected === 'eml' && (
          <p className="settings-warn">
            <CircleAlert size={14} />
            클래식 Outlook이 감지되지 않았습니다. COM 연동에 실패하면 자동으로 .eml 방식으로
            넘어갑니다.
          </p>
        )}
        <p className="muted">
          whenmail은 메일을 자동 전송하지 않습니다. 항상 Outlook 초안을 열어 확인 후 직접
          전송합니다.
        </p>
      </section>
      <section className="settings-section">
        <h2>
          <PenLine size={16} />
          메일 기본값
        </h2>
        <p className="muted">
          초안을 만들 때 참조·숨은 참조 칸에 미리 채워지는 주소입니다. 스위치를 끄면 값은 남겨 두고
          적용만 하지 않으며, 초안마다 모달에서 고칠 수 있습니다.
        </p>
        <div className="compose-cc">
          <label className={`form-field ${ccOn ? '' : 'field-off'}`}>
            <span className="field-head">
              <span>기본 참조 (CC)</span>
              <Switch checked={ccOn} onChange={setCcOn} label="기본 참조 사용" />
            </span>
            <input
              placeholder="예: team@company.com; manager@company.com"
              value={ccDraft}
              onChange={(e) => setCcDraft(e.target.value)}
              aria-invalid={ccInvalid.length > 0}
            />
            {ccInvalid.length > 0 && (
              <span className="field-error">
                <CircleAlert size={13} />
                올바르지 않은 주소: {ccInvalid.join(', ')}
              </span>
            )}
          </label>
          <label className={`form-field ${bccOn ? '' : 'field-off'}`}>
            <span className="field-head">
              <span>기본 숨은 참조 (BCC)</span>
              <Switch checked={bccOn} onChange={setBccOn} label="기본 숨은 참조 사용" />
            </span>
            <input
              placeholder="예: me@company.com"
              value={bccDraft}
              onChange={(e) => setBccDraft(e.target.value)}
              aria-invalid={bccInvalid.length > 0}
            />
            {bccInvalid.length > 0 && (
              <span className="field-error">
                <CircleAlert size={13} />
                올바르지 않은 주소: {bccInvalid.join(', ')}
              </span>
            )}
          </label>
        </div>
        <div className="field-head settings-subtitle">
          <span>서명</span>
          <Switch checked={sigOn} onChange={setSigOn} label="서명 사용" />
        </div>
        <p className="muted">
          모든 초안의 본문 아래에 붙는 서명입니다. 비워 두면 클래식 Outlook의 기본 서명이 본문
          아래에 그대로 유지됩니다.
        </p>
        <p className="muted">
          새 Outlook은 .eml 초안을 열 때 자체 서명을 본문 위에 끼워 넣는 경우가 있습니다. 새
          Outlook을 쓴다면 여기에 서명을 넣고 Outlook의 자동 서명은 꺼 두는 것을 권장합니다.
        </p>
        <div className={`signature-editor ${sigOn ? '' : 'field-off'}`}>
          <RichEditor
            value={signatureDraft}
            placeholder="예: 홍길동 | 영업팀 과장 | 010-0000-0000"
            onChange={setSignatureDraft}
          />
        </div>
        <div className="settings-actions settings-actions-end">
          {mailDirty && (
            <span className="dirty-hint">
              <CircleAlert size={14} />
              저장되지 않음
            </span>
          )}
          <button
            className="btn primary"
            onClick={saveMailDefaults}
            disabled={mailSaving || !mailDirty || mailInvalid}
          >
            {mailSaving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            저장
          </button>
        </div>
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
          사람·회사·템플릿·활동·명함 이미지·설정은 이 PC의 로컬 데이터 폴더에만 저장됩니다.
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
      </section>
    </div>
  )
}
