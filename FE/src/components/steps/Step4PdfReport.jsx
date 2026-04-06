import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { BLACK, WHITE, TEXT, TEXT_MUTED, ERROR_DARK, BORDER_FAINT, BG_LIGHT, TEXT_PLACEHOLDER, PRIMARY, SUCCESS_DARK, PDF_CANVAS_BG, PDF_CANVAS_BG_ALT } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'
import BOMView from './step3/BOMView'
import TrapDetailPage from './step4/TrapDetailPage'
import { buildTrapezoidGroups } from './step3/tabUtils'
import { getBOM, computeBOM, saveBomDeltas, getEffectiveBOM } from '../../services/projectsApi'
import PanelsLayoutPage from './step4/PanelsLayoutPage'
import AreasLayoutPage from './step4/AreasLayoutPage'
import RailsLayoutPage from './step4/RailsLayoutPage'
import BasesLayoutPage from './step4/BasesLayoutPage'

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
      <colgroup>{/* col widths: approval | project# | approval-req | kW | panel-type | panel-qty | project-name | location | logo */}
        <col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '19%' }} />
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

const PAGE_W_PX = PAGE_W_MM * 3.2
const PAGE_H_PX = PAGE_H_MM * 3.2

// Wrapper that visually scales a CadPage to fit available width,
// while keeping the inner element at its natural size for html2canvas.
function ScaledPage({ scale, children }) {
  return (
    <div style={{ width: PAGE_W_PX * scale, height: PAGE_H_PX * scale, flexShrink: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: PAGE_W_PX, height: PAGE_H_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Main Step 5 component ────────────────────────────────────────────────────
export default function Step4PdfReport({
  panels = [], refinedArea, areas = {}, project, projectId,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  trapPanelLinesMap = {},
  beBasesData = null, beTrapezoidsData = null,
  bomDeltas = {}, onBomDeltasChange,
  products = [], productByType = {}, altsByType = {},
}) {
  const page1Ref = useRef(null)
  const page2Ref = useRef(null)
  const page3Ref = useRef(null)
  const page4Ref = useRef(null)
  const trapPageRefs = useRef({})
  const pdfScrollRef = useRef(null)
  const { lang } = useLang()
  const [activeTab, setActiveTab] = useState('bom')
  const [pageScale, setPageScale] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const [bomItems, setBomItems] = useState([])
  const [bomLoading, setBomLoading] = useState(false)

  // Fetch BOM from server on mount
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      setBomLoading(true)
      try {
        let bom = await getBOM(projectId, lang).catch(() => null)
        if (!bom || bom.isStale) {
          bom = await computeBOM(projectId, lang)
        }
        if (!cancelled) setBomItems(bom.items ?? [])
      } catch (err) {
        console.error('Failed to load BOM:', err)
      } finally {
        if (!cancelled) setBomLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, lang])

  // Debounced save of bomDeltas to server
  const saveDeltasTimer = useRef(null)
  const handleBomDeltasChange = useCallback((deltas) => {
    onBomDeltasChange?.(deltas)
    if (!projectId) return
    clearTimeout(saveDeltasTimer.current)
    saveDeltasTimer.current = setTimeout(() => {
      saveBomDeltas(projectId, deltas).catch(err => console.error('Failed to save BOM deltas:', err))
    }, 800)
  }, [projectId, onBomDeltasChange])

  const handleResetDefaults = useCallback(async () => {
    onBomDeltasChange?.({})
    clearTimeout(saveDeltasTimer.current)
    if (projectId) {
      try { await saveBomDeltas(projectId, {}) } catch (err) { console.error('Failed to reset BOM deltas:', err) }
    }
  }, [projectId, onBomDeltasChange])

  // Block Ctrl+scroll and fit pages to container width
  useEffect(() => {
    const el = pdfScrollRef.current
    if (!el) return
    const blockCtrl = (e) => { if (e.ctrlKey) e.preventDefault() }
    el.addEventListener('wheel', blockCtrl, { passive: false })
    const computeScale = () => {
      const available = el.clientWidth - 64  // 2 × 2rem padding
      setPageScale(Math.min(1, available / PAGE_W_PX))
    }
    computeScale()
    const ro = new ResizeObserver(computeScale)
    ro.observe(el)
    return () => { el.removeEventListener('wheel', blockCtrl); ro.disconnect() }
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
      // Use the SVG's natural (pre-transform) dimensions from its attributes.
      // getBoundingClientRect() returns the visually-scaled size which is wrong
      // when the SVG is inside a CSS scale() transform — it would be double-scaled.
      const attrW = parseFloat(svg.getAttribute('width'))
      const attrH = parseFloat(svg.getAttribute('height'))
      const hasNaturalDims = attrW > 0 && attrH > 0 && !String(svg.getAttribute('width')).includes('%')
      let w, h
      if (hasNaturalDims) {
        w = Math.round(attrW)
        h = Math.round(attrH)
      } else {
        const rect = svg.getBoundingClientRect()
        w = Math.round(rect.width)
        h = Math.round(rect.height)
      }
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
    setIsExporting(true)
    const refs = [page1Ref, page2Ref, page3Ref, page4Ref, ...trapIds.map(id => trapPageRefs.current[id]).filter(Boolean)]
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    let firstPage = true

    for (const ref of refs) {
      const el = ref?.current ?? ref   // handle both useRef objects and direct DOM elements
      if (!el) continue

      // Temporarily neutralise the ScaledPage transform so html2canvas captures
      // the page at its natural PAGE_W_PX × PAGE_H_PX size, not the screen-scaled size.
      const parent = el.parentElement
      const savedTransform = parent?.style.transform ?? ''
      if (parent) parent.style.transform = 'none'

      const swaps = await rasterizeSvgs(el)
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: PAGE_W_PX,
        height: PAGE_H_PX,
      })
      restoreSvgs(swaps)
      if (parent) parent.style.transform = savedTransform
      const imgData = canvas.toDataURL('image/png')
      if (!firstPage) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM)
      firstPage = false
    }

    const safeName = (project?.name || 'report').replace(/[^a-z0-9]/gi, '_')
    const dateStr  = new Date().toISOString().split('T')[0]
    pdf.save(`${safeName}_${dateStr}.pdf`)
    setIsExporting(false)
  }

  const handleExportExcel = async () => {
    // Fetch effective BOM (base + deltas applied) from server
    let finalRows
    try {
      if (projectId) {
        const effective = await getEffectiveBOM(projectId, lang)
        finalRows = effective.items ?? []
      } else {
        finalRows = bomItems
      }
    } catch {
      finalRows = bomItems
    }

    const dateExport = new Date().toLocaleDateString()
    const projectName = project?.name || ''
    const location    = project?.location || ''

    // Sheet data: header block + table
    const sheetData = [
      ['MyGreenPlanner — Solar PV Planning System'],
      ['by Sadot Energy'],
      [],
      ['Project', projectName, '', 'Location', location],
      ['Date',    dateExport,  '', 'Total kW', totalKw ? `${totalKw.toFixed(2)} kW` : ''],
      [],
      ['#', 'Area', 'Element', 'Part Number', 'Length (m)', 'Qty', 'Extras', 'Total'],
      ...finalRows.map((row, i) => {
        const product = productByType[row.element]
        return [
          i + 1,
          row.areaLabel,
          product?.name ?? row.name ?? row.element,
          product?.pn   ?? row.partNumber ?? '',
          row.totalLengthM != null ? +Number(row.totalLengthM).toFixed(2) : '',
          row.qty,
          row.extras ?? 0,
          (row.qty ?? 0) + (row.extras ?? 0),
        ]
      }),
    ]

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // Column widths
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 18 },
      { wch: 11 }, { wch: 7 }, { wch: 8 }, { wch: 8 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bill of Materials')

    const safeName = (project?.name || 'report').replace(/[^a-z0-9]/gi, '_')
    const dateStr  = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `${safeName}_BOM_${dateStr}.xlsx`)
  }

  const dateStr = new Date().toLocaleDateString('he-IL')

  const tabs = [
    { key: 'bom', label: 'Bill of Materials' },
    { key: 'pdf', label: 'PDF Report' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: PDF_CANVAS_BG, position: 'relative' }}>
      {isExporting && (
        <div className="processing-overlay">
          <div className="spinner"></div>
          <p>Generating PDF...</p>
        </div>
      )}

      {/* Tab bar — same style as Step 4 */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: `2px solid ${BORDER_FAINT}`,
        background: BG_LIGHT, padding: '0 1rem', gap: '0.25rem',
        flexShrink: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: '600',
              background: activeTab === tab.key ? WHITE : 'transparent',
              color: activeTab === tab.key ? TEXT : TEXT_PLACEHOLDER,
              borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >{tab.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleExportExcel}
          style={{
            padding: '0.35rem 1rem',
            background: SUCCESS_DARK, color: WHITE,
            border: 'none', borderRadius: '6px',
            fontSize: '0.78rem', fontWeight: '700',
            cursor: 'pointer',
          }}
        >↓ Export Excel</button>
        {activeTab === 'pdf' && (
          <button
            onClick={handleExportPdf}
            style={{
              padding: '0.35rem 1rem',
              background: SUCCESS_DARK, color: WHITE,
              border: 'none', borderRadius: '6px',
              fontSize: '0.78rem', fontWeight: '700',
              cursor: 'pointer',
            }}
          >↓ Export PDF</button>
        )}
      </div>

      {/* BOM tab */}
      {activeTab === 'bom' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', background: PDF_CANVAS_BG }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {bomLoading
              ? <div style={{ textAlign: 'center', padding: '3rem', color: TEXT_PLACEHOLDER }}>Loading BOM...</div>
              : <BOMView bomItems={bomItems} bomDeltas={bomDeltas} onBomDeltasChange={handleBomDeltasChange} onResetDefaults={handleResetDefaults} products={products} productByType={productByType} altsByType={altsByType} />
            }
          </div>
        </div>
      )}

      {/* PDF tab */}
      {activeTab === 'pdf' && (
        <div ref={pdfScrollRef} style={{
          flex: 1, overflow: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '2rem', gap: '2.5rem',
          backgroundImage: `radial-gradient(circle, ${PDF_CANVAS_BG_ALT} 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}>
          <ScaledPage scale={pageScale}>
            <PanelsLayoutPage
              pageRef={page1Ref}
              panels={panels}
              project={project} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <AreasLayoutPage
              pageRef={page2Ref}
              panels={panels} areas={areas}
              project={project} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <BasesLayoutPage
              pageRef={page3Ref}
              panels={panels} refinedArea={refinedArea} areas={areas}
              trapSettingsMap={trapSettingsMap} trapLineRailsMap={trapLineRailsMap}
              trapRCMap={trapRCMap} customBasesMap={customBasesMap}
              beBasesData={beBasesData} beTrapezoidsData={beTrapezoidsData}
              project={project} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <RailsLayoutPage
              pageRef={page4Ref}
              panels={panels} refinedArea={refinedArea}
              trapSettingsMap={trapSettingsMap} trapLineRailsMap={trapLineRailsMap}
              project={project} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr}
            />
          </ScaledPage>

          {trapIds.map(trapId => (
            <ScaledPage key={trapId} scale={pageScale}>
              <TrapDetailPage
                pageRef={el => { trapPageRefs.current[trapId] = el }}
                trapId={trapId}
                rc={trapRCMap[trapId] ?? null}
                settings={trapSettingsMap[trapId] ?? {}}
                lineRails={trapLineRailsMap[trapId] ?? null}
                panelLines={trapPanelLinesMap[trapId] ?? null}
                beDetailData={beTrapezoidsData?.[trapId]}
                project={project} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr}
              />
            </ScaledPage>
          ))}

        </div>
      )}

    </div>
  )
}
