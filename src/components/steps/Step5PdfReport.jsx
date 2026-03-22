import { useRef, useState, useMemo, useEffect } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { BLACK, WHITE, TEXT, TEXT_MUTED, TEXT_SECONDARY, ERROR_DARK, BORDER_FAINT, BORDER_LIGHT, BG_LIGHT, BORDER, TEXT_PLACEHOLDER } from '../../styles/colors'
import BOMView from './step4/BOMView'
import TrapDetailPage from './step5/TrapDetailPage'
import { buildTrapezoidGroups } from './step4/tabUtils'
import PanelsLayoutPage from './step5/PanelsLayoutPage'
import RailsLayoutPage from './step5/RailsLayoutPage'
import BasesLayoutPage from './step5/BasesLayoutPage'

// ─── Page dimensions (A4 landscape, mm) ──────────────────────────────────────
const PAGE_W_MM  = 297
const PAGE_H_MM  = 210
const FRAME_MM   = 8    // inner frame inset from page edge
const FOOTER_H_MM = 26  // title block height

// ─── Shared cell styles ───────────────────────────────────────────────────────
const B  = `0.5px solid ${BLACK}`
const cellBase = { borderLeft: B, padding: '1px 3px', boxSizing: 'border-box', verticalAlign: 'top', overflow: 'hidden' }
const LBL = { fontSize: '5px', color: TEXT_MUTED, lineHeight: 1, direction: 'rtl', whiteSpace: 'nowrap', marginBottom: '1px' }
const VAL = { fontSize: '7.5px', fontWeight: '600', color: BLACK, direction: 'rtl', lineHeight: 1.2 }

function Cell({ style, children }) {
  return <td style={{ ...cellBase, ...style }}>{children}</td>
}
function LV({ label, value, vStyle }) {
  return <>
    <div style={LBL}>{label}</div>
    <div style={{ ...VAL, ...vStyle }}>{value}</div>
  </>
}

// ─── CAD Title Block ─────────────────────────────────────────────────────────
// Layout (9 cols, 2 rows):
// Row1: [תבנית] [מספר פרויקט] [approval↕rowspan2] [הספק כולל] [סוג פאנל←colspan2] [שם פרויקט←colspan2] [logo↕rowspan2]
// Row2: [לאישור] [blank]       [spanned]           [blank]     [הספק]  [כמות]       [תאריך] [מיקום]       [spanned]
function TitleBlock({ project, panelType, totalKw, panelCount, date, panelWp, pageName }) {
  const projectName = project?.name     || '<project name>'
  const location    = project?.location || '<location>'
  const dateStr     = date || new Date().toLocaleDateString('he-IL')
  const kWstr       = totalKw ? `${totalKw.toFixed(2)}kW` : 'TBD'
  const wpStr       = panelWp ? `${panelWp}W`             : 'TBD'
  const qtyStr      = panelCount != null ? String(panelCount) : 'TBD'

  return (
    <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: B }}>
      <colgroup>
        <col style={{ width: '11%' }} />  {/* col1: approval area */}
        <col style={{ width: '10%' }} />  {/* col2: מספר פרויקט */}
        <col style={{ width: '10%' }} />  {/* col3: approval req (rowspan) */}
        <col style={{ width: '10%' }} />  {/* col4: הספק כולל */}
        <col style={{ width: '10%' }} />  {/* col5: סוג פאנל / הספק */}
        <col style={{ width: '10%' }} />  {/* col6: סוג פאנל cont. / כמות */}
        <col style={{ width: '10%' }} />  {/* col7: שם פרויקט / תאריך */}
        <col style={{ width: '10%' }} />  {/* col8: שם פרויקט cont. / מיקום */}
        <col style={{ width: '19%' }} />  {/* col9: logo (rowspan) */}
      </colgroup>
      <tbody>

        {/* ── Row 1 ─────────────────────────────────────────────────────── */}
        <tr style={{ height: '50%', borderBottom: B }}>

          {/* col1 row1: תבנית / page name */}
          <Cell style={{ borderLeft: 'none' }}>
            {pageName
              ? <LV label="תבנית" value={pageName} vStyle={{ fontSize: '10px', fontWeight: '900' }} />
              : <LV label="תבנית" value="D3" />
            }
          </Cell>

          {/* col2 row1: מספר פרויקט */}
          <Cell>
            <LV label="מספר פרויקט" value={project?.number || 'TBD'} />
          </Cell>

          {/* col3: approval — rowspan=2 */}
          <td rowSpan={2} style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{ fontSize: '5.5px', color: TEXT, direction: 'rtl', lineHeight: 1.5, marginBottom: '3px' }}>
              דרישה אישור<br />קונסטרוקטור
            </div>
            <span style={{ background: ERROR_DARK, color: WHITE, fontWeight: '900', fontSize: '9px', borderRadius: '2px', padding: '1px 5px' }}>!</span>
          </td>

          {/* col4 row1: הספק כולל */}
          <Cell style={{ verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={LBL}>הספק כולל</div>
            <div style={{ ...VAL, fontSize: '9.5px', fontWeight: '900' }}>{kWstr}</div>
          </Cell>

          {/* col5-6 row1: סוג פאנל (colspan=2) */}
          <td colSpan={2} style={{ ...cellBase }}>
            <LV label="סוג פאנל" value={panelType || 'TBD'} vStyle={{ fontSize: '6.5px' }} />
          </td>

          {/* col7-8 row1: שם פרויקט (colspan=2) */}
          <td colSpan={2} style={{ ...cellBase }}>
            <LV label="שם פרויקט" value={projectName} vStyle={{ fontSize: '6.5px' }} />
          </td>

          {/* col9: logo — rowspan=2 */}
          <td rowSpan={2} style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center', padding: '3px 5px' }}>
            <img src="/sadotenergylogo.png" alt="שדרות אנרגיה"
              style={{ maxWidth: '100%', maxHeight: '40px', objectFit: 'contain', display: 'block', margin: '0 auto' }} />
          </td>
        </tr>

        {/* ── Row 2 ─────────────────────────────────────────────────────── */}
        <tr style={{ height: '50%' }}>

          {/* col1 row2: לאישור */}
          <td style={{ ...cellBase, borderLeft: 'none', verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{ background: '#2563eb', color: '#fff', fontWeight: '800', fontSize: '7px', borderRadius: '2px', padding: '2px 6px', display: 'inline-block', direction: 'rtl' }}>לאישור</div>
          </td>

          {/* col2 row2: blank */}
          <Cell />

          {/* col3 spanned — skip */}

          {/* col4 row2: blank */}
          <Cell />

          {/* col5 row2: הספק */}
          <Cell>
            <LV label="הספק" value={wpStr} />
          </Cell>

          {/* col6 row2: כמות */}
          <Cell>
            <LV label="כמות" value={qtyStr} />
          </Cell>

          {/* col7 row2: תאריך */}
          <Cell>
            <LV label="תאריך" value={dateStr} vStyle={{ fontSize: '6.5px' }} />
          </Cell>

          {/* col8 row2: מיקום */}
          <Cell>
            <LV label="מיקום" value={location} vStyle={{ fontSize: '6.5px' }} />
          </Cell>

          {/* col9 spanned — skip */}
        </tr>

      </tbody>
    </table>
  )
}

// ─── Single CAD page ──────────────────────────────────────────────────────────
export function CadPage({ project, panelType, panelWp, totalKw, panelCount, date, children, pageRef, pageName }) {
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
        background: WHITE,
        position: 'relative',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        flexShrink: 0,
      }}
    >
      {/* Outer thin frame */}
      <div style={{
        position: 'absolute',
        inset: `${frame}px`,
        border: `0.75px solid ${BLACK}`,
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
          pageName={pageName}
        />
      </div>
    </div>
  )
}

// ─── Main Step 5 component ────────────────────────────────────────────────────
export default function Step5PdfReport({
  panels = [], refinedArea, rowConstructions = [], rowLabels = [], project,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  trapPanelLinesMap = {},
}) {
  const page1Ref = useRef(null)
  const page2Ref = useRef(null)
  const page3Ref = useRef(null)
  const page4Ref = useRef(null)
  const trapPageRefs = useRef({})
  const pdfScrollRef = useRef(null)
  const [activeTab, setActiveTab] = useState('bom')

  useEffect(() => {
    const el = pdfScrollRef.current
    if (!el) return
    const handler = (e) => { if (e.ctrlKey) e.preventDefault() }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [activeTab])

  const panelCount = panels.length
  const panelType  = refinedArea?.panelType ?? null

  const { keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  // Parse panel wattage from model name (e.g. "AIKO-G670-..." → 670W)
  const panelWp = (() => {
    if (!panelType) return null
    const m = panelType.match(/[A-Z0-9](\d{3})[^0-9]/)
    return m ? parseInt(m[1], 10) : null
  })()
  const totalKw = panelWp ? (panelCount * panelWp) / 1000 : null

  // Pre-rasterize all <svg> elements in a page element to <img> tags so html2canvas
  // doesn't need to parse SVG (which it handles poorly for complex/transformed content).
  const rasterizeSvgs = async (pageEl) => {
    const svgs = Array.from(pageEl.querySelectorAll('svg'))
    const swaps = []
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (!w || !h) continue
      const clone = svg.cloneNode(true)
      clone.setAttribute('width', w)
      clone.setAttribute('height', h)
      const xml = new XMLSerializer().serializeToString(clone)
      const blob = new Blob([xml], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const img = new Image(w, h)
      img.style.cssText = `display:block;width:${w}px;height:${h}px`
      await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; img.src = url })
      svg.parentNode.replaceChild(img, svg)
      swaps.push({ img, svg, url })
    }
    return swaps
  }
  const restoreSvgs = (swaps) => {
    for (const { img, svg, url } of swaps) {
      img.parentNode?.replaceChild(svg, img)
      URL.revokeObjectURL(url)
    }
  }

  const handleExportPdf = async () => {
    const refs = [page1Ref, page2Ref, page3Ref, page4Ref, ...trapIds.map(id => trapPageRefs.current[id]).filter(Boolean)]
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    let firstPage = true

    for (const ref of refs) {
      const el = ref?.current ?? ref   // handle both useRef objects and direct DOM elements
      if (!el) continue
      const swaps = await rasterizeSvgs(el)
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      })
      restoreSvgs(swaps)
      const imgData = canvas.toDataURL('image/png')
      if (!firstPage) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM)
      firstPage = false
    }

    const safeName = (project?.name || 'report').replace(/[^a-z0-9]/gi, '_')
    const dateStr  = new Date().toISOString().split('T')[0]
    pdf.save(`${safeName}_${dateStr}.pdf`)
  }

  const tabBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      style={{
        padding: '0.35rem 1rem', fontSize: '0.78rem', fontWeight: '600',
        background: activeTab === key ? TEXT_SECONDARY : 'transparent',
        color: activeTab === key ? 'white' : TEXT_PLACEHOLDER,
        border: `1px solid ${activeTab === key ? TEXT_SECONDARY : BORDER}`,
        borderRadius: '6px', cursor: 'pointer',
      }}
    >{label}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: BORDER_FAINT }}>

      {/* Toolbar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.6rem 1.25rem',
        background: BG_LIGHT, borderBottom: `1px solid ${BORDER_LIGHT}`,
      }}>
        {tabBtn('bom', 'Bill of Materials')}
        {tabBtn('pdf', 'PDF Report')}
        <div style={{ flex: 1 }} />
        {activeTab === 'pdf' && (
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
        )}
      </div>

      {/* Content */}
      {activeTab === 'bom' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <BOMView rowConstructions={rowConstructions} rowLabels={rowLabels} />
        </div>
      )}

      {activeTab === 'pdf' && (
        <div ref={pdfScrollRef} style={{
          flex: 1, overflow: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '2rem', gap: '2rem',
        }}>
          {/* Page 1: Panels layout top view */}
          <PanelsLayoutPage
            pageRef={page1Ref}
            panels={panels}
            refinedArea={refinedArea}
            project={project}
            panelType={panelType}
            panelWp={panelWp}
            totalKw={totalKw}
            date={new Date().toLocaleDateString('he-IL')}
          />

          {/* Page 2: Areas (placeholder) */}
          <CadPage
            pageRef={page2Ref}
            project={project}
            panelType={panelType}
            panelWp={panelWp}
            totalKw={totalKw}
            panelCount={panelCount}
            date={new Date().toLocaleDateString('he-IL')}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_MUTED, fontSize: '1rem', fontStyle: 'italic' }}>
              Areas — coming soon
            </div>
          </CadPage>

          {/* Page 3: Bases Layout (BasesPlanTab — all layers except edit bar) */}
          <BasesLayoutPage
            pageRef={page3Ref}
            panels={panels}
            refinedArea={refinedArea}
            trapSettingsMap={trapSettingsMap}
            trapLineRailsMap={trapLineRailsMap}
            trapRCMap={trapRCMap}
            customBasesMap={customBasesMap}
            project={project}
            panelType={panelType}
            panelWp={panelWp}
            totalKw={totalKw}
            date={new Date().toLocaleDateString('he-IL')}
          />

          {/* Page 4: Rails Layout (RailLayoutTab — edit bar hidden, rail lines shown) */}
          <RailsLayoutPage
            pageRef={page4Ref}
            panels={panels}
            refinedArea={refinedArea}
            trapSettingsMap={trapSettingsMap}
            trapLineRailsMap={trapLineRailsMap}
            project={project}
            panelType={panelType}
            panelWp={panelWp}
            totalKw={totalKw}
            date={new Date().toLocaleDateString('he-IL')}
          />

          {/* Pages 5+: One detail page per trapezoid type */}
          {trapIds.map(trapId => (
            <TrapDetailPage
              key={trapId}
              pageRef={el => { trapPageRefs.current[trapId] = el }}
              trapId={trapId}
              rc={trapRCMap[trapId] ?? null}
              settings={trapSettingsMap[trapId] ?? {}}
              lineRails={trapLineRailsMap[trapId] ?? null}
              panelLines={trapPanelLinesMap[trapId] ?? null}
              project={project}
              panelType={panelType}
              panelWp={panelWp}
              totalKw={totalKw}
              date={new Date().toLocaleDateString('he-IL')}
            />
          ))}

        </div>
      )}

    </div>
  )
}
