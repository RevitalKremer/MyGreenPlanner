import { useState } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT, TEXT_SECONDARY, TEXT_PLACEHOLDER, BORDER, BORDER_LIGHT, BG_FAINT, BG_MID, PRIMARY, WHITE } from '../../../styles/colors'

export type BaseEditInfo = {
  baseLabel: string
  frontExtMm: number
  backExtMm: number
  rowTargetCount: number   // other bases in this row (fan-out)
  areaTargetCount: number  // other bases in this area (fan-out)
}

type Props = {
  info: BaseEditInfo
  onExtendFront: (mm: number) => void
  onExtendBack: (mm: number) => void
  onApplyRow: () => void
  onApplyArea: () => void
  onClose: () => void
}

// One labelled mm field. Follows the live prop value when not focused (so the
// canvas drag stays in sync), switches to local editing while focused, and
// commits on blur / Enter.
function NumberField({ label, value, min = 0, step = 10, onCommit }: {
  label: string; value: number; min?: number; step?: number; onCommit: (mm: number) => void
}) {
  const [local, setLocal] = useState<string | null>(null)
  const shown = local ?? String(value)
  const commit = () => {
    if (local == null) return
    onCommit(Math.max(min, Math.round(Number(local) || 0)))
    setLocal(null)
  }
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: '0.62rem', color: TEXT_PLACEHOLDER, marginBottom: '2px' }}>{label}</div>
      <input
        type="number" min={min} step={step} value={shown}
        onFocus={() => setLocal(String(value))}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '0.2rem 0.35rem',
          border: `1px solid ${BORDER}`, borderRadius: '4px', fontSize: '0.75rem',
          textAlign: 'right', color: TEXT,
        }}
      />
    </label>
  )
}

function ApplyButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  const disabled = count === 0
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      style={{
        flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.62rem', fontWeight: '600', borderRadius: '4px',
        border: `1px solid ${BORDER_LIGHT}`, background: disabled ? BG_FAINT : WHITE,
        color: disabled ? TEXT_PLACEHOLDER : TEXT, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{label}</button>
  )
}

/**
 * Selected-base EXTEND editor — lives inside the Layers widget in edit mode.
 * Replaces the old floating, zoom-scaled, auto-dismissing extend popover with
 * one fixed-size, app-styled panel. Extend-only: front/back beam extension plus
 * the row/area fan-out (move / add / delete stay on the canvas edit bar, with
 * their own popup, unchanged). Shown only for framed bases (frameless anchors
 * have no beam to extend).
 */
export default function BaseEditPanel({ info, onExtendFront, onExtendBack, onApplyRow, onApplyArea, onClose }: Props) {
  const { t } = useLang()
  return (
    <div style={{ borderTop: `1px solid ${BG_MID}`, paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: '700', color: PRIMARY }}>
          {t('step3.edit.extendTitle')} {info.baseLabel}
        </span>
        <button
          type="button" onClick={onClose} aria-label={t('step3.edit.close')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: TEXT_SECONDARY, fontSize: '0.8rem', lineHeight: 1, padding: 0 }}
        >✕</button>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <div style={{ flex: 1 }}>
          <NumberField label={t('step3.edit.extendFront')} value={info.frontExtMm} onCommit={onExtendFront} />
        </div>
        <div style={{ flex: 1 }}>
          <NumberField label={t('step3.edit.extendBack')} value={info.backExtMm} onCommit={onExtendBack} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.62rem', color: TEXT_PLACEHOLDER, marginBottom: '2px' }}>{t('step3.edit.applyTo')}</div>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <ApplyButton label={t('step3.edit.applyRow')} count={info.rowTargetCount} onClick={onApplyRow} />
          <ApplyButton label={t('step3.edit.applyArea')} count={info.areaTargetCount} onClick={onApplyArea} />
        </div>
      </div>
    </div>
  )
}
