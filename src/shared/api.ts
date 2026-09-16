import type {
  AppSettings,
  BulkContactPatch,
  Contact,
  ContactInput,
  DraftLog,
  DraftOptions,
  DraftResult,
  DuplicatePolicy,
  EmailTemplate,
  ImportParseResult,
  ImportSummary,
  OcrScanResult,
  OutlookAdapter,
  TagCount,
  TemplateAttachment,
  TemplateInput,
  UpdateState
} from './types'

/** preload가 렌더러에 노출하는 window.api 계약 */
export interface WhenmailApi {
  contacts: {
    list: (search?: string, tag?: string) => Promise<Contact[]>
    recent: (limit?: number) => Promise<Contact[]>
    create: (input: ContactInput) => Promise<Contact>
    update: (id: number, input: ContactInput) => Promise<Contact>
    remove: (id: number) => Promise<void>
    /** 여러 명함 일괄 삭제. 삭제된 수 반환 */
    removeMany: (ids: number[]) => Promise<number>
    /** 여러 명함에 공통 값 일괄 적용. 수정된 수 반환 */
    bulkUpdate: (ids: number[], patch: BulkContactPatch) => Promise<number>
  }
  tags: {
    list: () => Promise<TagCount[]>
  }
  import: {
    /** 파일 선택 대화상자 → 파싱. 취소하면 null */
    pick: () => Promise<ImportParseResult | null>
    commit: (rows: ContactInput[], policy: DuplicatePolicy) => Promise<ImportSummary>
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
      contactIds: number[],
      templateId: number,
      options?: DraftOptions
    ) => Promise<DraftResult[]>
    history: () => Promise<DraftLog[]>
  }
  system: {
    version: () => Promise<string>
    /** 설정을 반영한 실제 사용 어댑터 */
    outlookMode: () => Promise<OutlookAdapter>
    /** 설치 여부로 감지된 어댑터 (설정 무시) */
    outlookDetected: () => Promise<OutlookAdapter>
    openDataFolder: () => Promise<string>
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
