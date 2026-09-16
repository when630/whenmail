import { useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Link2,
  Loader2,
  MailCheck,
  Paperclip,
  Save,
  X,
  XCircle
} from 'lucide-react'
import type {
  Account,
  AccountInput,
  AccountKind,
  AppSettings,
  OutlookAdapter,
  OutlookModePref
} from '../../../shared/types'
import { ACCOUNT_KIND_DESC, ACCOUNT_KIND_LABEL, capabilitiesOf } from '../../../shared/accounts'
import { invalidAddresses } from '../../../shared/address'
import { useDialog } from '../components/dialogs'
import RichEditor from '../components/RichEditor'

const KINDS: AccountKind[] = ['outlook_local', 'm365', 'gmail', 'imap']

const OUTLOOK_OPTIONS: { value: OutlookModePref; label: string }[] = [
  { value: 'auto', label: '자동 감지' },
  { value: 'com', label: '클래식 Outlook' },
  { value: 'eml', label: '새 Outlook' }
]

/** 라벨 옆에 놓는 on/off 스위치 */
export function Switch({
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

function emptyInput(kind: AccountKind): AccountInput {
  return {
    kind,
    display_name: '',
    address: '',
    signature_html: '',
    signature_enabled: true,
    default_cc: '',
    default_cc_enabled: true,
    default_bcc: '',
    default_bcc_enabled: true,
    is_default: false,
    config:
      kind === 'outlook_local'
        ? { outlookMode: 'auto' }
        : kind === 'imap'
          ? { imapHost: '', imapPort: 993, imapSecure: true, imapUser: '', imapDraftsPath: '' }
          : {}
  }
}

function fromAccount(a: Account): AccountInput {
  return {
    kind: a.kind,
    display_name: a.display_name,
    address: a.address,
    signature_html: a.signature_html,
    signature_enabled: a.signature_enabled,
    default_cc: a.default_cc,
    default_cc_enabled: a.default_cc_enabled,
    default_bcc: a.default_bcc,
    default_bcc_enabled: a.default_bcc_enabled,
    is_default: a.is_default,
    config: { ...a.config }
  }
}

interface Props {
  account: Account | null
  /** 연동 앱 설정 — OAuth 버튼 활성 여부 안내용 */
  settings: AppSettings
  /** 로컬 Outlook 감지 결과 */
  detected: OutlookAdapter | null
  /** 새로 추가하는 중인지 (토스트 문구용) */
  isNew: boolean
  onSaved: (account: Account, wasNew: boolean) => void
  onClose: () => void
}

/**
 * 계정 추가/편집. 종류를 고르면 그 종류의 연결 방법이 나오고,
 * 아래 공통 항목(이름·서명·참조)은 모든 종류가 같다. 계정 = 발신 프로필.
 */
export default function AccountModal({
  account,
  settings,
  detected,
  isNew,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const [form, setForm] = useState<AccountInput>(
    account ? fromAccount(account) : emptyInput('outlook_local')
  )
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [oauthDone, setOauthDone] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const { toast } = useDialog()

  // 종류가 바뀐 렌더에서 이전 종류의 테스트 결과를 지운다
  const [resultFor, setResultFor] = useState<AccountKind>(form.kind)
  if (resultFor !== form.kind) {
    setResultFor(form.kind)
    setTestResult(null)
  }

  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))
  const setConfig = (patch: Partial<AccountInput['config']>): void =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }))

  const kind = form.kind
  const ccInvalid = invalidAddresses(form.default_cc)
  const bccInvalid = invalidAddresses(form.default_bcc)
  const addressInvalid = ccInvalid.length > 0 || bccInvalid.length > 0

  const oauthReady =
    kind === 'm365' ? Boolean(settings.msClientId.trim()) : Boolean(settings.googleClientId.trim())
  const oauthConnected = Boolean(account?.connected) || Boolean(form.pendingOAuthKey)

  const localMode: OutlookAdapter | null =
    kind === 'outlook_local'
      ? form.config.outlookMode === 'com' || form.config.outlookMode === 'eml'
        ? form.config.outlookMode
        : detected
      : null
  const caps = capabilitiesOf(kind, localMode)

  const connect = async (): Promise<void> => {
    if (kind !== 'm365' && kind !== 'gmail') return
    setConnecting(true)
    try {
      const result = await window.api.accounts.connectOAuth(kind, account?.id)
      setForm((f) => ({
        ...f,
        address: result.address || f.address,
        display_name: f.display_name || result.displayName || result.address,
        pendingOAuthKey: result.pendingKey ?? f.pendingOAuthKey
      }))
      setOauthDone(result.address)
      toast(`${result.address} 연결됨`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setConnecting(false)
    }
  }

  const testImap = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.accounts.testImap(
        { ...form, imapPassword: password || undefined },
        account?.id
      )
      setConfig({ imapDraftsPath: form.config.imapDraftsPath || r.draftsPath })
      setTestResult(`연결 성공 — 초안 폴더: ${r.draftsPath}`)
    } catch (e) {
      setTestResult(`연결 실패 — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  const canSave = (): boolean => {
    if (addressInvalid) return false
    if (kind === 'imap') {
      if (!form.config.imapHost?.trim() || !form.address.trim()) return false
      if (isNew && !password) return false
    }
    if ((kind === 'm365' || kind === 'gmail') && !oauthConnected) return false
    return Boolean(form.display_name.trim() || form.address.trim())
  }

  const save = async (): Promise<void> => {
    if (!canSave()) return
    setSaving(true)
    try {
      const input: AccountInput = {
        ...form,
        imapPassword: kind === 'imap' && password ? password : undefined
      }
      const saved = account
        ? await window.api.accounts.update(account.id, input)
        : await window.api.accounts.create(input)
      onSaved(saved, account === null)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{account ? `계정 편집 — ${account.display_name}` : '계정 추가'}</h2>
          <button className="btn ghost sm icon-only" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!account && (
          <div className="kind-grid" role="radiogroup" aria-label="계정 종류">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={`kind-card ${kind === k ? 'chosen' : ''}`}
                onClick={() => setForm({ ...emptyInput(k), is_default: form.is_default })}
              >
                <strong>{ACCOUNT_KIND_LABEL[k]}</strong>
                <span className="muted">{ACCOUNT_KIND_DESC[k]}</span>
              </button>
            ))}
          </div>
        )}
        {account && (
          <p className="muted account-kind-line">
            종류: <span className="badge neutral">{ACCOUNT_KIND_LABEL[kind]}</span>{' '}
            {ACCOUNT_KIND_DESC[kind]}
          </p>
        )}

        {/* 종류별 연결 */}
        <section className="account-connect">
          {kind === 'outlook_local' && (
            <>
              <div className="segment" role="radiogroup" aria-label="Outlook 연동 방식">
                {OUTLOOK_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={(form.config.outlookMode ?? 'auto') === opt.value}
                    className={(form.config.outlookMode ?? 'auto') === opt.value ? 'active' : ''}
                    onClick={() => setConfig({ outlookMode: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="settings-status">
                감지 결과:{' '}
                {detected === null ? (
                  '확인 중…'
                ) : detected === 'com' ? (
                  '클래식 Outlook 설치됨'
                ) : (
                  <>
                    클래식 Outlook 없음 <span className="muted">(새 Outlook → .eml 방식)</span>
                  </>
                )}
              </p>
              {form.config.outlookMode === 'com' && detected === 'eml' && (
                <p className="settings-warn">
                  <CircleAlert size={14} />
                  클래식 Outlook이 감지되지 않았습니다. COM 연동에 실패하면 자동으로 .eml 방식으로
                  넘어갑니다.
                </p>
              )}
              <label className="form-field">
                <span>
                  발신 주소{' '}
                  <em className="muted hint-inline">— 선택. 표시·테스트 초안 수신에 사용</em>
                </span>
                <input
                  type="email"
                  value={form.address}
                  placeholder="예: me@company.com"
                  onChange={(e) => set('address', e.target.value)}
                />
              </label>
            </>
          )}

          {(kind === 'm365' || kind === 'gmail') && (
            <div className="oauth-box">
              {!oauthReady && (
                <p className="settings-warn">
                  <CircleAlert size={14} />
                  {kind === 'm365'
                    ? '먼저 설정 > 연동 앱에 Azure 앱(클라이언트) ID를 입력하세요.'
                    : '먼저 설정 > 연동 앱에 Google OAuth 클라이언트 ID(와 시크릿)를 입력하세요.'}
                </p>
              )}
              <div className="oauth-row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!oauthReady || connecting}
                  onClick={connect}
                >
                  {connecting ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
                  {connecting
                    ? '브라우저에서 로그인 중…'
                    : oauthConnected
                      ? `${kind === 'm365' ? 'Microsoft' : 'Google'} 계정 다시 연결`
                      : `${kind === 'm365' ? 'Microsoft' : 'Google'} 계정 연결`}
                </button>
                {oauthConnected ? (
                  <span className="badge mode-com">
                    <CheckCircle2 size={12} /> 연결됨 {oauthDone ?? form.address}
                  </span>
                ) : (
                  <span className="badge warn">연결 필요</span>
                )}
              </div>
              <p className="muted">
                브라우저가 열리고 로그인하면 앱으로 돌아옵니다. 비밀번호는 저장되지 않으며, 토큰만
                OS 암호화 저장소에 보관됩니다.
              </p>
            </div>
          )}

          {kind === 'imap' && (
            <div className="form-grid">
              <label className="form-field">
                <span>
                  IMAP 서버<em className="req">*</em>
                </span>
                <input
                  value={form.config.imapHost ?? ''}
                  placeholder="예: imap.naver.com"
                  onChange={(e) => setConfig({ imapHost: e.target.value })}
                />
              </label>
              <div className="form-field">
                <span>포트 / 보안</span>
                <div className="imap-port-row">
                  <input
                    type="number"
                    value={form.config.imapPort ?? 993}
                    onChange={(e) => setConfig({ imapPort: Number(e.target.value) })}
                  />
                  <label className="option-inline">
                    <input
                      type="checkbox"
                      checked={form.config.imapSecure !== false}
                      onChange={(e) =>
                        setConfig({
                          imapSecure: e.target.checked,
                          imapPort: e.target.checked ? 993 : 143
                        })
                      }
                    />
                    TLS(SSL)
                  </label>
                </div>
              </div>
              <label className="form-field">
                <span>
                  이메일 주소<em className="req">*</em>
                </span>
                <input
                  type="email"
                  value={form.address}
                  placeholder="예: me@naver.com"
                  onChange={(e) => set('address', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>
                  로그인 ID <em className="muted hint-inline">— 비우면 이메일 주소</em>
                </span>
                <input
                  value={form.config.imapUser ?? ''}
                  onChange={(e) => setConfig({ imapUser: e.target.value })}
                />
              </label>
              <label className="form-field">
                <span>
                  비밀번호(앱 비밀번호)
                  {isNew && <em className="req">*</em>}
                  {!isNew && <em className="muted hint-inline"> — 비우면 저장된 값 유지</em>}
                </span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>
                  초안 폴더 <em className="muted hint-inline">— 비우면 자동 탐지</em>
                </span>
                <input
                  value={form.config.imapDraftsPath ?? ''}
                  placeholder="예: Drafts, 임시보관함"
                  onChange={(e) => setConfig({ imapDraftsPath: e.target.value })}
                />
              </label>
              <div className="form-field form-field-wide imap-test">
                <button
                  type="button"
                  className="btn"
                  disabled={testing || !form.config.imapHost?.trim() || (!password && isNew)}
                  onClick={testImap}
                >
                  {testing ? <Loader2 size={15} className="spin" /> : <MailCheck size={15} />}
                  연결 테스트
                </button>
                {testResult && (
                  <span className={testResult.startsWith('연결 성공') ? 'test-ok' : 'test-fail'}>
                    {testResult.startsWith('연결 성공') ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <XCircle size={14} />
                    )}
                    {testResult}
                  </span>
                )}
              </div>
            </div>
          )}

          <ul className="caps-list">
            <li>
              <span className="caps-label">초안 열림</span>
              {caps.opens}
            </li>
            <li>
              <span className="caps-label">지원</span>
              <span className={`badge ${caps.html ? 'mode-com' : 'warn'}`}>
                HTML 본문 {caps.html ? '지원' : '미지원'}
              </span>
              <span className={`badge ${caps.attachments ? 'mode-com' : 'warn'}`}>
                <Paperclip size={11} /> 첨부 {caps.attachments ? '지원' : '미지원'}
              </span>
            </li>
            {caps.warning && (
              <li className="caps-warning">
                <CircleAlert size={13} />
                {caps.warning}
              </li>
            )}
          </ul>
        </section>

        {/* 공통: 발신 프로필 */}
        <div className="form-grid account-common">
          <label className="form-field">
            <span>계정 이름</span>
            <input
              value={form.display_name}
              placeholder={form.address || '예: 회사 메일'}
              onChange={(e) => set('display_name', e.target.value)}
            />
          </label>
          <div className="form-field">
            <span>기본 계정</span>
            <label className="option-row account-default">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => set('is_default', e.target.checked)}
              />
              초안 만들기에서 기본으로 선택
            </label>
          </div>
        </div>

        <div className="compose-cc">
          <label className={`form-field ${form.default_cc_enabled ? '' : 'field-off'}`}>
            <span className="field-head">
              <span>기본 참조 (CC)</span>
              <Switch
                checked={form.default_cc_enabled}
                onChange={(v) => set('default_cc_enabled', v)}
                label="기본 참조 사용"
              />
            </span>
            <input
              placeholder="예: team@company.com; manager@company.com"
              value={form.default_cc}
              onChange={(e) => set('default_cc', e.target.value)}
              aria-invalid={ccInvalid.length > 0}
            />
            {ccInvalid.length > 0 && (
              <span className="field-error">
                <CircleAlert size={13} />
                올바르지 않은 주소: {ccInvalid.join(', ')}
              </span>
            )}
          </label>
          <label className={`form-field ${form.default_bcc_enabled ? '' : 'field-off'}`}>
            <span className="field-head">
              <span>기본 숨은 참조 (BCC)</span>
              <Switch
                checked={form.default_bcc_enabled}
                onChange={(v) => set('default_bcc_enabled', v)}
                label="기본 숨은 참조 사용"
              />
            </span>
            <input
              placeholder="예: me@company.com"
              value={form.default_bcc}
              onChange={(e) => set('default_bcc', e.target.value)}
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
          <Switch
            checked={form.signature_enabled}
            onChange={(v) => set('signature_enabled', v)}
            label="서명 사용"
          />
        </div>
        <p className="muted">
          이 계정으로 만든 초안 본문 아래에 붙습니다.
          {kind === 'outlook_local' &&
            ' 비워 두면 클래식 Outlook의 기본 서명이 본문 아래에 그대로 유지됩니다.'}
        </p>
        <div className={`signature-editor ${form.signature_enabled ? '' : 'field-off'}`}>
          <RichEditor
            value={form.signature_html}
            placeholder="예: 홍길동 | 영업팀 과장 | 010-0000-0000"
            onChange={(v) => set('signature_html', v)}
          />
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="btn primary" onClick={save} disabled={saving || !canSave()}>
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {isNew ? '계정 추가' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
