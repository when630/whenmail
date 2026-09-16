# whenmail

명함을 저장하고, 이메일 템플릿에 명함 정보를 치환해 **Outlook 새 메일 초안**으로 열어주는 개인용 데스크톱 앱.

## 기능

- **명함 관리** — 수동 입력 / CSV·엑셀 가져오기(컬럼 자동 매핑·태그 열·일괄 태그, 중복 검사) / **명함 사진 OCR**(Tesseract 로컬 인식) / 선택 명함 **일괄 수정·삭제**, 로컬 SQLite 저장
- **이메일 템플릿** — `{{이름}}`, `{{회사|귀사}}` 같은 변수 치환 + 수신자별 미리보기와 빈 변수 경고, 글꼴·크기·색 리치 에디터, 템플릿별 **첨부 파일**
- **Outlook 연동** — 자동 전송 없이 초안을 열어 검토 후 직접 전송 (COM → .eml → mailto 어댑터 체인). 설정에서 클래식/새 Outlook 선택, 참조·숨은 참조(기본값·on/off 설정), 본문 아래 서명(클래식 기본 서명 유지 또는 앱 서명)
- **Ctrl+K 커맨드 팔레트** — 명함 검색 → 템플릿 선택 → 초안까지 키보드만으로
- 초안 생성 이력, zip 백업/복원

## 개발

```bash
npm install
npm run dev        # 개발 실행
npm run build:win  # Windows 설치본 빌드
```

스택: Electron + React + TypeScript + Vite / better-sqlite3 / tesseract.js / electron-builder

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

- [설계 문서](docs/01_설계.md) — 요구사항, IA, UX 플로우, 데이터 모델, Outlook 어댑터 전략, 마일스톤
