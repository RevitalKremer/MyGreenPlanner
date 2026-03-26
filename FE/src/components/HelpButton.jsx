import { useState } from 'react'
import { PRIMARY, TEXT } from '../styles/colors'
import HelpPanel from './HelpPanel'
import { useLang } from '../i18n/LangContext'

export default function HelpButton({ currentStep }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t('helpBtn.label')}
        style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(196,214,0,0.7)',
          color: PRIMARY, fontSize: '0.95rem', fontWeight: '800',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => { e.currentTarget.style.background = PRIMARY; e.currentTarget.style.color = TEXT }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = PRIMARY }}
      >?</button>

      {open && <HelpPanel currentStep={currentStep} onClose={() => setOpen(false)} />}
    </>
  )
}
