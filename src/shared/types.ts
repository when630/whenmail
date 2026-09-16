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
  /** 마지막 연락 일시 (현재는 마지막 초안 생성 기준. 읽기 통합 후 송수신 반영) */
  last_contact_at: string | null
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

export type OutlookAdapter = 'com' | 'eml' | 'mailto'

/** 사람 타임라인의 한 줄. card=명함 등록, draft=초안 생성, note=메모, merge=병합 */
export type ActivityKind = 'card' | 'draft' | 'note' | 'merge'

export interface Activity {
  id: number
  /** 사람이 삭제되면 null — 스냅샷(person_name 등)으로 표시 */
  person_id: number | null
  kind: ActivityKind
  template_id: number | null
  person_name: string
  /** 초안을 보낸 수신 주소 (draft) */
  person_email: string
  template_name: string
  /** 초안 제목, 메모 본문, 병합 설명 등 */
  summary: string
  adapter: OutlookAdapter | ''
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
  adapter?: OutlookAdapter
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

export interface RenderWarning {
  variable: string
  /** 값이 비어 기본값이 쓰였으면 그 기본값, 기본값도 없으면 null */
  usedDefault: string | null
}

/** 설정에서 고른 Outlook 연동 방식. auto는 설치 여부로 자동 감지 */
export type OutlookModePref = 'auto' | 'com' | 'eml'

export interface AppSettings {
  outlookMode: OutlookModePref
  /** 본문 아래에 붙일 앱 자체 서명(HTML). 비우면 Outlook 기본 서명에 맡긴다 */
  signatureHtml: string
  /** 서명을 실제로 붙일지 — 끄면 값은 보존하되 적용하지 않는다 */
  signatureEnabled: boolean
  /** 초안 모달을 열 때 미리 채워지는 참조 주소 (쉼표/세미콜론 구분) */
  defaultCc: string
  defaultCcEnabled: boolean
  /** 초안 모달을 열 때 미리 채워지는 숨은 참조 주소 */
  defaultBcc: string
  defaultBccEnabled: boolean
}

/** 초안 생성 시 모든 수신자에게 공통 적용되는 옵션 */
export interface DraftOptions {
  /** 참조 — 쉼표/세미콜론 구분 */
  cc?: string
  /** 숨은 참조 — 쉼표/세미콜론 구분 */
  bcc?: string
  /** 이번 초안에 앱 서명을 붙일지 (기본: 설정의 서명 사용 여부) */
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
