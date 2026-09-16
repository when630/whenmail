import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity as ActivityIcon,
  Building2,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Settings,
  Users
} from 'lucide-react'
import type { Account, Person } from '../../shared/types'
import { ACCOUNT_KIND_LABEL } from '../../shared/accounts'
import { useDialog } from './components/dialogs'
import CommandPalette, { type ViewKey } from './components/CommandPalette'
import ComposeModal from './views/ComposeModal'
import PeopleView from './views/PeopleView'
import CompaniesView from './views/CompaniesView'
import TemplatesView from './views/TemplatesView'
import ActivityView from './views/ActivityView'
import SettingsView from './views/SettingsView'

const NAV: { key: ViewKey; label: string; Icon: typeof Users }[] = [
  { key: 'people', label: '사람', Icon: Users },
  { key: 'companies', label: '회사', Icon: Building2 },
  { key: 'templates', label: '템플릿', Icon: Mail },
  { key: 'activity', label: '활동', Icon: ActivityIcon },
  { key: 'settings', label: '설정', Icon: Settings }
]

const VIEW_KEYS: ViewKey[] = ['people', 'companies', 'templates', 'activity', 'settings']

function initialView(): ViewKey {
  const v = new URLSearchParams(window.location.search).get('view')
  // 이전 버전의 주소(contacts/history)도 새 화면으로 연결
  if (v === 'contacts') return 'people'
  if (v === 'history') return 'activity'
  return VIEW_KEYS.includes(v as ViewKey) ? (v as ViewKey) : 'people'
}

function initialExpanded(): boolean {
  try {
    return localStorage.getItem('rail-expanded') === '1'
  } catch {
    return false
  }
}

/** 레일 하단 계정 표시 — 기본 계정 이름과 종류 */
function accountStatus(accounts: Account[] | null): { text: string; tone: string } {
  if (accounts === null) return { text: '계정 확인 중…', tone: 'unknown' }
  const def = accounts.find((a) => a.is_default) ?? accounts[0]
  if (!def) return { text: '계정 없음 — 설정에서 추가', tone: 'mailto' }
  const kind = ACCOUNT_KIND_LABEL[def.kind]
  return {
    text: `${def.display_name} · ${kind}`,
    tone: def.connected ? 'com' : 'eml'
  }
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<ViewKey>(initialView)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [version, setVersion] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(
    () => typeof window !== 'undefined' && window.location.search.includes('palette=1')
  )
  const [paletteCompose, setPaletteCompose] = useState<{
    person: Person
    templateId: number
  } | null>(null)
  const [newPersonSignal, setNewPersonSignal] = useState(0)
  const [importSignal, setImportSignal] = useState(0)
  /** 회사 화면에서 "사람 보기"로 넘어올 때의 회사 필터 */
  const [peopleOrgFilter, setPeopleOrgFilter] = useState<{ id: number; name: string } | null>(null)
  const { toast } = useDialog()
  const updateNotifiedRef = useRef<string | null>(null)

  useEffect(() => {
    window.api.accounts.list().then(setAccounts)
    window.api.system.version().then(setVersion)
  }, [])

  useEffect(() => {
    return window.api.update.onState((s) => {
      if (s.status === 'ready' && s.version && updateNotifiedRef.current !== s.version) {
        updateNotifiedRef.current = s.version
        toast(`새 버전 v${s.version} 다운로드 완료 — 설정에서 재시작하면 적용됩니다`, 'info')
      }
    })
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleExpanded = (): void => {
    setExpanded((prev) => {
      try {
        localStorage.setItem('rail-expanded', prev ? '0' : '1')
      } catch {
        /* 저장 실패는 무시 */
      }
      return !prev
    })
  }

  const openNewPerson = useCallback(() => {
    setView('people')
    setNewPersonSignal((n) => n + 1)
  }, [])

  const openImport = useCallback(() => {
    setView('people')
    setImportSignal((n) => n + 1)
  }, [])

  const showCompanyPeople = useCallback((id: number, name: string) => {
    setPeopleOrgFilter({ id, name })
    setView('people')
  }, [])

  const navigate = (key: ViewKey): void => {
    if (key === 'people') setPeopleOrgFilter(null)
    setView(key)
  }

  const tip = (label: string): { 'data-tip'?: string } => (expanded ? {} : { 'data-tip': label })
  const status = accountStatus(accounts)

  return (
    <div className="app">
      <aside className={`rail ${expanded ? 'expanded' : ''}`}>
        <div className="logo-row" title="whenmail">
          <span className="logo-mark">
            <Send size={15} color="#fff" strokeWidth={2.2} />
          </span>
          <span className="rail-label logo-name">whenmail</span>
        </div>
        <button
          className="rail-item rail-search"
          {...tip('검색·실행 (Ctrl+K)')}
          aria-label="검색 및 실행 (Ctrl+K)"
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={18} strokeWidth={1.9} />
          <span className="rail-label">
            검색·실행 <kbd className="rail-kbd">Ctrl K</kbd>
          </span>
        </button>
        <nav className="rail-nav">
          {NAV.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`rail-item ${view === key ? 'active' : ''}`}
              {...tip(label)}
              aria-label={label}
              onClick={() => navigate(key)}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span className="rail-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button
            className="rail-item"
            {...tip(expanded ? '사이드바 접기' : '사이드바 펼치기')}
            aria-label={expanded ? '사이드바 접기' : '사이드바 펼치기'}
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            {expanded ? (
              <PanelLeftClose size={18} strokeWidth={1.9} />
            ) : (
              <PanelLeftOpen size={18} strokeWidth={1.9} />
            )}
            <span className="rail-label">접기</span>
          </button>
          <div className="rail-footer">
            <span
              className={`mode-dot ${status.tone}`}
              {...tip(status.text)}
              role="status"
              aria-label={status.text}
            />
            <span className="rail-label rail-mode-text">{status.text}</span>
          </div>
          <div className="rail-version rail-label">whenmail {version && `v${version}`}</div>
        </div>
      </aside>
      <main className="content">
        <div className="view-enter" key={view}>
          {view === 'people' && (
            <PeopleView
              newPersonSignal={newPersonSignal}
              importSignal={importSignal}
              organizationFilter={peopleOrgFilter}
              onClearOrganizationFilter={() => setPeopleOrgFilter(null)}
            />
          )}
          {view === 'companies' && <CompaniesView onShowPeople={showCompanyPeople} />}
          {view === 'templates' && <TemplatesView />}
          {view === 'activity' && <ActivityView />}
          {view === 'settings' && <SettingsView onAccountsChange={setAccounts} />}
        </div>
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={navigate}
          onCompose={(person, templateId) => setPaletteCompose({ person, templateId })}
          onNewPerson={openNewPerson}
          onImport={openImport}
        />
      )}
      {paletteCompose && (
        <ComposeModal
          people={[paletteCompose.person]}
          initialTemplateId={paletteCompose.templateId}
          onClose={() => setPaletteCompose(null)}
        />
      )}
    </div>
  )
}
