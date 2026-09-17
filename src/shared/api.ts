import type {
  Account,
  AccountInput,
  AccountKind,
  Activity,
  AppNotification,
  AppSettings,
  BulkPersonPatch,
  DraftOptions,
  DraftResult,
  DraftTarget,
  DuplicateGroup,
  DuplicatePolicy,
  EmailTemplate,
  ExportFormat,
  FollowUp,
  FollowUpInput,
  FollowUpStatus,
  ImportParseResult,
  ImportSummary,
  MailEntry,
  NotificationStatus,
  OAuthResult,
  OcrScanResult,
  Organization,
  OrganizationInput,
  OutlookAdapter,
  Person,
  PersonFilter,
  PersonInput,
  PersonSequence,
  Sequence,
  SequenceInput,
  SyncState,
  TagCount,
  TemplateAttachment,
  TemplateInput,
  TodoItem,
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
  accounts: {
    list: () => Promise<Account[]>
    get: (id: number) => Promise<Account | null>
    create: (input: AccountInput) => Promise<Account>
    update: (id: number, input: AccountInput) => Promise<Account>
    /** 계정 삭제 — 토큰·비밀번호도 함께 지운다. 초안 활동은 남는다 */
    remove: (id: number) => Promise<void>
    setDefault: (id: number) => Promise<Account[]>
    /**
     * 브라우저로 Microsoft 365 / Gmail 인증. accountId가 있으면 그 계정에 다시 연결,
     * 없으면 pendingKey를 돌려주고 계정 저장 시 pendingOAuthKey로 넘긴다
     */
    connectOAuth: (
      kind: Extract<AccountKind, 'm365' | 'gmail'>,
      accountId?: number,
      /** 읽기 동기화용 스코프까지 함께 요청 */
      withRead?: boolean
    ) => Promise<OAuthResult>
    /** IMAP 접속 확인 + 초안 폴더 탐지. accountId가 있고 비밀번호를 비우면 저장된 값 사용 */
    testImap: (input: AccountInput, accountId?: number) => Promise<{ draftsPath: string }>
    /** 계정 자기 주소로 테스트 초안 1건 */
    sendTest: (id: number) => Promise<DraftResult>
  }
  mail: {
    /** 사람과 오간 메일 헤더 (최신순) */
    list: (personId: number, limit?: number) => Promise<MailEntry[]>
  }
  notifications: {
    /** 알림함. 기본은 처리 완료를 뺀 목록 */
    list: (includeDone?: boolean) => Promise<AppNotification[]>
    unreadCount: () => Promise<number>
    setStatus: (id: number, status: NotificationStatus) => Promise<AppNotification[]>
    markAllRead: () => Promise<AppNotification[]>
    /** 처리 완료 알림 비우기 (onlyDone=false면 전부) */
    clear: (onlyDone?: boolean) => Promise<AppNotification[]>
  }
  followUps: {
    /** 열린 후속. personId를 주면 그 사람만, includeClosed면 처리한 것도 */
    list: (personId?: number, includeClosed?: boolean) => Promise<FollowUp[]>
    create: (input: FollowUpInput) => Promise<FollowUp>
    setStatus: (id: number, status: FollowUpStatus) => Promise<FollowUp | null>
    /** 기한을 n일 뒤로 미룬다 */
    snooze: (id: number, days: number) => Promise<FollowUp | null>
    /** 처리 완료. 시퀀스 단계였으면 다음 단계를 예약한다 */
    complete: (id: number) => Promise<FollowUp | null>
  }
  todos: {
    /** 후속 + 답장 대기를 합친 할 일 목록 (기한 지난 것 먼저) */
    list: () => Promise<TodoItem[]>
  }
  sequences: {
    list: () => Promise<Sequence[]>
    create: (input: SequenceInput) => Promise<Sequence>
    update: (id: number, input: SequenceInput) => Promise<Sequence>
    remove: (id: number) => Promise<void>
    /** 사람에게 시퀀스를 시작한다 (1단계가 바로 할 일로 뜬다) */
    start: (personId: number, sequenceId: number) => Promise<PersonSequence>
    stop: (personSequenceId: number) => Promise<void>
    /** 진행 중인 시퀀스. personId를 주면 그 사람만 */
    running: (personId?: number) => Promise<PersonSequence[]>
  }
  sync: {
    state: () => Promise<SyncState>
    /** 지금 동기화. personId를 주면 그 사람 주소만 */
    run: (personId?: number) => Promise<SyncState>
    onState: (cb: (state: SyncState) => void) => () => void
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
    /** 설치 여부로 감지된 로컬 Outlook 어댑터 */
    outlookDetected: () => Promise<OutlookAdapter>
    openDataFolder: () => Promise<string>
    /** 파일이 있는 폴더를 탐색기에서 열고 파일을 선택 상태로 */
    showInFolder: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
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
