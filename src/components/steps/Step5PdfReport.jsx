import { useRef } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// ─── Page dimensions (A4 landscape, mm) ──────────────────────────────────────
const PAGE_W_MM  = 297
const PAGE_H_MM  = 210
const FRAME_MM   = 8    // inner frame inset from page edge
const FOOTER_H_MM = 26  // title block height

// ─── Title block cell helper ─────────────────────────────────────────────────
function TBCell({ label, value, width, borderLeft = true, borderRight = false, colSpan, rowSpan, style = {}, valueStyle = {}, children }) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{
        width,
        borderLeft:  borderLeft  ? '0.5px solid #000' : 'none',
        borderRight: borderRight ? '0.5px solid #000' : 'none',
        verticalAlign: 'top',
        padding: '2px 3px 1px',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {label && (
        <div style={{ fontSize: '5px', color: '#555', lineHeight: 1, marginBottom: '2px', direction: 'rtl', whiteSpace: 'nowrap' }}>{label}</div>
      )}
      {value !== undefined && (
        <div style={{ fontSize: '7.5px', fontWeight: '600', color: '#000', direction: 'rtl', lineHeight: 1.2, ...valueStyle }}>{value}</div>
      )}
      {children}
    </td>
  )
}

// ─── CAD Title Block (footer) ─────────────────────────────────────────────────
function TitleBlock({ project, panelType, totalKw, panelCount, date }) {
  const projectName = project?.name  || '<project name>'
  const location    = project?.location || '<location>'
  const dateStr     = date || new Date().toLocaleDateString('he-IL')

  // Cell width helper — total usable width minus logo column
  const W = (pct) => `${pct}%`

  return (
    <table style={{
      width: '100%', height: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      fontSize: '7px',
      borderTop: '0.5px solid #000',
    }}>
      <colgroup>
        {/* sheet# | plan | approval | proj# | total-kw | power | qty | panel-type | proj-name | date | location | logo */}
        <col style={{ width: '4%' }} />
        <col style={{ width: '5%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '6%' }} />
        <col style={{ width: '6%' }} />
        <col style={{ width: '13%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <tbody>
        {/* ── Row 1: labels ── */}
        <tr style={{ height: '50%', borderBottom: '0.5px solid #000' }}>
          <TBCell label="תבנית" value="1" />
          <TBCell label="תכנית" value="TBD" />
          <TBCell label="דרישה / אישור">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '3px' }}>
              <div style={{ fontSize: '6px', color: '#555', direction: 'rtl', lineHeight: 1.2, textAlign: 'center' }}>
                דרישה אישור<br />קונסטרוקטור
              </div>
              <div style={{
                background: '#e74c3c', color: 'white',
                fontWeight: '800', fontSize: '6px',
                borderRadius: '1px', padding: '1px 3px',
                lineHeight: 1,
              }}>!</div>
            </div>
          </TBCell>
          <TBCell label="מספר פרויקט" value="TBD" />
          <TBCell label="הספק כולל" value={totalKw ? `${totalKw.toFixed(2)} kW` : 'TBD'} valueStyle={{ fontSize: '9px', fontWeight: '800' }} />
          <TBCell label="הספק" value="TBD" />
          <TBCell label="כמות" value={panelCount ?? 'TBD'} />
          <TBCell label="סוג פאנל" value={panelType || '<Panel model name>'} valueStyle={{ fontSize: '6px' }} />
          <TBCell label="שם פרויקט" value={projectName} valueStyle={{ fontSize: '7px' }} />
          <TBCell label="תאריך" value={dateStr} />
          <TBCell label="מיקום" value={location} />
          {/* Logo — spans 2 rows */}
          <td rowSpan={2} style={{
            borderLeft: '0.5px solid #000',
            padding: '4px 6px',
            verticalAlign: 'middle',
            textAlign: 'center',
            background: '#fff',
          }}>
            <div style={{ fontSize: '8px', fontWeight: '900', color: '#1a6e2e', lineHeight: 1.3, letterSpacing: '0.01em' }}>
              שדרות אנרגיה
            </div>
            <div style={{ fontSize: '5px', color: '#555', letterSpacing: '0.04em', marginTop: '2px' }}>
              BRINGING ENERGY TO LIFE
            </div>
          </td>
        </tr>

        {/* ── Row 2: approval button row ── */}
        <tr style={{ height: '50%' }}>
          <TBCell />
          <TBCell />
          <TBCell>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{
                background: '#2563eb', color: 'white',
                fontWeight: '800', fontSize: '7px',
                borderRadius: '2px', padding: '2px 6px',
                direction: 'rtl', lineHeight: 1.3,
              }}>לאישור</div>
            </div>
          </TBCell>
          <TBCell />
          <TBCell />
          <TBCell />
          <TBCell />
          <TBCell />
          <TBCell />
          <TBCell />
          <TBCell />
        </tr>
      </tbody>
    </table>
  )
}

// ─── Single CAD page ──────────────────────────────────────────────────────────
export function CadPage({ project, panelType, totalKw, panelCount, date, children, pageRef }) {
  // Scale: represent A4 landscape at ~96dpi equivalent (~3.78px/mm) but scaled down for screen
  const scale = 3.2  // px per mm for screen preview

  const pageW  = PAGE_W_MM  * scale
  const pageH  = PAGE_H_MM  * scale
  const frame  = FRAME_MM   * scale
  const footer = FOOTER_H_MM * scale

  return (
    <div
      ref={pageRef}
      style={{
        width:  pageW,
        height: pageH,
        background: '#fff',
        position: 'relative',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        flexShrink: 0,
      }}
    >
      {/* Outer thin frame */}
      <div style={{
        position: 'absolute',
        inset: `${frame}px`,
        border: '0.75px solid #000',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 2,
      }} />

      {/* Content area (inside frame, above footer) */}
      <div style={{
        position: 'absolute',
        top:    frame,
        left:   frame,
        right:  frame,
        bottom: frame + footer,
        overflow: 'hidden',
      }}>
        {children}
      </div>

      {/* Title block / footer */}
      <div style={{
        position: 'absolute',
        left:   frame,
        right:  frame,
        bottom: frame,
        height: footer,
        borderTop: 'none',  // handled inside TitleBlock
      }}>
        <TitleBlock
          project={project}
          panelType={panelType}
          totalKw={totalKw}
          panelCount={panelCount}
          date={date}
        />
      </div>
    </div>
  )
}

// ─── Main Step 5 component ────────────────────────────────────────────────────
export default function Step5PdfReport({ panels = [], refinedArea, rowConfigs = {}, rowConstructions = [], project }) {
  const pageRef = useRef(null)

  const panelCount = panels.length
  const panelType  = refinedArea?.panelType ?? null

  // Rough total kW from panel count × panel wattage (parsed from model name if possible)
  const totalKw = (() => {
    if (!panelType) return null
    const m = panelType.match(/[A-Z]-?(\d{3})-/)
    const wp = m ? parseInt(m[1], 10) : null
    return wp ? (panelCount * wp) / 1000 : null
  })()

  const handleExportPdf = async () => {
    const el = pageRef.current
    if (!el) return

    const canvas = await html2canvas(el, {
      scale: 3,          // 3× for high-res output
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdf.addImage(imgData, 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM)

    const safeName = (project?.name || 'report').replace(/[^a-z0-9]/gi, '_')
    const dateStr  = new Date().toISOString().split('T')[0]
    pdf.save(`${safeName}_${dateStr}.pdf`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#e8e8e8' }}>

      {/* Toolbar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 1.25rem',
        background: '#f8f9fa', borderBottom: '1px solid #e0e0e0',
      }}>
        <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#555' }}>PDF Report</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleExportPdf}
          style={{
            padding: '0.4rem 1.1rem',
            background: '#1a6e2e', color: 'white',
            border: 'none', borderRadius: '6px',
            fontSize: '0.8rem', fontWeight: '700',
            cursor: 'pointer',
          }}
        >
          Export PDF
        </button>
      </div>

      {/* Page preview */}
      <div style={{
        flex: 1, overflow: 'auto',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '2rem',
      }}>
        <CadPage
          pageRef={pageRef}
          project={project}
          panelType={panelType}
          totalKw={totalKw}
          panelCount={panelCount}
          date={new Date().toLocaleDateString('he-IL')}
        />
      </div>

    </div>
  )
}
