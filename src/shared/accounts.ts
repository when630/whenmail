import type { Account, AccountCapabilities, AccountKind, OutlookAdapter } from './types'

/** 계정 종류 표시명 */
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  outlook_local: '이 PC의 Outlook',
  m365: 'Microsoft 365',
  gmail: 'Gmail',
  imap: 'IMAP (범용)'
}

export const ACCOUNT_KIND_DESC: Record<AccountKind, string> = {
  outlook_local:
    '설치된 Outlook에서 초안 창을 바로 엽니다. 클래식 Outlook은 COM으로 완전 지원, 새 Outlook은 .eml 방식(불안정)입니다.',
  m365: 'Microsoft Graph API로 초안 폴더에 초안을 만들고 웹 Outlook에서 엽니다. 새 Outlook 사용자에게 권장. Azure 앱(클라이언트) ID가 필요합니다.',
  gmail:
    'Gmail API로 초안 폴더에 초안을 만들고 Gmail 웹에서 엽니다. Google OAuth 클라이언트가 필요합니다.',
  imap: '어느 메일 서버든 IMAP으로 초안 폴더에 넣습니다. 초안은 사용하는 메일 클라이언트의 초안 폴더에서 열립니다.'
}

/** 종류별(로컬은 실제 어댑터별) 지원 범위 */
export function capabilitiesOf(
  kind: AccountKind,
  localMode?: OutlookAdapter | null
): AccountCapabilities {
  switch (kind) {
    case 'outlook_local':
      if (localMode === 'com') {
        return {
          html: true,
          attachments: true,
          opens: '클래식 Outlook 새 메일 창이 바로 열립니다',
          warning: ''
        }
      }
      if (localMode === 'mailto') {
        return {
          html: false,
          attachments: false,
          opens: '기본 메일 앱이 mailto 링크로 열립니다',
          warning: '제목과 텍스트 본문만 전달됩니다'
        }
      }
      return {
        html: true,
        attachments: true,
        opens: '.eml 초안 파일이 새 Outlook(기본 메일 앱)에서 열립니다',
        warning:
          '새 Outlook은 .eml 초안에서 첨부를 놓치거나 서명 위치가 달라질 수 있습니다. 확실한 경로는 Microsoft 365 계정입니다'
      }
    case 'm365':
      return {
        html: true,
        attachments: true,
        opens: '초안 폴더에 만들어지고 웹 Outlook이 열립니다. 새 Outlook 데스크톱에도 동기화됩니다',
        warning: '첨부는 파일당 3MB까지 붙일 수 있습니다'
      }
    case 'gmail':
      return {
        html: true,
        attachments: true,
        opens: '초안 폴더에 만들어지고 Gmail 웹의 초안 목록이 열립니다',
        warning: ''
      }
    case 'imap':
      return {
        html: true,
        attachments: true,
        opens:
          '메일 서버의 초안 폴더에 저장됩니다. 사용하는 메일 클라이언트에서 초안을 열어 보내세요',
        warning: '초안 창이 자동으로 열리지는 않습니다'
      }
  }
}

/** 초안 생성 버튼 문구 */
export function draftButtonLabel(kind: AccountKind): string {
  switch (kind) {
    case 'outlook_local':
      return 'Outlook 초안 열기'
    case 'm365':
      return 'Microsoft 365 초안 만들기'
    case 'gmail':
      return 'Gmail 초안 만들기'
    case 'imap':
      return '초안 폴더에 저장'
  }
}

/** 목록·팔레트용 한 줄 표시 */
export function accountLabel(a: Account): string {
  return a.address ? `${a.display_name || a.address} <${a.address}>` : a.display_name
}
