import { useState } from 'react'
import HelpPanel from './HelpPanel'

export default function HelpButton({ currentStep }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Help & Guidelines"
        style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(196,214,0,0.7)',
          color: '#C4D600', fontSize: '0.95rem', fontWeight: '800',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#C4D600'; e.currentTarget.style.color = '#333' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#C4D600' }}
      >?</button>

      {open && <HelpPanel currentStep={currentStep} onClose={() => setOpen(false)} />}
    </>
  )
}
