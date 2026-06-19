import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  TEXT_DARKEST, TEXT_LIGHT, TEXT_SECONDARY, BORDER_FAINT, BORDER_LIGHT, BG_SUBTLE, PRIMARY, TEXT,
} from '../../styles/colors'
import MaterialsTab from './MaterialsTab'
import SettingsTab from './SettingsTab'
import UsersTab from './UsersTab'
import ProjectsTab from './ProjectsTab'
import CreditsTab from './CreditsTab'
import { useLang } from '../../i18n/LangContext'

const TAB_KEYS = [
  // 'credits' includes Monetization as a sub-tab so all credits-related
  // management stays in one place.
  'users', 'projects', 'credits', 'materials', 'settings',
] as const

export default function AdminPanel({ onClose, currentUserId }) {
  const { t } = useLang()
  const [activeTab, setActiveTab] = useState<string>('users')
  // Cross-tab navigation: a target tab gets a `nav` directive (subTab/search/
  // selectEmail) with a bumped `key` so the destination tab re-applies it even
  // if it was already mounted. Each tab reads only the nav aimed at it.
  const [nav, setNav] = useState<{ tab: string; subTab?: string; search?: string; selectEmail?: string; key: number } | null>(null)
  const navSeq = useRef(0)
  const navigate = (target: { tab: string; subTab?: string; search?: string; selectEmail?: string }) => {
    navSeq.current += 1
    setNav({ ...target, key: navSeq.current })
    setActiveTab(target.tab)
  }
  const navFor = (tab: string) => (nav && nav.tab === tab ? nav : null)
  const TAB_LABEL: Record<string, string> = {
    'users':       t('admin.tab.users'),
    'projects':    t('admin.tab.projects'),
    'credits':     t('admin.tab.credits'),
    'materials':   t('admin.tab.materials'),
    'settings':    t('admin.tab.settings'),
  }

  return createPortal(
    <div style={{
      position: 'fixed', top: 'var(--header-height, 71px)', left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: 'white',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Header — always visible */}
      <div style={{
        padding: '1.25rem 1.75rem', borderBottom: `1px solid ${BORDER_LIGHT}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'white',
      }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: '800', color: TEXT_DARKEST }}>{t('admin.title')}</div>
          <div style={{ fontSize: '0.78rem', color: TEXT_LIGHT, marginTop: '1px' }}>{t('admin.subtitle')}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: TEXT_LIGHT, lineHeight: 1 }}>×</button>
      </div>

      {/* Tabs — always visible */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${BORDER_LIGHT}`,
        flexShrink: 0, padding: '0 1.75rem', background: 'white',
      }}>
        {TAB_KEYS.map(key => (
          <button key={key} onClick={() => { setActiveTab(key); setNav(null) }} style={{
            padding: '0.65rem 1rem', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.88rem', fontWeight: activeTab === key ? '700' : '500',
            color: activeTab === key ? TEXT_DARKEST : TEXT_LIGHT,
            borderBottom: `2px solid ${activeTab === key ? TEXT_DARKEST : 'transparent'}`,
            marginBottom: '-1px', transition: 'all 0.15s',
          }}>
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>
        {activeTab === 'users'        && <UsersTab currentUserId={currentUserId} onNavigate={navigate} nav={navFor('users')} />}
        {activeTab === 'projects'     && <ProjectsTab onNavigate={navigate} nav={navFor('projects')} />}
        {activeTab === 'credits'      && <CreditsTab onNavigate={navigate} nav={navFor('credits')} />}
        {activeTab === 'materials'    && <MaterialsTab />}
        {activeTab === 'settings'     && <SettingsTab />}
      </div>
    </div>,
    document.body
  )
}
