/** 사람에 붙는 이메일 주소. 한 사람이 회사·개인·이전 직장 주소를 여럿 가질 수 있다 */
export interface EmailAddress {
  id: number
  address: string
  /** 초안의 기본 수신 주소 */
  is_primary: boolean
  /** 회사 | 개인 | 이전 등 자유 라벨 (비어 있을 수 있음) */
  label: string
}

/** 사람에 붙는 명함 이미지 — 사람 1명에 명함 N장(앞/뒷면, 재발급 등) */
export interface BusinessCard {
  id: number
  image_path: string
  received_at: string
}

export interface Organization {
  id: number
  name: string
  /** 이메일 도메인 — 소속 사람의 회사 주소에서 자동 추출, 수정 가능 */
  domain: string
  memo: string
  /** 소속 사람 수 (조회 시 계산) */
  person_count: number
  created_at: string
  updated_at: string
}

export type OrganizationInput = Pick<Organization, 'name' | 'domain' | 'memo'>

export interface Person {
  id: number
  name: string
  organization_id: number | null
  /** 소속 회사 이름 (organization.name, 없으면 '') */
  company: string
  department: string
  title: string
  /** 대표 이메일 (emails 중 is_primary, 없으면 '') — 템플릿 치환·목록 표시용 */
  email: string
  emails: EmailAddress[]
  phone: string
  mobile: string
  address: string
  website: string
  memo: string
  cards: BusinessCard[]
  tags: string[]
  /** 마지막 연락 일시 — 초안 생성과 실제 송수신 중 가장 최근 */
  last_contact_at: string | null
  /** 이 사람에게서 마지막으로 받은 시각 (읽기 동기화 결과) */
  last_inbound_at: string | null
  /** 이 사람에게 마지막으로 보낸 시각 (초안 생성 또는 실제 발신) */
  last_outbound_at: string | null
  /** 내가 보낸 뒤 설정한 기간이 지나도록 회신이 없는 상태 (조회 시 계산) */
  awaiting_reply: boolean
  created_at: string
  updated_at: string
}

export interface PersonInput {
  name: string
  /** 회사 이름 — 저장 시 organization을 찾거나 새로 만든다. 비우면 소속 없음 */
  company: string
  department: string
  title: string
  /** 이메일 주소 목록. 첫 항목이 대표 주소 */
  emails: string[]
  phone: string
  mobile: string
  address: string
  website: string
  memo: string
  tags: string[]
  /** 새로 붙일 명함 이미지 경로(OCR 스캔 등으로 앱 폴더에 복사된 파일) */
  new_card_paths?: string[]
  /** 떼어낼 기존 명함 id */
  remove_card_ids?: number[]
}

export interface PersonFilter {
  search?: string
  tag?: string
  organizationId?: number
  /** 답장 대기 중인 사람만 */
  awaitingReply?: boolean
}

export interface TagCount {
  name: string
  count: number
}

export interface EmailTemplate {
  id: number
  name: string
  subject_tpl: string
  body_tpl: string
  attachments: TemplateAttachment[]
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export type TemplateInput = Pick<EmailTemplate, 'name' | 'subject_tpl' | 'body_tpl' | 'attachments'>

/** 템플릿 첨부 파일 — 앱 데이터 폴더(attachments/)로 복사된 사본을 가리킨다 */
export interface TemplateAttachment {
  /** 원본 파일명 (메일에 보이는 이름) */
  name: string
  /** 복사본 절대 경로 */
  path: string
  size: number
}

/** 로컬 Outlook 어댑터 체인 (COM → .eml → mailto) */
export type OutlookAdapter = 'com' | 'eml' | 'mailto'

/** 설정에서 고른 로컬 Outlook 연동 방식. auto는 설치 여부로 자동 감지 */
export type OutlookModePref = 'auto' | 'com' | 'eml'

/** 초안을 실제로 만든 경로 — 로컬 Outlook 3종 + API/IMAP 3종 */
export type DraftAdapterKind = OutlookAdapter | 'graph' | 'gmail' | 'imap'

/* ────────────────────────── 계정 ────────────────────────── */

/**
 * 계정 종류가 초안 생성 경로를 결정한다.
 * outlook_local: 이 PC의 Outlook(COM/.eml) · m365: Graph API · gmail: Gmail API · imap: IMAP 초안 폴더
 */
export type AccountKind = 'outlook_local' | 'm365' | 'gmail' | 'imap'

/** 종류별 비밀 아닌 설정 */
export interface AccountConfig {
  /** outlook_local */
  outlookMode?: OutlookModePref
  /** imap */
  imapHost?: string
  imapPort?: number
  imapSecure?: boolean
  imapUser?: string
  /** 초안 폴더 경로 (연결 테스트로 자동 탐지, 비우면 \Drafts special-use) */
  imapDraftsPath?: string
  /** 읽기 동기화에서 훑을 폴더 (비우면 INBOX + \Sent 자동 탐지) */
  imapReadPaths?: string[]
}

/** 계정 = 발신 프로필. 서명·기본 참조는 템플릿이 아니라 계정에 속한다 */
export interface Account {
  id: number
  kind: AccountKind
  display_name: string
  /** 발신 주소 (OAuth 계정은 연결 시 자동, 로컬 Outlook은 비어 있을 수 있음) */
  address: string
  signature_html: string
  signature_enabled: boolean
  default_cc: string
  default_cc_enabled: boolean
  default_bcc: string
  default_bcc_enabled: boolean
  /** 초안 만들기에서 기본 선택되는 계정 */
  is_default: boolean
  config: AccountConfig
  /** OAuth 토큰·IMAP 비밀번호가 저장되어 있는지 (로컬 Outlook은 항상 true) */
  connected: boolean
  /** 메일 읽기 권한이 있는지 — OAuth는 토큰 스코프, IMAP은 연결되면 가능, 로컬 Outlook은 불가 */
  can_read: boolean
  /** 읽기 동기화 사용 여부 */
  sync_enabled: boolean
  last_sync_at: string | null
  last_sync_error: string
  created_at: string
  updated_at: string
}

export interface AccountInput {
  kind: AccountKind
  display_name: string
  address: string
  signature_html: string
  signature_enabled: boolean
  default_cc: string
  default_cc_enabled: boolean
  default_bcc: string
  default_bcc_enabled: boolean
  is_default: boolean
  config: AccountConfig
  /** 읽기 동기화 사용 여부 */
  sync_enabled: boolean
  /** imap: 비밀번호(앱 비밀번호). 비우면 기존 값 유지 */
  imapPassword?: string
  /** m365/gmail: connectOAuth가 돌려준 임시 토큰 키 — 저장 시 계정으로 옮긴다 */
  pendingOAuthKey?: string
}

/** OAuth 연결 결과 */
export interface OAuthResult {
  address: string
  displayName: string
  /** 메일 읽기 권한까지 받았는지 */
  canRead: boolean
  /** 새 계정일 때 토큰이 임시로 저장된 키. AccountInput.pendingOAuthKey로 넘긴다 */
  pendingKey?: string
}

/** 종류별 지원 범위 — 설정 화면과 미리보기 배지에 그대로 표시 */
export interface AccountCapabilities {
  html: boolean
  attachments: boolean
  /** 초안이 어디에 만들어지고 어떻게 열리는지 */
  opens: string
  /** 주의 문구 (없으면 '') */
  warning: string
}

/* ────────────────────────── 활동 ────────────────────────── */

/** 사람 타임라인의 한 줄. card=명함 등록, draft=초안 생성, note=메모, merge=병합 */
export type ActivityKind = 'card' | 'draft' | 'note' | 'merge'

export interface Activity {
  id: number
  /** 사람이 삭제되면 null — 스냅샷(person_name 등)으로 표시 */
  person_id: number | null
  kind: ActivityKind
  template_id: number | null
  /** 초안을 만든 계정 (삭제되면 null) */
  account_id: number | null
  person_name: string
  /** 초안을 보낸 수신 주소 (draft) */
  person_email: string
  template_name: string
  /** 초안 제목, 메모 본문, 병합 설명 등 */
  summary: string
  adapter: DraftAdapterKind | ''
  occurred_at: string
}

/** 초안 대상 — 사람 + 이번에 보낼 주소(여러 주소 중 선택) */
export interface DraftTarget {
  personId: number
  email: string
}

export interface DraftResult {
  personId: number
  personName: string
  ok: boolean
  adapter?: DraftAdapterKind
  error?: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'
  /** 새 버전 (available/downloading/ready) */
  version?: string
  /** 다운로드 진행률 0~100 */
  percent?: number
  message?: string
}

export interface OcrScanResult {
  /** 추출된 필드 (확신 없는 필드는 없음) */
  fields: Partial<PersonInput>
  /** 앱 데이터 폴더로 복사된 명함 이미지 경로 */
  imagePath: string
  /** 미리보기용 데이터 URL */
  imageDataUrl: string
  rawText: string
}

export interface ImportParseResult {
  fileName: string
  headers: string[]
  rows: string[][]
}

export type DuplicatePolicy = 'skip' | 'overwrite'

export interface ImportSummary {
  inserted: number
  updated: number
  skipped: number
  /** 이름이 비어 건너뛴 행 수 */
  invalid: number
}

export type ExportFormat = 'csv' | 'xlsx'

/** 같은 사람으로 의심되는 묶음 */
export interface DuplicateGroup {
  /** 묶음 식별자 (정렬된 사람 id 조합) */
  key: string
  reason: 'email' | 'name_company'
  /** 겹치는 값 — 이메일 주소 또는 "이름 · 회사" */
  value: string
  people: Person[]
}

/* ────────────────────────── 메일 읽기 ────────────────────────── */

/** 읽기 어댑터가 돌려주는 메일 헤더 — 본문·첨부는 담지 않는다 */
export interface MailHeader {
  /** 계정 안에서 고유한 메시지 식별자 */
  messageId: string
  threadId: string
  /** in = 상대에게서 받음, out = 내가 보냄 */
  direction: 'in' | 'out'
  /** 상대 주소 (질의에 쓴 주소) */
  counterpart: string
  subject: string
  /** ISO 또는 'YYYY-MM-DD HH:mm:ss' */
  occurredAt: string
  /** 원문을 여는 링크나 식별자 */
  openRef: string
}

/** 사람 타임라인에 섞여 들어가는 메일 한 줄 */
export interface MailEntry extends MailHeader {
  id: number
  accountId: number
  /** 계정 표시 이름 */
  accountName: string
}

export type SyncPhase = 'idle' | 'running' | 'done' | 'error'

export interface SyncState {
  phase: SyncPhase
  /** 진행 중인 계정 이름 */
  account?: string
  /** 처리한 계정 수 / 전체 */
  done: number
  total: number
  /** 이번 동기화로 새로 들어온 메일 수 */
  fetched: number
  message?: string
  finishedAt?: string
}

/* ────────────────────────── 알림함 ────────────────────────── */

/**
 * awaiting_reply: 보낸 뒤 기간이 지나도 회신 없음
 * reply_received: 기다리던 사람에게서 회신 도착
 * sync_error: 계정 동기화 실패
 */
export type NotificationKind = 'awaiting_reply' | 'reply_received' | 'sync_error'

export type NotificationStatus = 'unread' | 'read' | 'done'

export interface AppNotification {
  id: number
  kind: NotificationKind
  person_id: number | null
  person_name: string
  account_id: number | null
  title: string
  body: string
  status: NotificationStatus
  created_at: string
  resolved_at: string | null
}

export interface RenderWarning {
  variable: string
  /** 값이 비어 기본값이 쓰였으면 그 기본값, 기본값도 없으면 null */
  usedDefault: string | null
}

/** 앱 전역 설정 — 연동 앱(OAuth 클라이언트) 정보. 계정별 값은 Account에 있다 */
export interface AppSettings {
  /** Azure 앱 등록의 애플리케이션(클라이언트) ID. 리디렉션 URI http://localhost (모바일 및 데스크톱) */
  msClientId: string
  /** Google Cloud OAuth 클라이언트 ID (데스크톱 앱 유형) */
  googleClientId: string
  /** Google 데스크톱 앱 클라이언트 시크릿이 저장돼 있는지 (값은 돌려주지 않음) */
  hasGoogleClientSecret: boolean
  /** 저장 시에만 쓰는 시크릿 값. 빈 문자열이면 유지, 'CLEAR'면 삭제 */
  googleClientSecret?: string
  /** 보낸 뒤 이 일수가 지나도 회신이 없으면 "답장 대기"로 본다 (기본 7) */
  awaitingReplyDays: number
  /** 앱을 켤 때 읽기 동기화를 자동으로 한 번 돌릴지 */
  syncOnStartup: boolean
}

/** 초안 생성 시 모든 수신자에게 공통 적용되는 옵션 */
export interface DraftOptions {
  /** 보낼 계정. 없으면 기본 계정 */
  accountId?: number
  /** 참조 — 쉼표/세미콜론 구분 */
  cc?: string
  /** 숨은 참조 — 쉼표/세미콜론 구분 */
  bcc?: string
  /** 이번 초안에 계정 서명을 붙일지 (기본: 계정의 서명 사용 여부) */
  includeSignature?: boolean
}

/** 여러 사람에 공통 적용하는 일괄 수정 내용 */
export interface BulkPersonPatch {
  /** 값이 있는 키만 덮어쓴다 (빈 문자열도 "비우기"로 적용) */
  fields: Partial<
    Pick<PersonInput, 'company' | 'department' | 'title' | 'phone' | 'address' | 'website'>
  >
  tags?: {
    mode: 'add' | 'remove' | 'replace'
    values: string[]
  }
}
