import { useState } from 'react'
import {
  TEXT_DARKEST, TEXT_LIGHT, TEXT_SECONDARY, BORDER_FAINT, BORDER_LIGHT, BG_SUBTLE, PRIMARY, TEXT,
} from '../../styles/colors'
import ProductsTab from './ProductsTab'
import SettingsTab from './SettingsTab'

const TABS = [
  { key: 'products', label: 'Products' },
  { key: 'settings', label: 'Default Settings' },
]

export default function AdminPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState('products')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: '16px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.2)',
        width: '100%', maxWidth: '900px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.75rem', borderBottom: `1px solid ${BORDER_LIGHT}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: TEXT_DARKEST }}>Admin Panel</div>
            <div style={{ fontSize: '0.78rem', color: TEXT_LIGHT, marginTop: '1px' }}>Manage products and system defaults</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: TEXT_LIGHT, lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER_LIGHT}`, flexShrink: 0, padding: '0 1.75rem' }}>
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

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>
          {activeTab === 'products' && <ProductsTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  )
}
