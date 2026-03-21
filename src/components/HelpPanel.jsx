import { useState } from 'react'
import { PRIMARY, PRIMARY_BG, PRIMARY_MID, TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BG_MID } from '../styles/colors'

const HELP = {
  1: {
    title: 'Roof Allocation',
    purpose: 'Define the roof area where solar panels will be placed. You can use an interactive map (for geocoded locations) or upload your own aerial/plan image. The system will detect the roof boundary using AI (SAM2) or you can trace it manually.',
    qa: [
      {
        q: 'When should I use Map mode vs Image mode?',
        a: 'Use Map mode when you know the site address and want to locate it on a satellite map. Use Image mode when you already have a high-resolution aerial photo or architectural plan — this gives more precise control over the roof boundary.'
      },
      {
        q: 'What is SAM2 Auto detection?',
        a: 'SAM2 is an AI model that can detect object boundaries from a single click. Click anywhere on the roof surface and it will automatically trace the roof outline. It works best on clear aerial images with visible roof edges.'
      },
      {
        q: 'When should I use Draw Polygon instead?',
        a: 'Use Draw Polygon when the roof boundary is complex, SAM2 misidentifies the edge, or when working with plan drawings where the outline is already clearly marked. Click to add vertices, double-click or click the first point to close the shape.'
      },
      {
        q: 'What if the detected boundary is not accurate?',
        a: 'Click "Clear & Try Again" in the info panel to reset. In Auto mode, try clicking a different point on the roof. If results are still poor, switch to Draw Polygon mode for manual tracing.'
      }
    ]
  },
  2: {
    title: 'PV Area Refinement',
    purpose: 'Refine the installation area, set the real-world scale, and configure panel mounting parameters. You can define exclusion zones (obstacles, HVAC units) and — in Plan mode — draw multiple row baselines with individual configurations.',
    qa: [
      {
        q: 'How do I set the real-world scale?',
        a: 'Use the distance measurement tool to draw a line over a known distance on the image (e.g., a wall edge with a known length). Enter the actual length in cm to calibrate pixel-to-cm ratio.'
      },
      {
        q: 'What is the panel angle?',
        a: 'The tilt angle of the panel relative to the horizontal (0° = flat on roof, 30° = steeply tilted). This affects the panel\'s vertical profile and the required row spacing to avoid self-shading.'
      },
      {
        q: 'What is front vs back height?',
        a: 'Front height is the mounting height at the low edge of the panel (toward the eave). Back height is computed from the front height plus the panel slope projection. Together they define the panel\'s 3D trapezoid profile used for shade and row spacing calculations.'
      },
      {
        q: 'What does "Lines per Area" mean?',
        a: 'Each row can have 1 or 2 panel lines (portrait or landscape) stacked together. Two lines increase output per row but require more depth. Orientation (vertical = portrait, horizontal = landscape) controls which dimension faces along the baseline.'
      },
      {
        q: 'What is Plan mode vs Scratch mode?',
        a: 'Scratch mode generates rows automatically from a single baseline in Step 3. Plan mode (set at project creation) lets you define each row\'s baseline and configuration here in Step 2, giving full control over individual row placement.'
      }
    ]
  },
  3: {
    title: 'Panel Placement',
    purpose: 'Review, adjust, and fine-tune the auto-generated panel layout. You can move individual panels or groups, select by rectangle or shift-click, regenerate specific rows, and adjust per-row mounting geometry (trapezoid profile).',
    qa: [
      {
        q: 'How do I select and move panels?',
        a: 'Select the Move tool, then click a panel to select it, or drag on the background to draw a rectangle selection. Hold Shift and click to add/remove panels from the selection. Drag selected panels to reposition them.'
      },
      {
        q: 'Can I regenerate just one row?',
        a: 'Yes — click the ↺ button next to any row in the Rows list to regenerate only that row from its original baseline, without affecting other rows.'
      },
      {
        q: 'What does the Trapezoid editor do?',
        a: 'Select a row and the trapezoid editor shows the mounting profile (angle, back height). Changing these values overrides the global defaults for that row only — shown with an orange indicator dot. Click the reset button to restore global defaults.'
      },
      {
        q: 'Why do some panels appear outside the roof boundary?',
        a: 'Panel placement checks that all four panel corners fit inside the roof polygon. If panels appear near the edge, the polygon boundary might be slightly inaccurate. You can manually move those panels or clear and redraw the boundary in Step 1.'
      },
      {
        q: 'What does the Rotate tool do?',
        a: 'The Rotate tool lets you spin selected panels around their group center. Use this to align panels with unusual roof segments or to fine-tune alignment with the row baseline.'
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
                Step {currentStep} Guide
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
              Purpose
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: TEXT_DARK, lineHeight: 1.65 }}>
              {help.purpose}
            </p>
          </div>

          {/* Q&A */}
          <div style={{ fontSize: '0.65rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            Frequently Asked Questions
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
              <strong style={{ color: TEXT_MUTED }}>Coming soon:</strong> This panel will be upgraded to an AI assistant that can answer questions about your specific project and guide you through each step interactively.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
