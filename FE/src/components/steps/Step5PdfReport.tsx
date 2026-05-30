import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { BLACK, WHITE, TEXT, TEXT_MUTED, ERROR_DARK, BORDER_FAINT, BORDER, BG_LIGHT, TEXT_PLACEHOLDER, PRIMARY, SUCCESS_DARK, PDF_CANVAS_BG, PDF_CANVAS_BG_ALT } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'
import BOMView from './step3/BOMView'
import TrapDetailPage from './step5/TrapDetailPage'
import { buildTrapezoidGroups, buildFullTrapGhost } from './step3/tabUtils'
import { PDFDocument } from 'pdf-lib'
import { getBOM, computeBOM, recalcBOM, saveBomDeltas, downloadProposal, fetchProposalPdfBytes, sendReportEmail } from '../../services/projectsApi'
import PanelsLayoutPage from './step5/PanelsLayoutPage'
import AreasLayoutPage from './step5/AreasLayoutPage'
import RailsLayoutPage from './step5/RailsLayoutPage'
import BasesLayoutPage from './step5/BasesLayoutPage'
import InstallMethodPage from './step5/InstallMethodPage'

// ─── Page dimensions (A4 landscape, mm) ──────────────────────────────────────
const PAGE_W_MM  = 297
const PAGE_H_MM  = 210
const FRAME_MM   = 8    // inner frame inset from page edge
const FOOTER_H_MM = 26  // title block height

// ─── Shared cell styles ───────────────────────────────────────────────────────
const B  = `0.5px solid ${BLACK}`
const cellBase: React.CSSProperties = { borderLeft: B, padding: '2px 3px', boxSizing: 'border-box', verticalAlign: 'top', overflow: 'hidden' }
const LBL: React.CSSProperties = { fontSize: '5px', color: TEXT_MUTED, lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }
const VAL: React.CSSProperties = { fontSize: '9px', fontWeight: '800', color: BLACK, lineHeight: 1.2, textAlign: 'center' }

function Cell({ style = null, children = null }) {
  return <td style={{ ...cellBase, ...style }}>{children}</td>
}
function LV({ label, value, vStyle = null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
      <div style={LBL}>{label}</div>
      <div style={{ ...VAL, ...vStyle }}>{value}</div>
    </div>
  )
}

// ─── CAD Title Block ─────────────────────────────────────────────────────────
// Layout (9 cols, 2 rows):
// Row1: [תבנית] [מספר פרויקט] [approval↕rowspan2] [הספק כולל] [סוג פאנל←colspan2] [שם פרויקט←colspan2] [logo↕rowspan2]
// Row2: [לאישור] [blank]       [spanned]           [blank]     [הספק]  [כמות]       [תאריך] [מיקום]       [spanned]
function TitleBlock({ project, projectId, panelType, totalKw, count, date, panelWp, pageName, user, t }) {
  const projectName = project?.name     || '<project name>'
  const location    = project?.location || '<location>'
  const dateStr     = date || new Date().toLocaleDateString('he-IL')
  const kWstr       = totalKw ? `${totalKw.toFixed(2)}kW` : '—'
  const wpStr       = panelWp ? `${panelWp}W`             : '—'
  const qtyStr      = count != null ? String(count) : '—'
  const approvalLines = t('step5.tb.approvalReq').split('\n')

  return (
    <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: B }}>
      <colgroup>{/* col widths: approval | project# | approval-req | kW | panel-type | panel-qty | project-name | location | logo */}
        <col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '19%' }} />
      </colgroup>
      <tbody>

        {/* ── Row 1 ─────────────────────────────────────────────────────── */}
        <tr style={{ height: '50%', borderBottom: B }}>

          {/* col1 row1: template / page name (may be multiple IDs when consolidated) */}
          <Cell style={{ borderLeft: 'none' }}>
            {pageName
              ? <LV
                  label={t('step5.tb.template')}
                  value={pageName}
                  vStyle={pageName.includes(',') ? { fontSize: '7px', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.15 } : undefined}
                />
              : <LV label={t('step5.tb.template')} value="D3" />
            }
          </Cell>

          {/* col2 row1: project number */}
          <Cell>
            <LV label={t('step5.tb.projectNum')} value={projectId || '—'} vStyle={{ fontSize: '5px', wordBreak: 'break-all', lineHeight: 1.1 }} />
          </Cell>

          {/* col3 row1: created by name */}
          <Cell>
            <LV label={t('step5.tb.createdBy')} value={user?.full_name || '—'} />
          </Cell>

          {/* col4 row1: total power */}
          <Cell>
            <LV label={t('step5.tb.totalPower')} value={kWstr} />
          </Cell>

          {/* col5-6 row1: panel type (colspan=2) */}
          <td colSpan={2} style={{ ...cellBase }}>
            <LV label={t('step5.tb.panelType')} value={panelType} />
          </td>

          {/* col7-8 row1: project name (colspan=2) */}
          <td colSpan={2} style={{ ...cellBase }}>
            <LV label={t('step5.tb.projectName')} value={projectName} />
          </td>

          {/* col9: logo — rowspan=2 */}
          <td rowSpan={2} style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center', padding: '3px 5px' }}>
            <img src="/sadotenergylogo.png" alt="logo"
              style={{ maxWidth: '100%', maxHeight: '40px', objectFit: 'contain', display: 'block', margin: '0 auto' }} />
          </td>
        </tr>

        {/* ── Row 2 ─────────────────────────────────────────────────────── */}
        <tr style={{ height: '50%' }}>

          {/* col1 row2: for approval */}
          <td style={{ ...cellBase, borderLeft: 'none', verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{ background: '#2563eb', color: '#fff', fontWeight: '800', fontSize: '9px', borderRadius: '2px', padding: '2px 6px', display: 'inline-block' }}>{t('step5.tb.forApproval')}</div>
          </td>

          {/* col2 row2: approval required */}
          <td style={{ ...cellBase, verticalAlign: 'middle', textAlign: 'center' }}>
            <div style={{ fontSize: '7px', fontWeight: '700', color: TEXT, lineHeight: 1.4, marginBottom: '3px' }}>
              {approvalLines.map((line, i) => <span key={i}>{line}{i < approvalLines.length - 1 && <br />}</span>)}
            </div>
            <span style={{ background: ERROR_DARK, color: WHITE, fontWeight: '900', fontSize: '10px', borderRadius: '2px', padding: '1px 5px' }}>!</span>
          </td>

          {/* col3 row2: created by email */}
          <Cell>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ ...VAL, fontSize: '6px', fontWeight: '400' }}>{user?.email || '—'}</div>
            </div>
          </Cell>

          {/* col4 row2: blank */}
          <Cell />

          {/* col5 row2: power */}
          <Cell>
            <LV label={t('step5.tb.power')} value={wpStr} />
          </Cell>

          {/* col6 row2: quantity */}
          <Cell>
            <LV label={t('step5.tb.quantity')} value={qtyStr} />
          </Cell>

          {/* col7 row2: date */}
          <Cell>
            <LV label={t('step5.tb.date')} value={dateStr} />
          </Cell>

          {/* col8 row2: location */}
          <Cell>
            <LV label={t('step5.tb.location')} value={location} />
          </Cell>

          {/* col9 spanned — skip */}
        </tr>

      </tbody>
    </table>
  )
}

// ─── Single CAD page ──────────────────────────────────────────────────────────
export function CadPage({ project, projectId, panelType, panelWp, totalKw, count, date, children, pageRef, pageName, user }) {
  const { t } = useLang()
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
          projectId={projectId}
          panelType={panelType}
          panelWp={panelWp}
          totalKw={totalKw}
          count={count}
          date={date}
          pageName={pageName}
          user={user}
          t={t}
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
export default function Step5PdfReport({
  user = null,
  panels = [], refinedArea, areas = [], project, projectId,
  uploadedImageData, imageSrc,
  rectAreas = null,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  trapPanelLinesMap = {}, roofType = 'concrete',
  beRailsData = null, beBasesData = null, beTrapezoidsData = null,
  beTrapezoidGroups = [],
  bomDeltas = {}, onBomDeltasChange,
  products = [], productByType = {}, altsByType = {},
}) {
  const page1Ref = useRef(null)
  const page2Ref = useRef(null)
  const page3Ref = useRef(null)
  const page4Ref = useRef(null)
  const page5Ref = useRef(null)
  const trapPageRefs = useRef({})
  const pdfScrollRef = useRef(null)
  const { lang } = useLang()
  const [activeTab, setActiveTab] = useState('bom')
  const [pageScale, setPageScale] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const [bomItems, setBomItems] = useState([])
  const [bomLoading, setBomLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle')

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

  // Auto-save: debounce 600 ms after the last delta change, then save +
  // materialize in one shot so the user never has to click Recalc.
  const autoSaveTimer = useRef(null)
  const autoSaveAbort = useRef<AbortController | null>(null)

  const runAutoSave = useCallback(async (deltas) => {
    if (!projectId) return
    autoSaveAbort.current?.abort()
    const ctrl = new AbortController()
    autoSaveAbort.current = ctrl
    setSaveStatus('saving')
    try {
      await saveBomDeltas(projectId, deltas)
      if (ctrl.signal.aborted) return
      const bom = await recalcBOM(projectId, lang)
      if (ctrl.signal.aborted) return
      setBomItems(bom.items ?? [])
      onBomDeltasChange?.({})
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
    } catch (err) {
      if (!ctrl.signal.aborted) {
        console.error('Auto-save BOM failed:', err)
        setSaveStatus('error')
      }
    }
  }, [projectId, lang, onBomDeltasChange])

  const handleBomDeltasChange = useCallback((deltas) => {
    onBomDeltasChange?.(deltas)
    if (!projectId) return
    clearTimeout(autoSaveTimer.current)
    setSaveStatus('saving')
    autoSaveTimer.current = setTimeout(() => runAutoSave(deltas), 600)
  }, [projectId, onBomDeltasChange, runAutoSave])

  const handleResetDefaults = useCallback(async () => {
    clearTimeout(autoSaveTimer.current)
    onBomDeltasChange?.({})
    await runAutoSave({})
  }, [onBomDeltasChange, runAutoSave])

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

  const count = panels.length
  const panelType  = refinedArea?.panelType ?? null

  const { keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  // Variations live in beTrapezoidsData with a parentId pointing at the
  // step2 trap, but panels only carry the parent trapId — so trapIds (from
  // buildTrapezoidGroups(panels)) won't include "A.1". Allow variation IDs
  // through the filter when their parent is one of the panel-derived trapIds.
  const allowedTrapIds = useMemo(() => {
    const set = new Set(trapIds)
    if (beTrapezoidsData) {
      for (const [tid, t] of Object.entries(beTrapezoidsData)) {
        const parentId = (t as any)?.parentId
        if (parentId && set.has(parentId)) set.add(tid)
      }
    }
    return set
  }, [trapIds, beTrapezoidsData])

  // One PDF page per group of structurally identical traps (server-computed).
  // Fall back to one page per trap for older projects that lack groups.
  const pdfTrapGroups = useMemo(() => {
    if (beTrapezoidGroups?.length) {
      return beTrapezoidGroups
        .map(g => ({ ...g, trapIds: g.trapIds.filter(id => allowedTrapIds.has(id)) }))
        .filter(g => g.trapIds.length > 0)
    }
    return [...allowedTrapIds].map((id, i) => ({ groupIdx: i, trapIds: [id] }))
  }, [beTrapezoidGroups, allowedTrapIds])

  // Map trapId → all trapezoidIds in the same area (used for ghost + trap count)
  const areaGroupMap = useMemo(() => {
    const map = {}
    for (const area of (areas ?? [])) {
      for (const tid of (area.trapezoidIds ?? [])) {
        map[tid] = area.trapezoidIds
      }
    }
    return map
  }, [areas])

  // Build ghost map: for each non-full trapId, find the full-trap in its area
  // with the same cross-section family (line count, angle, front height).
  const fullTrapGhostMap = useMemo(() => {
    const map = {}
    for (const tid of trapIds) {
      const areaTids = areaGroupMap[tid] ?? [tid]
      const ghost = buildFullTrapGhost(tid, areaTids, beTrapezoidsData, trapPanelLinesMap, trapLineRailsMap, trapRCMap)
      if (ghost) map[tid] = ghost
    }
    return map
  }, [trapIds, areaGroupMap, beTrapezoidsData, trapPanelLinesMap, trapLineRailsMap, trapRCMap])

  // Parse panel wattage from model name (e.g. "AIKO-G670-..." → 670W)
  const panelWp = (() => {
    if (!panelType) return null
    const m = panelType.match(/[A-Z0-9](\d{3})[^0-9]/)
    return m ? parseInt(m[1], 10) : null
  })()
  const totalKw = panelWp ? (count * panelWp) / 1000 : null

  // Pre-rasterize all <svg> elements in a page element to <img> tags so html2canvas
  // doesn't need to parse SVG (which it handles poorly for complex/transformed content).
  const rasterizeSvgs = async (pageEl: HTMLElement) => {
    const svgs = Array.from(pageEl.querySelectorAll('svg')) as SVGSVGElement[]
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
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('width', w)
      clone.setAttribute('height', h)

      // Inject a <style> element so serialized SVG text uses the same font-family
      // as the page. Without this the standalone SVG document has no CSS context and
      // browsers fall back to a default serif font, which renders blurry/illegible
      // at the small sizes used in CAD annotations.
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      styleEl.textContent = `
        text, tspan {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
            'Helvetica Neue', Arial, sans-serif;
          text-rendering: geometricPrecision;
          shape-rendering: geometricPrecision;
        }
      `
      clone.insertBefore(styleEl, clone.firstChild)

      // Convert <image> elements in SVG to embedded data URLs so they're captured properly
      const svgImages = clone.querySelectorAll('image')
      for (const svgImg of svgImages) {
        const href = svgImg.getAttribute('href') || svgImg.getAttribute('xlink:href')
        if (href && !href.startsWith('data:')) {
          try {
            // If it's already a data URL from imageSrc, keep it; otherwise skip
            // (This handles the BackgroundImageLayer roof image)
            if (href.startsWith('blob:') || href.startsWith('http')) {
              // Load the image and convert to data URL
              const img = new Image()
              img.crossOrigin = 'anonymous'
              await new Promise((resolve, reject) => {
                img.onload = resolve
                img.onerror = reject
                img.src = href
              })
              const canvas = document.createElement('canvas')
              canvas.width = img.naturalWidth
              canvas.height = img.naturalHeight
              const ctx = canvas.getContext('2d')
              ctx.drawImage(img, 0, 0)
              const dataUrl = canvas.toDataURL('image/png')
              svgImg.setAttribute('href', dataUrl)
            }
          } catch (e) {
            console.warn('Failed to embed image in SVG:', e)
          }
        }
      }
      
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

  // Render mounted plan pages to PDF bytes. Returns null if no pages are mounted
  // (e.g. PDF tab not yet active). Caller is responsible for switching tabs first.
  const buildPlansPdfBytes = async (): Promise<ArrayBuffer | null> => {
    const refs = [page1Ref, page2Ref, page3Ref, page4Ref, page5Ref, ...pdfTrapGroups.map(g => trapPageRefs.current[g.trapIds[0]]).filter(Boolean)]
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    let firstPage = true

    for (const ref of refs) {
      // For useRef objects: use .current (null when unmounted → skip).
      // For direct DOM elements (trapPageRefs): use as-is.
      const el = (ref && 'current' in ref) ? ref.current : ref
      if (!el) continue

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
      const imgData = canvas.toDataURL('image/jpeg', 0.85)
      if (!firstPage) pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W_MM, PAGE_H_MM)
      firstPage = false
    }

    return firstPage ? null : (pdf.output('arraybuffer') as ArrayBuffer)
  }

  // ── Generate menu ────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen]     = useState(false)
  const [pdfContent, setPdfContent] = useState({ pricing: true, quantities: true, plans: true })
  const menuRef      = useRef<HTMLDivElement>(null)
  const generateRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !generateRef.current?.contains(e.target as Node))
        setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const allPdfChecked = pdfContent.pricing && pdfContent.quantities && pdfContent.plans
  const anyPdfChecked = pdfContent.pricing || pdfContent.quantities || pdfContent.plans

  const handleGeneratePdf = async () => {
    setMenuOpen(false)
    const beContent: string[] = []
    if (pdfContent.pricing)    beContent.push('pricing')
    if (pdfContent.quantities) beContent.push('quantities')

    setIsExporting(true)
    try {
      // PDF pages are only mounted when the PDF tab is active.
      if (pdfContent.plans && activeTab !== 'pdf') {
        setActiveTab('pdf')
        await new Promise(resolve => requestAnimationFrame(resolve))
      }

      const [beBytes, planBytes] = await Promise.all([
        beContent.length > 0 ? fetchProposalPdfBytes(projectId, beContent) : Promise.resolve(null),
        pdfContent.plans ? buildPlansPdfBytes() : Promise.resolve(null),
      ])

      if (!beBytes && !planBytes) return

      let finalBytes: ArrayBuffer
      if (beBytes && planBytes) {
        // Merge BE pages (pricing/quantities) followed by plan pages into one PDF.
        const merged  = await PDFDocument.create()
        const bePdf   = await PDFDocument.load(beBytes)
        const planPdf = await PDFDocument.load(planBytes)
        const bePages   = await merged.copyPages(bePdf,   bePdf.getPageIndices())
        bePages.forEach(p => merged.addPage(p))
        const planPages = await merged.copyPages(planPdf, planPdf.getPageIndices())
        planPages.forEach(p => merged.addPage(p))
        finalBytes = (await merged.save()).buffer as ArrayBuffer
      } else {
        finalBytes = (beBytes ?? planBytes)!
      }

      const safeName  = (project?.name || 'report').replace(/[\/\\:*?"<>|]/g, '_')
      const dateStr   = new Date().toISOString().split('T')[0]
      const idSuffix  = String(projectId || '').replace(/-/g, '').slice(-8)
      const filename  = `${safeName}_plan_${idSuffix}_${dateStr}.pdf`

      const blob = new Blob([finalBytes], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      await sendReportEmail(projectId, finalBytes, filename)
    } catch (err) {
      console.error('Generate PDF failed:', err)
      alert('Generate PDF failed')
    } finally {
      setIsExporting(false)
    }
  }

  const dateStr = new Date().toLocaleDateString('he-IL')

  const tabs = [
    { key: 'bom', label: 'Bill of Materials' },
    { key: 'pdf', label: 'PDF Report' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: PDF_CANVAS_BG, position: 'relative' }}>
      {isExporting && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="processing-overlay" style={{ position: 'static', transform: 'none', margin: 0 }}>
            <div className="spinner"></div>
            <p>Generating PDF...</p>
          </div>
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

        {/* ── Generate dropdown ── */}
        <div style={{ position: 'relative' }}>
          <button
            ref={generateRef}
            onClick={() => setMenuOpen(o => !o)}
            disabled={!projectId}
            style={{
              padding: '0.35rem 1rem',
              background: PRIMARY, color: BLACK,
              border: 'none', borderRadius: '6px',
              fontSize: '0.78rem', fontWeight: '700',
              cursor: projectId ? 'pointer' : 'not-allowed',
              opacity: projectId ? 1 : 0.5,
            }}
          >↓ Generate ▾</button>

          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                background: WHITE, border: `1px solid ${BORDER}`,
                borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                padding: '0.75rem', minWidth: '200px', zIndex: 999,
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}
            >
              {/* Excel */}
              <button
                onClick={async () => {
                  setMenuOpen(false)
                  try { await downloadProposal(projectId, project?.name) }
                  catch (err) { console.error('Failed to generate proposal:', err); alert('Failed to generate proposal') }
                }}
                style={{
                  padding: '0.35rem 0.75rem', background: SUCCESS_DARK, color: WHITE,
                  border: 'none', borderRadius: '5px', fontSize: '0.78rem', fontWeight: '700',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >↓ Excel</button>

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${BORDER}`, margin: '0.25rem 0' }} />

              {/* PDF checkboxes */}
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: TEXT_MUTED, marginBottom: '0.1rem' }}>PDF content</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', userSelect: 'none', fontWeight: '700', paddingBottom: '0.25rem', borderBottom: `1px solid ${BORDER_FAINT}`, marginBottom: '0.05rem' }}>
                <input
                  type="checkbox"
                  checked={allPdfChecked}
                  ref={el => { if (el) el.indeterminate = anyPdfChecked && !allPdfChecked }}
                  onChange={e => setPdfContent({ pricing: e.target.checked, quantities: e.target.checked, plans: e.target.checked })}
                />
                All
              </label>
              {(['pricing', 'quantities', 'plans'] as const).map(key => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={pdfContent[key]}
                    onChange={e => setPdfContent(p => ({ ...p, [key]: e.target.checked }))}
                  />
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
              ))}

              <button
                onClick={handleGeneratePdf}
                disabled={!anyPdfChecked}
                style={{
                  marginTop: '0.25rem', padding: '0.35rem 0.75rem',
                  background: anyPdfChecked ? PRIMARY : BG_LIGHT, color: anyPdfChecked ? BLACK : TEXT_MUTED,
                  border: 'none', borderRadius: '5px', fontSize: '0.78rem', fontWeight: '700',
                  cursor: anyPdfChecked ? 'pointer' : 'not-allowed',
                }}
              >↓ Generate PDF</button>
            </div>
          )}
        </div>
      </div>

      {/* BOM tab */}
      {activeTab === 'bom' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', background: PDF_CANVAS_BG }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {bomLoading
              ? <div style={{ textAlign: 'center', padding: '3rem', color: TEXT_PLACEHOLDER }}>Loading BOM...</div>
              : <BOMView bomItems={bomItems} bomDeltas={bomDeltas} onBomDeltasChange={handleBomDeltasChange} onResetDefaults={handleResetDefaults} saveStatus={saveStatus} products={products} productByType={productByType} altsByType={altsByType} />
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
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <AreasLayoutPage
              pageRef={page2Ref}
              panels={panels} areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <InstallMethodPage
              pageRef={page3Ref}
              panels={panels}
              areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              roofType={roofType}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <BasesLayoutPage
              pageRef={page4Ref}
              panels={panels} refinedArea={refinedArea} areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              trapSettingsMap={trapSettingsMap} trapLineRailsMap={trapLineRailsMap}
              trapRCMap={trapRCMap} customBasesMap={customBasesMap}
              beBasesData={beBasesData} beTrapezoidsData={beTrapezoidsData}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <RailsLayoutPage
              pageRef={page5Ref}
              panels={panels} refinedArea={refinedArea}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              trapSettingsMap={trapSettingsMap}
              beRailsData={beRailsData}
              rectAreas={rectAreas}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
            />
          </ScaledPage>

          {pdfTrapGroups.map(group => {
            // Render one page per group, using the first member as the
            // visual representative — all members are structurally identical
            // by definition (see BE group_identical_trapezoids).
            const repId = group.trapIds[0]
            const memberSet = new Set(group.trapIds)
            const groupCount = (beBasesData ?? []).reduce(
              (n, ad) => n + (ad.bases ?? []).filter(b => memberSet.has(b.trapezoidId)).length,
              0,
            ) || null
            return (
              <ScaledPage key={repId} scale={pageScale}>
                <TrapDetailPage
                  pageRef={el => { trapPageRefs.current[repId] = el }}
                  trapId={repId}
                  memberIds={group.trapIds}
                  rc={trapRCMap[repId] ?? null}
                  settings={trapSettingsMap[repId] ?? {}}
                  lineRails={trapLineRailsMap[repId] ?? null}
                  panelLines={trapPanelLinesMap[repId] ?? null}
                  beDetailData={beTrapezoidsData?.[repId]}
                  fullTrapGhost={fullTrapGhostMap[repId] ?? null}
                  count={groupCount}
                  project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} user={user}
                />
              </ScaledPage>
            )
          })}

        </div>
      )}

    </div>
  )
}
