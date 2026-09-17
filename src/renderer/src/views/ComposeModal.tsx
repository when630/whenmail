import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MailX,
  Paperclip,
  SendHorizontal,
  TriangleAlert,
  X,
  XCircle
} from 'lucide-react'
import type {
  Account,
  DraftResult,
  EmailTemplate,
  OutlookAdapter,
  Person
} from '../../../shared/types'
import { isHtmlBody, renderTemplate } from '../../../shared/render'
import { invalidAddresses, parseAddressList } from '../../../shared/address'
import {
  ACCOUNT_KIND_LABEL,
  accountLabel,
  capabilitiesOf,
  draftButtonLabel
} from '../../../shared/accounts'
import { useDialog } from '../components/dialogs'

interface Props {
  people: Person[]
  /** 팔레트·할 일에서 미리 고른 템플릿 — 목록에 있으면 기본 선택 */
  initialTemplateId?: number
  /** 이 초안이 처리하는 후속 리마인더 (완료하고 시퀀스를 다음 단계로 넘긴다) */
  fulfillFollowUpId?: number | null
  onClose: () => void
}

const LAST_ACCOUNT_KEY = 'compose-last-account'

function readLastAccount(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_ACCOUNT_KEY))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

/** 결과 안내 — 어댑터별로 초안이 어디에 생겼는지 */
const RESULT_HINT: Record<Account['kind'], string> = {
  outlook_local: 'Outlook에서 각 초안을 확인한 뒤 직접 전송하세요.',
  m365: '웹 Outlook이 열렸습니다. 초안 폴더에서 내용을 확인한 뒤 직접 전송하세요.',
  gmail: 'Gmail 웹이 열렸습니다. 임시보관함에서 내용을 확인한 뒤 직접 전송하세요.',
  imap: '메일 서버의 초안 폴더에 저장되었습니다. 사용하는 메일 클라이언트에서 초안을 열어 전송하세요.'
}

export default function ComposeModal({
  people,
  initialTemplateId,
  fulfillFollowUpId,
  onClose
}: Props): React.JSX.Element {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [detected, setDetected] = useState<OutlookAdapter | null>(null)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [addressBook, setAddressBook] = useState<string[]>([])
  const [includeSignature, setIncludeSignature] = useState(true)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<DraftResult[] | null>(null)
  /** 이 초안 뒤에 회신 확인 리마인더를 걸지 */
  const [followUpOn, setFollowUpOn] = useState(false)
  const [followUpDays, setFollowUpDays] = useState(7)
  /** 사람별로 이번에 보낼 주소 (기본: 대표 주소) */
  const [chosen, setChosen] = useState<Record<number, string>>(() =>
    Object.fromEntries(people.map((p) => [p.id, p.email]))
  )
  const { toast } = useDialog()

  /** 계정을 고르면 그 계정의 기본 참조·서명 여부로 칸을 채운다 */
  const applyAccount = (a: Account): void => {
    setAccountId(a.id)
    setCc(a.default_cc_enabled ? a.default_cc : '')
    setBcc(a.default_bcc_enabled ? a.default_bcc : '')
    setIncludeSignature(a.signature_enabled)
  }

  useEffect(() => {
    window.api.templates.list().then((list) => {
      setTemplates(list)
      const preferred = list.find((t) => t.id === initialTemplateId) ?? list[0]
      if (preferred) setTemplateId(preferred.id)
    })
    window.api.accounts.list().then((list) => {
      setAccounts(list)
      const last = readLastAccount()
      const pick =
        list.find((a) => a.id === last && a.connected) ?? list.find((a) => a.is_default) ?? list[0]
      if (pick) applyAccount(pick)
    })
    window.api.system
      .outlookDetected()
      .then(setDetected)
      .catch(() => undefined)
    window.api.settings
      .get()
      .then((cfg) => {
        setFollowUpDays(cfg.followUpDays)
        setFollowUpOn(cfg.followUpDefaultOn)
      })
      .catch(() => undefined)
    // 참조 입력 자동완성용 — 등록된 모든 주소
    window.api.people
      .list()
      .then((all) =>
        setAddressBook([...new Set(all.flatMap((p) => p.emails.map((e) => e.address)))])
      )
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const account = useMemo(
    () => accounts?.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  )
  const localMode: OutlookAdapter | null =
    account?.kind === 'outlook_local'
      ? account.config.outlookMode === 'com' || account.config.outlookMode === 'eml'
        ? account.config.outlookMode
        : detected
      : null
  const caps = account ? capabilitiesOf(account.kind, localMode) : null

  const targets = useMemo(() => people.filter((p) => p.emails.length > 0), [people])
  const skipped = people.length - targets.length
  const template = useMemo(
    () => templates?.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  )
  const previewPerson = targets[Math.min(previewIdx, targets.length - 1)] ?? null
  const previewEmail = previewPerson ? chosen[previewPerson.id] || previewPerson.email : ''

  const ccList = useMemo(() => parseAddressList(cc), [cc])
  const bccList = useMemo(() => parseAddressList(bcc), [bcc])
  const ccInvalid = useMemo(() => invalidAddresses(cc), [cc])
  const bccInvalid = useMemo(() => invalidAddresses(bcc), [bcc])
  const addressError = ccInvalid.length > 0 || bccInvalid.length > 0
  const hasSignature = Boolean(account?.signature_html.trim())
  const attachments = template?.attachments ?? []

  const preview = useMemo(() => {
    if (!template || !previewPerson) return null
    const data = { ...previewPerson, email: previewEmail }
    const subject = renderTemplate(template.subject_tpl, data)
    const body = renderTemplate(template.body_tpl, data)
    return { subject, body, warnings: [...subject.warnings, ...body.warnings] }
  }, [template, previewPerson, previewEmail])

  const createDrafts = async (): Promise<void> => {
    if (!template || !account || addressError) return
    setSending(true)
    try {
      try {
        localStorage.setItem(LAST_ACCOUNT_KEY, String(account.id))
      } catch {
        /* 무시 */
      }
      setResults(
        await window.api.drafts.create(
          targets.map((p) => ({ personId: p.id, email: chosen[p.id] || p.email })),
          template.id,
          {
            accountId: account.id,
            cc,
            bcc,
            includeSignature: hasSignature ? includeSignature : undefined,
            followUpDays: followUpOn ? followUpDays : undefined,
            fulfillFollowUpId: fulfillFollowUpId ?? undefined
          }
        )
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>메일 초안 만들기</h2>
          <button className="btn ghost sm icon-only" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {results ? (
          <div className="compose-results">
            <ul className="result-list">
              {results.map((r, i) => (
                <li
                  key={r.personId}
                  className={r.ok ? 'ok' : 'fail'}
                  style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}
                >
                  {r.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  {r.personName}
                  {r.ok ? ` — 초안 생성 (${r.adapter})` : ` — ${r.error}`}
                </li>
              ))}
            </ul>
            <p className="hint">{account ? RESULT_HINT[account.kind] : ''}</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        ) : templates === null || accounts === null ? null : templates.length === 0 ? (
          <div className="empty">
            <MailX size={32} strokeWidth={1.4} />
            <span className="empty-title">템플릿이 없습니다</span>
            <span>템플릿 메뉴에서 먼저 템플릿을 만들어 주세요.</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="empty">
            <MailX size={32} strokeWidth={1.4} />
            <span className="empty-title">보낼 계정이 없습니다</span>
            <span>
              설정 &gt; 계정에서 Outlook, Microsoft 365, Gmail 또는 IMAP 계정을 추가하세요.
            </span>
          </div>
        ) : (
          <>
            <div className="compose-meta">
              <label className="form-field">
                <span>템플릿</span>
                <select
                  value={templateId ?? ''}
                  onChange={(e) => setTemplateId(Number(e.target.value))}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>보낼 계정</span>
                <select
                  value={accountId ?? ''}
                  onChange={(e) => {
                    const a = accounts.find((x) => x.id === Number(e.target.value))
                    if (a) applyAccount(a)
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)} — {ACCOUNT_KIND_LABEL[a.kind]}
                      {a.connected ? '' : ' (재연결 필요)'}
                    </option>
                  ))}
                </select>
              </label>
              <div className="compose-recipients">
                받는 사람 {targets.length}명
                {skipped > 0 && <span className="badge warn">이메일 없는 {skipped}명 제외</span>}
              </div>
            </div>

            {account && !account.connected && (
              <p className="settings-warn">
                <TriangleAlert size={14} />이 계정은 다시 연결해야 합니다. 설정 &gt; 계정에서 연결한
                뒤 다시 시도하세요.
              </p>
            )}

            <div className="compose-cc">
              <label className="form-field">
                <span>
                  참조 (CC) <em className="muted">— 쉼표·세미콜론으로 구분, 모든 초안에 공통</em>
                </span>
                <input
                  list="compose-address-book"
                  placeholder="예: team@company.com; manager@company.com"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  aria-invalid={ccInvalid.length > 0}
                />
                {ccInvalid.length > 0 && (
                  <span className="field-error">
                    <TriangleAlert size={13} />
                    올바르지 않은 주소: {ccInvalid.join(', ')}
                  </span>
                )}
              </label>
              <label className="form-field">
                <span>숨은 참조 (BCC)</span>
                <input
                  list="compose-address-book"
                  placeholder="예: me@company.com"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  aria-invalid={bccInvalid.length > 0}
                />
                {bccInvalid.length > 0 && (
                  <span className="field-error">
                    <TriangleAlert size={13} />
                    올바르지 않은 주소: {bccInvalid.join(', ')}
                  </span>
                )}
              </label>
              <datalist id="compose-address-book">
                {addressBook.map((email) => (
                  <option key={email} value={email} />
                ))}
              </datalist>
            </div>

            {hasSignature && (
              <label className="compose-toggle">
                <input
                  type="checkbox"
                  checked={includeSignature}
                  onChange={(e) => setIncludeSignature(e.target.checked)}
                />
                <span>본문 아래에 계정 서명 붙이기</span>
              </label>
            )}

            <div className="compose-followup">
              <label className="compose-toggle">
                <input
                  type="checkbox"
                  checked={followUpOn}
                  onChange={(e) => setFollowUpOn(e.target.checked)}
                />
                <CalendarClock size={14} />
                <span>보낸 뒤 회신이 없으면 알리기</span>
              </label>
              {followUpOn && (
                <span className="days-row">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    aria-label="후속 알림 일수"
                    value={followUpDays}
                    onChange={(e) => setFollowUpDays(Number(e.target.value))}
                  />
                  <span className="muted">일 뒤</span>
                </span>
              )}
              {fulfillFollowUpId ? (
                <span className="badge kind-follow_up">이 초안으로 후속 처리</span>
              ) : null}
            </div>

            {targets.length > 1 && (
              <div className="preview-nav">
                <button
                  className="btn ghost sm icon-only"
                  aria-label="이전 수신자"
                  disabled={previewIdx === 0}
                  onClick={() => setPreviewIdx((i) => i - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  미리보기 {previewIdx + 1} / {targets.length} — {previewPerson?.name}
                </span>
                <button
                  className="btn ghost sm icon-only"
                  aria-label="다음 수신자"
                  disabled={previewIdx >= targets.length - 1}
                  onClick={() => setPreviewIdx((i) => i + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}

            {preview && previewPerson && (
              <div className="preview">
                {account && (
                  <div className="preview-row">
                    <span className="preview-label">보내는 사람</span>
                    <span className="preview-from">
                      {accountLabel(account)}
                      <span className={`badge kind-${account.kind}`}>
                        {ACCOUNT_KIND_LABEL[account.kind]}
                        {localMode ? ` · ${localMode}` : ''}
                      </span>
                    </span>
                  </div>
                )}
                <div className="preview-row">
                  <span className="preview-label">받는 사람</span>
                  <span className="preview-to">
                    {previewPerson.name}
                    {previewPerson.emails.length > 1 ? (
                      <select
                        className="inline-select"
                        aria-label={`${previewPerson.name}에게 보낼 주소`}
                        value={previewEmail}
                        onChange={(e) =>
                          setChosen((c) => ({ ...c, [previewPerson.id]: e.target.value }))
                        }
                      >
                        {previewPerson.emails.map((e) => (
                          <option key={e.id} value={e.address}>
                            {e.address}
                            {e.label ? ` (${e.label})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span> &lt;{previewEmail}&gt;</span>
                    )}
                  </span>
                </div>
                {ccList.length > 0 && (
                  <div className="preview-row">
                    <span className="preview-label">참조</span>
                    <span>{ccList.join(', ')}</span>
                  </div>
                )}
                {bccList.length > 0 && (
                  <div className="preview-row">
                    <span className="preview-label">숨은 참조</span>
                    <span>{bccList.join(', ')}</span>
                  </div>
                )}
                <div className="preview-row">
                  <span className="preview-label">제목</span>
                  <span>{preview.subject.text}</span>
                </div>
                {attachments.length > 0 && (
                  <div className="preview-row">
                    <span className="preview-label">첨부</span>
                    <span className="preview-attach">
                      {attachments.map((a) => (
                        <span key={a.path} className="badge neutral">
                          <Paperclip size={11} />
                          {a.name}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {isHtmlBody(preview.body.text) ? (
                  <div
                    className="preview-body preview-html"
                    // 로컬 데이터(사용자 본인이 작성한 템플릿)만 렌더링
                    dangerouslySetInnerHTML={{ __html: preview.body.text }}
                  />
                ) : (
                  <pre className="preview-body">{preview.body.text}</pre>
                )}
                {caps && (
                  <ul className="warning-list caps-inline">
                    <li>
                      <span className="caps-label">초안</span>
                      <span>{caps.opens}</span>
                    </li>
                    {caps.warning && (
                      <li>
                        <TriangleAlert size={14} />
                        <span>{caps.warning}</span>
                      </li>
                    )}
                    {attachments.length > 0 && !caps.attachments && (
                      <li>
                        <TriangleAlert size={14} />
                        <span>이 경로는 첨부를 전달하지 못합니다.</span>
                      </li>
                    )}
                  </ul>
                )}
                {preview.warnings.length > 0 && (
                  <ul className="warning-list">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>
                        <TriangleAlert size={14} />
                        <span>
                          <code>{`{{${w.variable}}}`}</code>
                          {w.usedDefault !== null
                            ? ` 값이 비어 기본값 '${w.usedDefault}'이(가) 사용됩니다`
                            : ' 값이 비어 있어 치환되지 않습니다'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={onClose} disabled={sending}>
                취소
              </button>
              <button
                className="btn primary"
                onClick={createDrafts}
                disabled={
                  sending ||
                  !template ||
                  !account ||
                  !account.connected ||
                  targets.length === 0 ||
                  addressError
                }
              >
                {sending ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    초안 생성 중…
                  </>
                ) : (
                  <>
                    <SendHorizontal size={15} />
                    {account ? draftButtonLabel(account.kind) : '초안 만들기'}
                    {targets.length > 1 ? ` (${targets.length}건)` : ''}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
