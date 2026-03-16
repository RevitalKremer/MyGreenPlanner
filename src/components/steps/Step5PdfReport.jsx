import { useRef } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// ─── Page dimensions (A4 landscape, mm) ──────────────────────────────────────
const PAGE_W_MM  = 297
const PAGE_H_MM  = 210
const FRAME_MM   = 8    // inner frame inset from page edge
const FOOTER_H_MM = 26  // title block height

// ─── Shared cell styles ───────────────────────────────────────────────────────
const cellBase = {
  borderLeft: '0.5px solid #000',
  padding: '1px 3px',
  boxSizing: 'border-box',
  verticalAlign: 'top',
  overflow: 'hidden',
}
const labelStyle = {
  fontSize: '5px', color: '#555', lineHeight: 1,
  direction: 'rtl', whiteSpace: 'nowrap', marginBottom: '1px',
}
const valStyle = {
  fontSize: '7.5px', fontWeight: '600', color: '#000',
  direction: 'rtl', lineHeight: 1.2,
}

// ─── CAD Title Block (footer) — 3 areas: left sheet, middle data, right logo ──
function TitleBlock({ project, panelType, totalKw, panelCount, date, panelWp }) {
  const projectName = project?.name     || '<project name>'
  const location    = project?.location || '<location>'
  const dateStr     = date || new Date().toLocaleDateString('he-IL')
  const kWstr       = totalKw ? `${totalKw.toFixed(2)}kW` : 'TBD'
  const wpStr       = panelWp ? `${panelWp}W` : 'TBD'

  return (
    <table style={{
      width: '100%', height: '100%',
      borderCollapse: 'collapse', tableLayout: 'fixed',
      borderTop: '0.5px solid #000',
    }}>
      <colgroup>
        {/* Area 1: approval (4%) | Area 2: sheet(6%) proj#(8%) approval-req(10%) total-kw(9%) panel-type(16%) power(7%) qty(6%) proj-name(14%) date(8%) location(8%) | Area 3: logo(12%) */}
        <col style={{ width: '4%' }} />   {/* לאישור */}
        <col style={{ width: '6%' }} />   {/* תבנית */}
        <col style={{ width: '8%' }} />   {/* מספר פרויקט */}
        <col style={{ width: '10%' }} />  {/* דרישה/קונסטרוקטור */}
        <col style={{ width: '9%' }} />   {/* הספק כולל */}
        <col style={{ width: '16%' }} />  {/* סוג פאנל */}
        <col style={{ width: '7%' }} />   {/* הספק */}
        <col style={{ width: '6%' }} />   {/* כמות */}
        <col style={{ width: '14%' }} />  {/* שם פרויקט */}
        <col style={{ width: '8%' }} />   {/* תאריך */}
        <col style={{ width: '5%' }} />   {/* מיקום */}
        <col style={{ width: '7%' }} />   {/* logo */}
      </colgroup>
      <tbody>
        {/* ── Row 1: labels ── */}
        <tr style={{ height: '50%', borderBottom: '0.5px solid #000' }}>
          {/* Area 1 — left, label row: empty */}
          <td style={{ ...cellBase, borderLeft: 'none' }} />

          {/* Area 2 — data cells labels */}
          <td style={cellBase}><div style={labelStyle}>תבנית</div></td>
          <td style={cellBase}><div style={labelStyle}>מספר פרויקט</div></td>
          {/* approval: spans both rows */}
          <td rowSpan={2} style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{ fontSize: '6px', color: '#444', direction: 'rtl', lineHeight: 1.4, marginBottom: '3px' }}>
              דרישה אישור<br />קונסטרוקטור
            </div>
            <div style={{
              display: 'inline-block',
              background: '#c0392b', color: 'white',
              fontWeight: '900', fontSize: '8px',
              borderRadius: '2px', padding: '1px 4px', lineHeight: 1.3,
            }}>!</div>
          </td>
          <td style={cellBase}><div style={labelStyle}>הספק כולל</div></td>
          <td style={cellBase}><div style={labelStyle}>סוג פאנל</div></td>
          <td style={cellBase}><div style={labelStyle}>הספק</div></td>
          <td style={cellBase}><div style={labelStyle}>כמות</div></td>
          <td style={cellBase}><div style={labelStyle}>שם פרויקט</div></td>
          <td style={cellBase}><div style={labelStyle}>תאריך</div></td>
          <td style={cellBase}><div style={labelStyle}>מיקום</div></td>

          {/* Area 3 — logo spans both rows */}
          <td rowSpan={2} style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center', padding: '3px 4px' }}>
            <img src="/sadotenergylogo.png" alt="שדרות אנרגיה"
              style={{ maxWidth: '100%', maxHeight: '38px', objectFit: 'contain', display: 'block', margin: '0 auto' }} />
          </td>
        </tr>

        {/* ── Row 2: values ── */}
        <tr style={{ height: '50%' }}>
          {/* Area 1 — לאישור button */}
          <td style={{ ...cellBase, borderLeft: 'none', verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{
              background: '#2563eb', color: 'white',
              fontWeight: '800', fontSize: '7px',
              borderRadius: '2px', padding: '2px 5px',
              direction: 'rtl', lineHeight: 1.3, display: 'inline-block',
            }}>לאישור</div>
          </td>

          {/* Area 2 — values */}
          <td style={cellBase}><div style={{ ...valStyle, fontSize: '7px' }}>D3</div></td>
          <td style={cellBase}><div style={valStyle}>{project?.number || 'TBD'}</div></td>
          {/* approval cell spanned above — skip */}
          <td style={{ ...cellBase, verticalAlign: 'middle' }}>
            <div style={{ ...valStyle, fontSize: '10px', fontWeight: '900', textAlign: 'center' }}>{kWstr}</div>
          </td>
          <td style={cellBase}><div style={{ ...valStyle, fontSize: '6.5px' }}>{panelType || 'TBD'}</div></td>
          <td style={cellBase}><div style={valStyle}>{wpStr}</div></td>
          <td style={cellBase}><div style={valStyle}>{panelCount ?? 'TBD'}</div></td>
          <td style={cellBase}><div style={{ ...valStyle, fontSize: '6.5px' }}>{projectName}</div></td>
          <td style={cellBase}><div style={{ ...valStyle, fontSize: '6.5px' }}>{dateStr}</div></td>
          <td style={cellBase}><div style={{ ...valStyle, fontSize: '6.5px' }}>{location}</div></td>
        </tr>
      </tbody>
    </table>
  )
}

// ─── Single CAD page ──────────────────────────────────────────────────────────
export function CadPage({ project, panelType, panelWp, totalKw, panelCount, date, children, pageRef }) {
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
          panelWp={panelWp}
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

  // Parse panel wattage from model name (e.g. "AIKO-G670-..." → 670W)
  const panelWp = (() => {
    if (!panelType) return null
    const m = panelType.match(/[A-Z0-9](\d{3})[^0-9]/)
    return m ? parseInt(m[1], 10) : null
  })()
  const totalKw = panelWp ? (panelCount * panelWp) / 1000 : null

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
          panelWp={panelWp}
          totalKw={totalKw}
          panelCount={panelCount}
          date={new Date().toLocaleDateString('he-IL')}
        />
      </div>

    </div>
  )
}
