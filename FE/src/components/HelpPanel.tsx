import { useState } from 'react'
import { PRIMARY, PRIMARY_BG, PRIMARY_MID, TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BG_MID } from '../styles/colors'
import { useLang } from '../i18n/LangContext'

// Worked example threaded through the help: a flat concrete roof with a single
// area, a single panel row, mounted at 12° tilt and 50 cm front height.
const EXAMPLE_TAG = 'Worked example — concrete roof, 12° tilt / 50 cm front, 1 area, 1 row'

const HELP = {
  1: {
    title: 'Allocate Roof',
    purpose: 'Pick the working surface for the project and set the real-world scale. The roof area is the full extent of the chosen surface — you draw the actual panel zones in step 2.',
    qa: [
      {
        q: 'What can I use as the working surface?',
        a: 'Three options: (1) upload an aerial photo or floor plan; (2) switch to Map mode and capture the current satellite view; (3) pick Plain canvas for a blank white sheet. In every case the entire image becomes the roof area.'
      },
      {
        q: 'How does Map mode work?',
        a: 'Pan and zoom the satellite map until the roof is framed, then click "Use this view". The visible tiles are captured as your project image and behave the same as an upload from there on.'
      },
      {
        q: 'How do I set the real-world scale?',
        a: 'On image and map sources, click "Draw a reference line" and click two points along a known feature (a wall edge, a known length on the ground). Enter the actual length in cm — the pixel-to-cm ratio appears below the input and is reused by every later step. On Plain canvas the bottom edge is the reference line, defaulting to 6000 cm (60 m); change it to whatever real width you want the canvas to represent.'
      },
      {
        q: 'Can I paste a screenshot directly?',
        a: 'Yes — in Image mode, ⌘V / Ctrl+V pastes any image from the clipboard.'
      },
      {
        q: EXAMPLE_TAG,
        a: 'Pick Plain canvas for a clean walkthrough. The reference line is auto-set along the bottom edge at 6000 cm. Leave it as-is for the example, or change the cm value to match a real roof width if you have one in mind, then continue to step 2.'
      },
    ]
  },
  2: {
    title: 'Panel Layout',
    purpose: 'Draw rectangular panel areas on the roof, set the panel type and default mounting (angle, front height), then refine each row\'s panels and orientation. Areas auto-fill with panels using the configured spacing; rotate, resize, and split rows from the sidebar.',
    qa: [
      {
        q: 'How do I create an area?',
        a: 'Pick the Draw tool and drag a rectangle anywhere on the canvas. Panels auto-fill as soon as you release. If nothing fits (area too small, or fully covered by an existing area) the rectangle is discarded.'
      },
      {
        q: 'What are angle (a) and front height (h)?',
        a: 'a = panel tilt above horizontal in degrees (e.g. 12° for a slight tilt, 30° for a steep one). h = the mounting height at the front (downhill) edge in cm. Back height is computed automatically from front height plus the panel slope projection. Together they define the 3D trapezoid profile that step 3 turns into rails and bases.'
      },
      {
        q: 'Where do I set defaults vs per-row values?',
        a: 'The Default mounting block in the sidebar applies to areas you draw next. Existing rows keep their own a/h — click a row to edit its values, or use Apply to all rows to copy the defaults onto every row of every area at once.'
      },
      {
        q: 'Free vs Y-lock mode (Y⊞ / Y⊟)',
        a: [
          'Free (Y⊞): drag any corner to resize freely; opposite corner stays fixed',
          'Y-lock (Y⊟): height is fixed — non-pivot corners change width, pivot corner moves the whole area, body click+drag rotates around the pivot',
          '0° snap guide (dashed yellow) appears under 10° rotation and snaps under 3°',
        ].join(' | ')
      },
      {
        q: 'How do areas, rows, and trapezoids relate?',
        a: 'An area is one drawn rectangle. Multiple rows can share an area (stacked panel lines on the same slope). Each area produces one or more trapezoids — the 3D legs computed automatically from a, h, panel size, and area shape. Trap IDs (e.g. A1, A2) are how step 3 keys per-trap parameters.'
      },
      {
        q: 'Line orientation (vertical / horizontal)',
        a: 'Use the line-orientation chips in the row detail panel to flip individual panel lines between vertical (|, portrait) and horizontal (▬, landscape). Useful when the bottom row should be landscape but upper rows portrait.'
      },
      {
        q: EXAMPLE_TAG,
        a: 'In the sidebar set Default mounting → Angle = 12, Front H = 50, then drag a single rectangle on the canvas. The area auto-fills as a single row at 12° tilt with the front rail 50 cm above the roof. Leave Y-lock off, give the area a label (e.g. "A"), and continue to step 3.'
      },
    ]
  },
  3: {
    title: 'Construction Planning',
    purpose: 'Generate the rail and base layout for every area, fine-tune per-area and per-trapezoid parameters, and inspect the construction details that drive the bill of materials.',
    qa: [
      {
        q: 'What are the four tabs?',
        a: [
          'Areas — overview of all drawn areas, panels, and trapezoids on the roof image',
          'Rails Layout — cross-rail spacing per panel line and stock-length splitting per area',
          'Bases Layout — base / block placement along each rail, with per-base offset overrides',
          'Trapezoid Details — full cross-section of the selected trapezoid (legs, panels, rails, blocks, dimensions)',
          'Bases and Trapezoid tabs are hidden when every area is on tile roofing (no construction frame)',
        ].join(' | ')
      },
      {
        q: 'Settings tiers — global / area / trapezoid',
        a: 'Global parameters apply to every area (e.g. stock lengths, edge distances). Area parameters override per-row (e.g. rail overhang, block height, lines-per-area). Trapezoid parameters override per-trap (e.g. edge offset, base spacing, base overhang). Each parameter has a "?" tooltip showing its default, min, and max.'
      },
      {
        q: 'Apply-to-all buttons',
        a: 'Rails: copies the active row\'s rail spacing to every area (re-derived per area geometry). Bases: copies the active trapezoid\'s base configuration to every trapezoid. Section: copies a whole section of area parameters from the active area to all rows.'
      },
      {
        q: 'Custom base offsets',
        a: 'On the Bases Layout tab you can drag a base along its rail or type a millimetre offset directly. Edited bases turn into per-trap overrides and survive recomputation. Use Reset bases to drop them and fall back to the auto-spaced layout.'
      },
      {
        q: 'Why is a trap "shared" (⇄ badge)?',
        a: 'When two areas resolve to the same trapezoid cross-section they share the same trap ID and parameters — editing one updates both. The ⇄ badge next to the trap ID flags that.'
      },
      {
        q: EXAMPLE_TAG,
        a: 'With one area "A" at 12° / 50 cm you\'ll see one trapezoid (A1) and one panel line. On Rails the spacing is auto-derived from panel depth and edge distance; on Bases the base count comes from rail length divided by base spacing, with overhang at each end. Trapezoid Details shows the full cross-section: front rail at 50 cm, back rail higher by panel × sin(12°), plus the block punches under each leg.'
      },
    ]
  },
  4: {
    title: 'Plan Approval',
    purpose: 'Lock the design before the bill of materials and PDF are produced. Approval is captured against the logged-in user and the project date.',
    qa: [
      {
        q: 'What does approving the plan do?',
        a: 'It records your name, email, and the date as the approver on the project. The next step (Finalize & Export) treats the plan as frozen — change anything earlier and you\'ll have to approve again.'
      },
      {
        q: 'Why is sign-in required?',
        a: 'Approval needs an identifiable user. From step 3 onwards the project is tied to a saved cloud project under your account.'
      },
      {
        q: 'Can I undo approval?',
        a: 'Yes — click Reset approval. You\'ll be asked to confirm. Resetting clears the approval record but leaves the design intact.'
      },
      {
        q: EXAMPLE_TAG,
        a: 'Tick the consent checkbox, click Approve, and continue. For the 12° / 50 cm single-area example there is nothing to review beyond confirming the layout looks correct on step 3.'
      },
    ]
  },
  5: {
    title: 'Finalize & Export',
    purpose: 'Produce the deliverables — Bill of Materials (BOM), CAD-style PDF report (one page per area + a detail page per trapezoid), and Excel BOM export.',
    qa: [
      {
        q: 'What\'s in the BOM tab?',
        a: 'Every line item the project produces: panels, rails (split by stock length), bases / blocks, and any auxiliary parts. Quantities and total lengths come from steps 2–3; you can override quantities and add extras per row, and your edits are saved per project.'
      },
      {
        q: 'What\'s in the PDF report?',
        a: [
          'Page 1: Areas plan — all drawn areas on the roof image',
          'Page 2: Panels layout — panel grid with codes',
          'Page 3: Rails layout — every rail with length and stock split',
          'Page 4: Bases layout — base offsets along each rail',
          'Page 5: Install method — site-installation reference',
          'Then one trapezoid-detail page per distinct trap',
          'Each page carries the project title block (panel type, total kW, project name, date, performed-by)',
        ].join(' | ')
      },
      {
        q: 'How do I export?',
        a: 'Export Excel downloads the BOM with project metadata. Export PDF rasterises every page to a multi-page A4-landscape PDF.'
      },
      {
        q: EXAMPLE_TAG,
        a: 'The BOM lists: 1 panel type × N panels, 2 rails per panel line (front + back) split into stock lengths, blocks under each base, and the auxiliary set defined for concrete roofs. The PDF is 5 system pages + 1 detail page for A1.'
      },
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
