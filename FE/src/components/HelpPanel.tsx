import { useState } from 'react'
import { PRIMARY, PRIMARY_BG, PRIMARY_MID, TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BG_MID } from '../styles/colors'
import { useLang } from '../i18n/LangContext'

const HELP = {
  1: {
    title: 'Roof Allocation',
    purpose: 'Pick the working surface for the project. The roof area is set automatically to the full extent of the chosen image — you only need to provide one and set the scale.',
    qa: [
      {
        q: 'What are my options for the working surface?',
        a: 'Three: (1) upload an aerial photo or floor plan; (2) switch to Map mode and capture the visible satellite view; (3) start with a blank white canvas. In all cases the roof area is the full image — the next step is where you draw panel zones inside it.'
      },
      {
        q: 'How does Map mode work?',
        a: 'Pan and zoom the satellite map to frame the roof, then click "Use this view" — the visible tiles are captured as the project image. From there it behaves the same as an uploaded image.'
      },
      {
        q: 'How do I set the real-world scale?',
        a: 'After the image is loaded, draw a Reference Line over a known distance (a wall edge, a known feature) and enter its real length in cm. This calibrates the pixel-to-cm ratio used by every later step.'
      },
    ]
  },
  2: {
    title: 'Panel Layout',
    purpose: 'Draw panel areas on the roof image, set the real-world scale, and configure mounting parameters. Areas are auto-filled with panels and can be resized, rotated, and fine-tuned interactively.',
    qa: [
      {
        q: 'How do I set the real-world scale?',
        a: 'Use the distance measurement tool to draw a line over a known distance on the image (e.g., a wall edge with a known length). Enter the actual length in cm to calibrate the pixel-to-cm ratio.'
      },
      {
        q: 'How do I create a new area?',
        a: 'Select the Draw tool and drag on the canvas to create a panel area. Release the mouse to place it — panels fill automatically. If no panels fit (area too small or fully occupied by another area), the area is discarded.'
      },
      {
        q: 'What is Free mode vs Y-lock mode?',
        a: 'Free mode (Y⊞): drag any corner to resize freely. The opposite corner (pivot) stays fixed. Y-lock mode (Y⊟): area height is locked — drag a non-pivot corner to extend width, drag the pivot corner to move the entire area, or click inside the body to rotate. Toggle with Y⊞/Y⊟ in the sidebar.'
      },
      {
        q: 'Gesture reference',
        a: [
          'Draw tool drag → create new area (auto-filled with panels)',
          'Sidebar row click → select area',
          'Free mode corner drag → resize area; polygon fits to panels on release',
          'Y-lock mode body click+drag → rotate area around pivot corner',
          'Y-lock mode non-pivot corner drag → extend/shrink width',
          'Y-lock mode pivot corner drag → move entire area',
          '0° snap guide (dashed yellow) → shown when |rotation| < 10°; snaps at < 3°',
          'Y⊞/Y⊟ button → toggle free/y-lock mode',
          '✕ button → delete area',
          '↺ button → regenerate panels for area',
          'Collision detection → panels blocked where another area already exists',
        ].join(' | ')
      },
      {
        q: 'What is the panel angle?',
        a: 'The tilt angle of the panel relative to horizontal (0° = flat, 30° = steeply tilted). Set a default in the sidebar; each area can also have its own override via the row config panel.'
      },
      {
        q: 'What is front vs back height?',
        a: 'Front height is the mounting height at the lower edge of the panel (toward the eave). Back height is computed from front height plus the panel slope projection. Together they define the 3D trapezoid profile used in construction planning.'
      },
      {
        q: 'What does "Lines per Area" mean?',
        a: 'Each area can have multiple panel lines (portrait or landscape) stacked together. More lines increase output per area but require more depth. Orientation (vertical = portrait, horizontal = landscape) controls which panel dimension faces the slope direction.'
      }
    ]
  },
  4: {
    title: 'Construction Planning',
    purpose: 'Generate a detailed bill of materials, mounting specifications, and wiring diagram for the approved panel layout. This step translates the design into actionable installation documentation.',
    qa: [
      {
        q: 'What is included in the construction plan?',
        a: 'The plan will include: panel count and total capacity, mounting rail quantities and lengths, wiring topology (string configuration), inverter sizing recommendations, and a sequenced installation checklist.'
      },
      {
        q: 'Can I adjust the design after generating the plan?',
        a: 'Yes — go Back to Step 3 to modify the panel layout, then return here to regenerate the plan. All calculations update automatically.'
      }
    ]
  },
  5: {
    title: 'Finalize & Export',
    purpose: 'Review the complete project summary and export deliverables. You can generate a PDF report, export panel coordinates for CAD software, and save energy production estimates.',
    qa: [
      {
        q: 'What formats can I export?',
        a: 'Planned export formats include: PDF project report, DXF/DWG for CAD, CSV panel coordinates, and a JSON project file (.mgp) for reopening in MyGreenPlanner.'
      },
      {
        q: 'How is energy production estimated?',
        a: 'Production is estimated from total panel capacity (kWp), average peak sun hours for the site location, and a standard performance ratio. Site-specific irradiance data will be integrated in a future update.'
      }
    ]
  }
}

export default function HelpPanel({ currentStep, onClose }) {
  const { t } = useLang()
  const [openQA, setOpenQA] = useState(null)
  const help = HELP[currentStep] || HELP[1]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 2000,
          backdropFilter: 'blur(1px)'
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: '380px',
        background: 'white',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        zIndex: 2001,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 1rem',
          borderBottom: `2px solid ${BG_MID}`,
          background: 'linear-gradient(135deg, #f8f9fa 0%, #f0f4e8 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: '700', color: PRIMARY, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.2rem' }}>
                {t('help.stepGuide', { n: currentStep })}
              </div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: TEXT }}>
                {help.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1.2rem', color: TEXT_VERY_LIGHT, padding: '0 4px', lineHeight: 1,
                flexShrink: 0, marginTop: '2px'
              }}
            >✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>

          {/* Purpose */}
          <div style={{
            background: PRIMARY_BG,
            border: '1.5px solid #e0ec99',
            borderRadius: '10px',
            padding: '1rem 1.1rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{ fontSize: '0.65rem', fontWeight: '700', color: PRIMARY_MID, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
              {t('help.purpose')}
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: TEXT_DARK, lineHeight: 1.65 }}>
              {help.purpose}
            </p>
          </div>

          {/* Q&A */}
          <div style={{ fontSize: '0.65rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            {t('help.faq')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {help.qa.map((item, i) => (
              <div
                key={i}
                style={{
                  border: `1.5px solid ${openQA === i ? PRIMARY : '#eee'}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s'
                }}
              >
                <button
                  onClick={() => setOpenQA(openQA === i ? null : i)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '0.75rem 1rem',
                    background: openQA === i ? PRIMARY_BG : 'white',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: '0.5rem'
                  }}
                >
                  <span style={{ fontSize: '0.84rem', fontWeight: '600', color: TEXT, lineHeight: 1.4 }}>
                    {item.q}
                  </span>
                  <span style={{
                    fontSize: '0.75rem', color: PRIMARY, fontWeight: '700',
                    flexShrink: 0, marginTop: '1px', transition: 'transform 0.15s',
                    transform: openQA === i ? 'rotate(180deg)' : 'none'
                  }}>▾</span>
                </button>
                {openQA === i && (
                  <div style={{
                    padding: '0 1rem 0.85rem',
                    fontSize: '0.83rem', color: TEXT_SECONDARY, lineHeight: 1.65,
                    background: PRIMARY_BG,
                    borderTop: '1px solid #e8f0cc'
                  }}>
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Future AI note */}
          <div style={{
            marginTop: '1.75rem',
            padding: '0.85rem 1rem',
            background: '#f4f4f4',
            borderRadius: '8px',
            display: 'flex', gap: '0.6rem', alignItems: 'flex-start'
          }}>
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>🤖</span>
            <p style={{ margin: 0, fontSize: '0.75rem', color: TEXT_PLACEHOLDER, lineHeight: 1.55 }}>
              <strong style={{ color: TEXT_MUTED }}>{t('help.comingSoon')}</strong> {t('help.comingSoonDesc')}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
