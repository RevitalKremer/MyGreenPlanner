import { useState } from 'react'
import { BORDER_FAINT, TEXT_DARKEST, TEXT_LIGHT } from '../../styles/colors'
import PanelTypesTab from './PanelTypesTab'
import ProductsTab from './ProductsTab'
import { useLang } from '../../i18n/LangContext'

// Wrapper grouping Panels + Materials under one admin tab (mirrors the Users
// and Credits sub-tab structure).
export default function MaterialsTab() {
  const { t } = useLang()
  const [subTab, setSubTab] = useState<'panels' | 'materials'>('materials')
  return (
    <div style={{ padding: '1rem 0' }}>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.1rem', borderBottom: `1px solid ${BORDER_FAINT}` }}>
        {[
          { key: 'materials', label: t('admin.materials.subtab.materials') },
          { key: 'panels', label: t('admin.materials.subtab.panels') },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key as any)}
            style={{
              padding: '0.55rem 0.95rem', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.86rem', fontWeight: subTab === tab.key ? 700 : 500,
              color: subTab === tab.key ? TEXT_DARKEST : TEXT_LIGHT,
              borderBottom: `2px solid ${subTab === tab.key ? TEXT_DARKEST : 'transparent'}`,
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {subTab === 'panels' && <PanelTypesTab />}
      {subTab === 'materials' && <ProductsTab />}
    </div>
  )
}
