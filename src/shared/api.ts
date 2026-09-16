import type {
  Activity,
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicateGroup,
  DuplicatePolicy,
  EmailTemplate,
  ExportFormat,
  ImportParseResult,
  ImportSummary,
  OcrScanResult,
  Organization,
  OrganizationInput,
  OutlookAdapter,
  Person,
  PersonFilter,
  PersonInput,
  TagCount,
  TemplateAttachment,
  TemplateInput,
  UpdateState
} from './types'

/** preload가 렌더러에 노출하는 window.api 계약 */
export interface WhenmailApi {
  people: {
    list: (filter?: PersonFilter) => Promise<Person[]>
    get: (id: number) => Promise<Person | null>
    recent: (limit?: number) => Promise<Person[]>
    create: (input: PersonInput) => Promise<Person>
    update: (id: number, input: PersonInput) => Promise<Person>
    remove: (id: number) => Promise<void>
    /** 여러 사람 일괄 삭제. 삭제된 수 반환 */
    removeMany: (ids: number[]) => Promise<number>
    /** 여러 사람에 공통 값 일괄 적용. 수정된 수 반환 */
    bulkUpdate: (ids: number[], patch: BulkPersonPatch) => Promise<number>
    /** 같은 사람으로 의심되는 묶음 (이메일 동일 / 이름+회사 동일) */
    duplicates: () => Promise<DuplicateGroup[]>
    /** sourceIds를 targetId로 합친다. 합쳐진 사람 반환 */
    merge: (targetId: number, sourceIds: number[]) => Promise<Person>
    /** 목록 내보내기 — 저장 대화상자. 취소 시 null, 성공 시 저장 경로 */
    export: (ids: number[], format: ExportFormat) => Promise<string | null>
  }
  organizations: {
    list: (search?: string) => Promise<Organization[]>
    get: (id: number) => Promise<Organization | null>
    update: (id: number, input: OrganizationInput) => Promise<Organization>
    /** 회사 삭제 — 소속 사람은 남고 회사만 비워진다 */
    remove: (id: number) => Promise<void>
  }
  activities: {
    /** 최신순. personId를 주면 그 사람의 타임라인만 */
    list: (personId?: number, limit?: number) => Promise<Activity[]>
    addNote: (personId: number, text: string) => Promise<Activity>
    remove: (id: number) => Promise<void>
  }
  tags: {
    list: () => Promise<TagCount[]>
  }
  import: {
    /** 파일 선택 대화상자 → 파싱. 취소하면 null */
    pick: () => Promise<ImportParseResult | null>
    commit: (rows: PersonInput[], policy: DuplicatePolicy) => Promise<ImportSummary>
  }
  ocr: {
    /** 명함 이미지 선택 → OCR → 필드 추출. 취소하면 null */
    scanCard: () => Promise<OcrScanResult | null>
  }
  files: {
    /** 앱 데이터 폴더의 명함 이미지를 미리보기용 데이터 URL로 */
    imageDataUrl: (path: string) => Promise<string>
  }
  templates: {
    list: () => Promise<EmailTemplate[]>
    create: (input: TemplateInput) => Promise<EmailTemplate>
    update: (id: number, input: TemplateInput) => Promise<EmailTemplate>
    remove: (id: number) => Promise<void>
    /** 첨부 파일 선택 → 앱 데이터 폴더로 복사. 취소하면 null */
    pickAttachments: () => Promise<TemplateAttachment[] | null>
  }
  drafts: {
    create: (
      targets: DraftTarget[],
      templateId: number,
      options?: DraftOptions
    ) => Promise<DraftResult[]>
  }
  system: {
    version: () => Promise<string>
    /** 설정을 반영한 실제 사용 어댑터 */
    outlookMode: () => Promise<OutlookAdapter>
    /** 설치 여부로 감지된 어댑터 (설정 무시) */
    outlookDetected: () => Promise<OutlookAdapter>
    openDataFolder: () => Promise<string>
    /** 파일이 있는 폴더를 탐색기에서 열고 파일을 선택 상태로 */
    showInFolder: (path: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (input: AppSettings) => Promise<AppSettings>
  }
  update: {
    /** 현재 업데이트 상태 조회 */
    state: () => Promise<UpdateState>
    /** 수동 업데이트 확인 트리거 */
    check: () => Promise<UpdateState>
    /** 다운로드된 업데이트 설치(앱 재시작) */
    install: () => Promise<void>
    /** 상태 변화 구독. 반환값은 구독 해제 함수 */
    onState: (cb: (state: UpdateState) => void) => () => void
  }
  backup: {
    /** zip으로 내보내기. 취소 시 null, 성공 시 저장 경로 */
    export: () => Promise<string | null>
    /** zip에서 복원. 성공하면 앱이 재시작된다. 취소 시 false */
    import: () => Promise<boolean>
  }
}
