// 형제 앱 연동의 순수 부분(D-14). 규약은 when630/when-protocol — WHENCOMMAND(시리즈의 입력줄)가 이 앱을 부른다.
//
//   parseDeepLink   whenmail://search?q=김부장 → { command: 'search', args: { q: '김부장' } }. 모르는 스킴·명령은 null
//   fromArgv        Windows/Linux는 URL이 argv로 온다(첫 실행이면 process.argv, 떠 있으면 second-instance)
//   buildManifest   ~/.when/apps/whenmail.json에 쓸 명령 목록 — WHENCOMMAND가 읽어 입력줄에 합친다

export const SCHEME = 'whenmail'
export const APP_ID = 'whenmail'

export interface DeepLinkArg {
  name: string
  type: 'string'
  optional?: boolean
}

export interface DeepLinkCommand {
  id: string
  title: string
  description?: string
  args?: DeepLinkArg[]
}

export interface DeepLink {
  command: string
  args: Record<string, string>
}

export interface Manifest {
  protocol: 1
  id: string
  name: string
  scheme: string
  verify: Record<string, string>
  commands: DeepLinkCommand[]
}

// 이 앱이 받는 명령. title은 WHENCOMMAND 입력줄에 보이는 이름이고, 그 뒤에 띄어 쓴 것이 첫 인자로 온다.
export const COMMANDS: DeepLinkCommand[] = [
  {
    id: 'search',
    title: '사람 검색',
    description: '커맨드 팔레트를 열고 이름·회사·이메일로 찾는다 — 거기서 바로 초안까지',
    args: [{ name: 'q', type: 'string' }]
  },
  { id: 'activity', title: '연락 활동', description: '초안·메모·명함·회신 기록과 할 일' },
  { id: 'open', title: '연락처 열기', description: '사람 목록' }
]

const KNOWN = new Set(COMMANDS.map((c) => c.id))

export function parseDeepLink(raw: unknown): DeepLink | null {
  let u: URL
  try {
    u = new URL(String(raw ?? ''))
  } catch {
    return null
  }
  if (u.protocol !== `${SCHEME}:`) return null
  const command = (u.host || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase()
  if (!KNOWN.has(command)) return null
  const args: Record<string, string> = {}
  for (const [k, v] of u.searchParams) if (v) args[k] = v
  return { command, args }
}

export function fromArgv(argv: readonly string[] | undefined): string | null {
  return (
    (argv ?? []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${SCHEME}://`)) ??
    null
  )
}

// verify는 실제로 설치돼 있는지 WHENCOMMAND가 확인하는 경로다. 패키징본이면 지금 실행 파일(macOS는 .app 번들),
// 개발 실행이면 설치본의 관례 경로 — 개발용 electron.exe를 적으면 설치본이 없는 PC에서도 "있다"고 읽힌다.
export function buildManifest(opts: {
  platformName: string
  exePath: string | null
  packaged: boolean
}): Manifest {
  const verify: Record<string, string> = {
    darwin: '/Applications/whenmail.app',
    win32: '%LOCALAPPDATA%\\Programs\\whenmail\\whenmail.exe'
  }
  if (opts.packaged && opts.exePath) {
    if (opts.platformName === 'darwin') {
      const m = opts.exePath.match(/^(.*?\.app)\//)
      if (m) verify.darwin = m[1]
    } else if (opts.platformName === 'win32') {
      verify.win32 = opts.exePath
    }
  }
  return {
    protocol: 1,
    id: APP_ID,
    name: 'WHENMAIL',
    scheme: SCHEME,
    verify,
    // args가 없는 명령은 키 자체를 뺀다 — undefined는 JSON.stringify가 조용히 지우므로 쓴 것과 읽은 것이 같게
    commands: COMMANDS.map((c) =>
      c.args
        ? { ...c, args: c.args.map((a) => ({ ...a })) }
        : { id: c.id, title: c.title, description: c.description }
    )
  }
}
