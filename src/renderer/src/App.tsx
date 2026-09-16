import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Contact as ContactIcon,
  History,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Settings
} from 'lucide-react'
import type { Contact, OutlookAdapter } from '../../shared/types'
import { useDialog } from './components/dialogs'
import CommandPalette, { type ViewKey } from './components/CommandPalette'
import ComposeModal from './views/ComposeModal'
import ContactsView from './views/ContactsView'
import TemplatesView from './views/TemplatesView'
import HistoryView from './views/HistoryView'
import SettingsView from './views/SettingsView'

const NAV: { key: ViewKey; label: string; Icon: typeof ContactIcon }[] = [
  { key: 'contacts', label: '명함', Icon: ContactIcon },
  { key: 'templates', label: '템플릿', Icon: Mail },
  { key: 'history', label: '이력', Icon: History },
  { key: 'settings', label: '설정', Icon: Settings }
]

const MODE_LABEL: Record<OutlookAdapter, string> = {
  com: 'Outlook 연동 · COM',
  eml: 'Outlook 연동 · EML',
  mailto: 'Outlook 연동 · mailto'
}

const VIEW_KEYS: ViewKey[] = ['contacts', 'templates', 'history', 'settings']

function initialView(): ViewKey {
  const v = new URLSearchParams(window.location.search).get('view')
  return VIEW_KEYS.includes(v as ViewKey) ? (v as ViewKey) : 'contacts'
}

function initialExpanded(): boolean {
  try {
    return localStorage.getItem('rail-expanded') === '1'
  } catch {
    return false
  }
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<ViewKey>(initialView)
  const [outlookMode, setOutlookMode] = useState<OutlookAdapter | null>(null)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [version, setVersion] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(
    () => typeof window !== 'undefined' && window.location.search.includes('palette=1')
  )
  const [paletteCompose, setPaletteCompose] = useState<{
    contact: Contact
    templateId: number
  } | null>(null)
  const [newContactSignal, setNewContactSignal] = useState(0)
  const [importSignal, setImportSignal] = useState(0)
  const { toast } = useDialog()
  const updateNotifiedRef = useRef<string | null>(null)

  useEffect(() => {
    window.api.system.outlookMode().then(setOutlookMode)
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

  const openNewContact = useCallback(() => {
    setView('contacts')
    setNewContactSignal((n) => n + 1)
  }, [])

  const openImport = useCallback(() => {
    setView('contacts')
    setImportSignal((n) => n + 1)
  }, [])

  const tip = (label: string): { 'data-tip'?: string } => (expanded ? {} : { 'data-tip': label })

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
              onClick={() => setView(key)}
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
              className={`mode-dot ${outlookMode ?? 'unknown'}`}
              {...tip(outlookMode ? MODE_LABEL[outlookMode] : '연동 확인 중…')}
              role="status"
              aria-label={outlookMode ? MODE_LABEL[outlookMode] : '연동 확인 중'}
            />
            <span className="rail-label rail-mode-text">
              {outlookMode ? MODE_LABEL[outlookMode] : '연동 확인 중…'}
            </span>
          </div>
          <div className="rail-version rail-label">whenmail {version && `v${version}`}</div>
        </div>
      </aside>
      <main className="content">
        <div className="view-enter" key={view}>
          {view === 'contacts' && (
            <ContactsView newContactSignal={newContactSignal} importSignal={importSignal} />
          )}
          {view === 'templates' && <TemplatesView />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && (
            <SettingsView outlookMode={outlookMode} onOutlookModeChange={setOutlookMode} />
          )}
        </div>
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={setView}
          onCompose={(contact, templateId) => setPaletteCompose({ contact, templateId })}
          onNewContact={openNewContact}
          onImport={openImport}
        />
      )}
      {paletteCompose && (
        <ComposeModal
          contacts={[paletteCompose.contact]}
          initialTemplateId={paletteCompose.templateId}
          onClose={() => setPaletteCompose(null)}
        />
      )}
    </div>
  )
}
