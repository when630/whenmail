# whenmail

명함으로 만난 사람을 한곳에 모아 두고, 이메일 템플릿에 그 사람 정보를 치환해 **메일 초안**으로 만들어주는 개인용 데스크톱 앱. 메일 클라이언트를 대신하지 않고, 여러 메일 계정 위에 얹히는 **사람 관계 레이어**를 목표로 한다. 어떤 계정으로도 메일을 자동 전송하지 않고 초안까지만 만든다.

## 기능

- **사람** — 사람 1명에 이메일 주소 여러 개(대표 주소 지정)·명함 여러 장·태그. 수동 입력 / CSV·엑셀 가져오기(컬럼 자동 매핑·중복 검사) / **명함 사진 OCR**(Tesseract 로컬 인식) / 선택 사람 **일괄 수정·삭제** / **중복 정리**(같은 이메일·같은 이름+회사를 묶어 한 사람으로 병합) / **CSV·xlsx 내보내기**(가져오기와 같은 열이라 그대로 다시 읽힘)
- **사람 상세** — 연락 수단·명함·태그·메모와 **타임라인**(초안 생성·메모·명함 등록·병합 + 실제 메일 송수신). 마지막 보낸 날·받은 날과 회신 대기 여부를 확인하고, 그 사람 주소만 다시 확인할 수 있다
- **회사** — 사람 저장 시 자동으로 묶이는 회사 엔티티. 이메일 도메인 자동 추출, 메모, 소속 사람 보기
- **계정** — 계정 종류가 초안 생성 경로를 정한다. 계정마다 서명·기본 참조·숨은 참조를 따로 둔다
  | 종류 | 초안이 만들어지는 곳 | 연결 방법 |
  |---|---|---|
  | 이 PC의 Outlook | 클래식은 COM으로 새 창, 새 Outlook은 `.eml` | 설치된 Outlook 자동 감지 |
  | Microsoft 365 | Graph API로 초안 폴더 → 웹 Outlook 열기 | 브라우저 OAuth (Azure 앱 ID 필요) |
  | Gmail | Gmail API로 임시보관함 → Gmail 웹 열기 | 브라우저 OAuth (Google 클라이언트 필요) |
  | IMAP (범용) | 메일 서버의 초안 폴더에 APPEND | 서버·앱 비밀번호, 초안 폴더 자동 탐지 |
- **이메일 템플릿** — `{{이름}}`, `{{회사|귀사}}` 같은 변수 치환 + 수신자별 미리보기와 빈 변수 경고, 글꼴·크기·색 리치 에디터, 템플릿별 **첨부 파일**
- **초안 만들기** — 사람 선택 → 템플릿 → 보낼 계정 → 수신 주소(여러 개면 선택) → 미리보기. 계정별 지원 범위(HTML·첨부·초안이 열리는 곳)를 미리보기에 배지로 표시
- **메일 읽기(선택)** — 계정마다 켜면 등록된 사람과 오간 메일의 **제목·날짜·방향만** 가져와 사람 타임라인에 섞는다. 본문과 첨부는 저장하지 않고, 원문은 클릭해서 메일 클라이언트에서 연다
- **알림함** — 앱은 백그라운드에 상주하지 않는다. 회신 대기·회신 도착·동기화 실패를 알림함에 쌓아 두고 앱을 켤 때 확인한다. 회신이 오면 대기 알림은 자동으로 닫힌다
- **답장 대기** — 보낸 뒤 정해진 기간(기본 7일) 동안 답이 없는 사람을 목록에서 걸러 본다
- **활동** — 초안·메모·명함·병합 기록을 한 타임라인으로. 종류 필터와 검색
- **Ctrl+K 커맨드 팔레트** — 사람 검색 → 템플릿 선택 → 초안까지 키보드만으로
- zip 백업/복원, 자동 업데이트

## 연동 앱 등록 (Microsoft 365 · Gmail을 쓸 때만)

OAuth로 연결하는 계정은 본인 명의의 앱을 한 번 등록하고 설정 > 연동 앱에 클라이언트 ID를 넣는다. 앱은 PKCE 공개 클라이언트로 동작하며 사용자의 메일 비밀번호를 받지 않는다.

- **Microsoft 365**: Azure 포털 → 앱 등록 → 인증 → 플랫폼 추가 "모바일 및 데스크톱 애플리케이션" → 리디렉션 URI `http://localhost`. API 권한(위임): `Mail.ReadWrite`, `User.Read`. 초안용 권한에 읽기가 포함되어 메일 읽기에 추가 동의가 필요 없다
- **Gmail**: Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → 유형 "데스크톱 앱". Gmail API를 사용 설정하고, OAuth 동의 화면의 테스트 사용자에 본인 계정을 추가. 데스크톱 앱 유형은 클라이언트 시크릿을 함께 발급하므로 설정에 같이 입력한다. 메일 읽기를 켜면 목록 검색 때문에 `gmail.readonly`가 추가로 필요해 다시 연결해야 한다(조회는 헤더만 요청한다)

## 데이터

- 모든 데이터는 `%APPDATA%/whenmail/` 아래 로컬 SQLite(`whenmail.db`) + 명함 이미지·첨부 파일. 서버 없음
- OAuth 토큰과 IMAP 비밀번호는 `credentials.json`에 Electron `safeStorage`(OS 암호화)로 보관하며 **백업 zip에는 들어가지 않는다**. 복원 후에는 계정을 다시 연결해야 하고, 그때까지 "재연결 필요"로 표시된다
- 메일은 헤더만 인덱싱한다(`mail_index`). 본문·첨부는 어느 경로로도 저장하지 않는다
- 스키마는 `schema_version`으로 관리한다. v1(명함 1장 = 연락처 1건) → v2(사람/회사/활동) → v3(계정) → v4(메일 인덱스·알림함)까지 첫 실행 시 자동 이전되며, v1에서 올라올 때는 `whenmail.db.bak-v1` 사본을 남긴다
- v0.4.x(whenimail) 데이터 폴더·DB 파일명도 첫 실행 시 자동으로 옮겨진다

## 개발

```bash
npm install
npm run dev        # 개발 실행
npm run build:win  # Windows 설치본 빌드
npm test           # vitest (치환기·명함 파서·가져오기/내보내기 왕복)
```

스택: Electron + React + TypeScript + Vite / better-sqlite3 / tesseract.js / SheetJS / ImapFlow / electron-builder

브라우저에서 렌더러만 열면(`npx electron-vite dev --rendererOnly` → http://localhost:5173) mock API가 붙어 UI를 확인할 수 있다. `?view=people|companies|templates|activity|settings`, `?palette=1`, `?notify=1`.

## 릴리즈 방법

자동 업데이트(electron-updater)가 GitHub 릴리즈를 읽으므로, 릴리즈에는 반드시 세 자산을 함께 올린다:

```bash
# 1. package.json version 올리고 커밋
# 2. 빌드
npm run build && npx electron-builder --win --publish never
# 3. 태그 + 릴리즈 (setup.exe / latest.yml / blockmap 필수)
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z dist/whenmail-X.Y.Z-setup.exe dist/latest.yml dist/whenmail-X.Y.Z-setup.exe.blockmap --title "whenmail vX.Y.Z" --notes "..."
```

`latest.yml`이 빠지면 설치된 앱이 새 버전을 감지하지 못한다.

## 문서

- [설계 문서](docs/01_설계.md) — 요구사항, IA, UX 플로우, 데이터 모델, 계정·어댑터 전략, 마일스톤 M4~M7, 오픈이슈
