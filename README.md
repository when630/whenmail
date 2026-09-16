# whenmail

명함으로 만난 사람을 한곳에 모아 두고, 이메일 템플릿에 그 사람 정보를 치환해 **Outlook 새 메일 초안**으로 열어주는 개인용 데스크톱 앱. 메일 클라이언트를 대신하지 않고, 여러 메일 계정 위에 얹히는 **사람 관계 레이어**를 목표로 한다.

## 기능

- **사람** — 사람 1명에 이메일 주소 여러 개(대표 주소 지정)·명함 여러 장·태그. 수동 입력 / CSV·엑셀 가져오기(컬럼 자동 매핑·중복 검사) / **명함 사진 OCR**(Tesseract 로컬 인식) / 선택 사람 **일괄 수정·삭제** / **중복 정리**(같은 이메일·같은 이름+회사를 묶어 한 사람으로 병합) / **CSV·xlsx 내보내기**(가져오기와 같은 열이라 그대로 다시 읽힘)
- **사람 상세** — 연락 수단·명함·태그·메모와 **타임라인**(초안 생성·메모·명함 등록·병합). 메모를 남기고 마지막 연락일을 확인
- **회사** — 사람 저장 시 자동으로 묶이는 회사 엔티티. 이메일 도메인 자동 추출, 메모, 소속 사람 보기
- **이메일 템플릿** — `{{이름}}`, `{{회사|귀사}}` 같은 변수 치환 + 수신자별 미리보기와 빈 변수 경고, 글꼴·크기·색 리치 에디터, 템플릿별 **첨부 파일**
- **Outlook 연동** — 자동 전송 없이 초안을 열어 검토 후 직접 전송 (COM → .eml → mailto 어댑터 체인). 사람에게 주소가 여럿이면 초안마다 보낼 주소 선택. 설정에서 클래식/새 Outlook 선택, 참조·숨은 참조, 본문 아래 서명
- **활동** — 초안·메모·명함·병합 기록을 한 타임라인으로. 종류 필터와 검색
- **Ctrl+K 커맨드 팔레트** — 사람 검색 → 템플릿 선택 → 초안까지 키보드만으로
- zip 백업/복원, 자동 업데이트

## 데이터

- 모든 데이터는 `%APPDATA%/whenmail/` 아래 로컬 SQLite(`whenmail.db`) + 명함 이미지·첨부 파일. 서버 없음
- 스키마는 `schema_version`으로 관리한다. v0.5.0에서 v1(명함 1장 = 연락처 1건) → v2(사람/이메일/회사/명함/활동)로 자동 이전되며, 이전 직전 `whenmail.db.bak-v1` 사본을 남긴다
- v0.4.x(whenimail) 데이터 폴더·DB 파일명은 첫 실행 시 자동으로 옮겨진다

## 개발

```bash
npm install
npm run dev        # 개발 실행
npm run build:win  # Windows 설치본 빌드
npm test           # vitest (치환기·명함 파서·가져오기/내보내기 왕복)
```

스택: Electron + React + TypeScript + Vite / better-sqlite3 / tesseract.js / SheetJS / electron-builder

브라우저에서 렌더러만 열면(`npx electron-vite dev --rendererOnly` → http://localhost:5173) mock API가 붙어 UI를 확인할 수 있다. `?view=people|companies|templates|activity|settings`, `?palette=1`.

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

- [설계 문서](docs/01_설계.md) — 요구사항, IA, UX 플로우, 데이터 모델(v2), 어댑터 전략, 마일스톤 M4~M7, 오픈이슈
