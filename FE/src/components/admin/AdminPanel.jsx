import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  TEXT_DARKEST, TEXT_LIGHT, TEXT_SECONDARY, BORDER_FAINT, BORDER_LIGHT, BG_SUBTLE, PRIMARY, TEXT,
} from '../../styles/colors'
import ProductsTab from './ProductsTab'
import SettingsTab from './SettingsTab'
import UsersTab from './UsersTab'

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'products', label: 'Products' },
  { key: 'settings', label: 'Default Settings' },
]

export default function AdminPanel({ onClose, currentUserId }) {
  const [activeTab, setActiveTab] = useState('users')

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
          <div style={{ fontSize: '1.1rem', fontWeight: '800', color: TEXT_DARKEST }}>Admin Panel</div>
          <div style={{ fontSize: '0.78rem', color: TEXT_LIGHT, marginTop: '1px' }}>Manage users, products and system defaults</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: TEXT_LIGHT, lineHeight: 1 }}>×</button>
      </div>

      {/* Tabs — always visible */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${BORDER_LIGHT}`,
        flexShrink: 0, padding: '0 1.75rem', background: 'white',
      }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '0.65rem 1rem', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.88rem', fontWeight: activeTab === t.key ? '700' : '500',
            color: activeTab === t.key ? TEXT_DARKEST : TEXT_LIGHT,
            borderBottom: `2px solid ${activeTab === t.key ? TEXT_DARKEST : 'transparent'}`,
            marginBottom: '-1px', transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>
        {activeTab === 'users'    && <UsersTab currentUserId={currentUserId} />}
        {activeTab === 'products' && <ProductsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>,
    document.body
  )
}
