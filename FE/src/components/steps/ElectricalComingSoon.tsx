import React from 'react'
import {
  PRIMARY_DARK, PRIMARY_BG, PRIMARY_BG_LIGHT,
  TEXT_DARKEST, TEXT_MUTED, TEXT_FAINT, BORDER_LIGHT, AMBER_DARK, AMBER_BG, AMBER_BORDER,
  MODAL_SHADOW,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

/**
 * Electrical phase "coming soon" overlay.
 *
 * Rendered ON TOP of the real electrical step (6–9) while
 * `ELECTRICAL_ENABLED` is false (see config/steps.ts). The step renders
 * normally underneath; this overlay blurs it and floats a preview card so the
 * user gets a hint of what's coming without being able to interact. The only
 * forward action while withheld is "Skip to summary" (Path A), so the
 * non-refundable 6→7 charge can never fire from here.
 */
export default function ElectricalComingSoon() {
  const { t } = useLang()

  const features = [
    t('electrical.comingSoon.feat.inverter'),
    t('electrical.comingSoon.feat.strings'),
    t('electrical.comingSoon.feat.bom'),
    t('electrical.comingSoon.feat.approval'),
  ]

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
      // Blur + tint the real step screen showing through underneath.
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      background: `${PRIMARY_BG_LIGHT}cc`,
    }}>
      <div style={{
        maxWidth: 560, width: '100%', background: 'white',
        border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 16,
        padding: '2.25rem 2rem', textAlign: 'center',
        boxShadow: MODAL_SHADOW,
      }}>
        <span style={{
          display: 'inline-block', fontSize: '0.7rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.1em', color: AMBER_DARK,
          padding: '0.3rem 0.7rem', background: AMBER_BG,
          border: `1px solid ${AMBER_BORDER}`, borderRadius: 999, marginBottom: '1.1rem',
        }}>
          {t('electrical.comingSoon.badge')}
        </span>

        <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.45rem', color: TEXT_DARKEST, fontWeight: 700 }}>
          {t('electrical.comingSoon.title')}
        </h2>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.95rem', color: TEXT_MUTED, lineHeight: 1.5 }}>
          {t('electrical.comingSoon.body')}
        </p>

        <ul style={{
          listStyle: 'none', margin: '0 0 1.6rem', padding: 0,
          display: 'grid', gap: '0.55rem', textAlign: 'start',
        }}>
          {features.map((f, i) => (
            <li key={i} style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              fontSize: '0.9rem', color: TEXT_DARKEST,
              background: PRIMARY_BG, borderRadius: 10, padding: '0.6rem 0.8rem',
            }}>
              <span style={{ color: PRIMARY_DARK, fontWeight: 700 }}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        <div style={{
          fontSize: '0.85rem', color: TEXT_FAINT, lineHeight: 1.5,
          borderTop: `1px solid ${BORDER_LIGHT}`, paddingTop: '1.1rem',
        }}>
          {t('electrical.comingSoon.cta')}
        </div>
      </div>
    </div>
  )
}
