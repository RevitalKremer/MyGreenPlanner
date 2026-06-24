import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { pagesToPdf } from '../../utils/pdfCapture'
import { BLACK, WHITE, TEXT, TEXT_MUTED, ERROR_DARK, ERROR_BG, BORDER_FAINT, BORDER, BG_LIGHT, TEXT_PLACEHOLDER, PRIMARY, SUCCESS, SUCCESS_BG, SUCCESS_DARK, MODAL_SHADOW, PDF_CANVAS_BG, PDF_CANVAS_BG_ALT } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'
import BOMView from './step3/BOMView'
import TrapDetailPage from './step5/TrapDetailPage'
import { buildTrapezoidGroups, buildFullTrapGhost } from './step3/tabUtils'
import { PDFDocument } from 'pdf-lib'
import { getBOM, computeBOM, recalcBOM, saveBomDeltas, downloadProposal, downloadProduction, fetchProposalPdfBytes, sendReportEmail, requestQuotation, getProjectOwner } from '../../services/projectsApi'
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
function TitleBlock({ project, projectId, panelType, totalKw, count, date, panelWp, pageName, owner, t }) {
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

          {/* col3 row1: created by — owner name + email */}
          <Cell>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
              <div style={LBL}>{t('step5.tb.createdBy')}</div>
              <div>
                <div style={VAL}>{owner?.full_name || '—'}</div>
                {owner?.email && <div style={{ ...VAL, fontSize: '6px', fontWeight: '400' }}>{owner.email}</div>}
              </div>
            </div>
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

          {/* col3 row2: company name (when available) */}
          <Cell>
            <LV label={t('step5.tb.company')} value={owner?.company_name || '—'} />
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
export function CadPage({ project, projectId, panelType, panelWp, totalKw, count, date, children, pageRef, pageName, owner }) {
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
          owner={owner}
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
  panelTypes = [],
  // Fired with the new ISO timestamp after a successful Get Quotation.
  // App.tsx merges it into currentProject so the button label survives
  // navigations / remounts.
  onQuotationRequested = null,
  // Tier 2: the Summary page is the deliverables hub. It triggers PDF /
  // quotation through this ref (Step 5 stays mounted off-screen so its plan
  // pages can still be rasterized). `hideActions` slims Step 5's own toolbar.
  exportApiRef = null,
  hideActions = false,
}) {
  // Admins see the full step 5 surface (BOM tab + Excel + pricing-bearing
  // PDF sections). Non-admins see only the plans-only PDF + the Get Quotation
  // button — they don't have access to BOM, pricing, or the auto Monday push.
  const isAdmin = user?.role === 'admin'
  const page1Ref = useRef(null)
  const page2Ref = useRef(null)
  const page3Ref = useRef(null)
  const page4Ref = useRef(null)
  const page5Ref = useRef(null)
  const trapPageRefs = useRef({})
  const pdfScrollRef = useRef(null)
  const { lang, t } = useLang()
  const [activeTab, setActiveTab] = useState(isAdmin ? 'bom' : 'pdf')
  const [pageScale, setPageScale] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  // Punch marks are factory data — hidden on screen for non-admins, but the plan
  // PDF attached to the Monday item must always include them. Flipped on only
  // for the duration of the PDF capture (buildPlansPdfBytes), then restored.
  const [exportPunches, setExportPunches] = useState(false)
  const [bomItems, setBomItems] = useState([])
  const [bomLoading, setBomLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle')
  // Project OWNER details for the title block (not the logged-in viewer).
  const [owner, setOwner] = useState<{ full_name: string | null; email: string | null; company_name: string | null } | null>(null)
  useEffect(() => {
    if (!projectId) { setOwner(null); return }
    getProjectOwner(projectId).then(setOwner).catch(() => setOwner(null))
  }, [projectId])

  // ── Get Quotation state ────────────────────────────────────────────────
  // Local mirror of project.quotation_requested_at so the button label can
  // flip immediately on success without waiting for a parent re-fetch. Init
  // from the project prop so a reload of an already-quoted project still
  // shows "Request again" rather than "Get Quotation".
  const [quotationRequestedAt, setQuotationRequestedAt] = useState<string | null>(
    project?.quotation_requested_at ?? null
  )
  useEffect(() => {
    setQuotationRequestedAt(project?.quotation_requested_at ?? null)
  }, [project?.quotation_requested_at, project?.id])
  const [requestingQuotation, setRequestingQuotation] = useState(false)
  const [quotationBanner, setQuotationBanner] = useState<'success' | 'error' | null>(null)
  const hasRequestedQuotation = !!quotationRequestedAt

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

  // Panel wattage from the selected panel's spec (DB kw_peak) — never parsed
  // from the model name, which only happens to embed it for some products.
  const panelWp = (panelType ? panelTypes.find((p: any) => p.id === panelType)?.kw : null) ?? null
  const totalKw = panelWp ? (count * panelWp) / 1000 : null


  // Render mounted plan pages to PDF bytes. Returns null if no pages are mounted
  // (e.g. PDF tab not yet active). Caller is responsible for switching tabs first.
  const buildPlansPdfBytes = async (forcePunches = false): Promise<ArrayBuffer | null> => {
    // Punch marks are factory data. They render per the viewing role (admin
    // only) UNLESS forcePunches is set — used solely for the file attached to
    // the Monday item (Get Quotation), so a non-admin's plain "Generate PDF"
    // download never contains them. Two rAFs let React commit the re-render
    // and the browser paint before rasterizing.
    if (forcePunches) {
      setExportPunches(true)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    try {
      const refs = [page1Ref, page2Ref, page3Ref, page4Ref, page5Ref, ...pdfTrapGroups.map(g => trapPageRefs.current[g.trapIds[0]]).filter(Boolean)]
      const els = refs.map((ref: any) => (ref && 'current' in ref) ? ref.current : ref)
      return await pagesToPdf(els)
    } finally {
      if (forcePunches) setExportPunches(false)
    }
  }

  // ── Generate menu ────────────────────────────────────────────────────────
  // Non-admins can only export plans (no pricing / quantities). The state still
  // tracks all three keys so the admin dropdown logic stays unchanged; the
  // non-admin path forces beContent to empty regardless.
  const [menuOpen, setMenuOpen]     = useState(false)
  const [pdfContent, setPdfContent] = useState(
    isAdmin
      ? { pricing: true,  quantities: true,  plans: true }
      : { pricing: false, quantities: false, plans: true }
  )
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

      // Auto-push to Monday is admin-only. Non-admin users push to Monday
      // explicitly via the dedicated "Get Quotation" button (Phase 6) so a
      // plain "save my plan PDF" download doesn't spam the sales board.
      if (isAdmin) {
        await sendReportEmail(projectId, finalBytes, filename)
      }
    } catch (err) {
      console.error('Generate PDF failed:', err)
      alert('Generate PDF failed')
    } finally {
      setIsExporting(false)
    }
  }

  // requestType: 'construction' (this step's button) or 'full' (Final summary —
  // construction + equipment proposals on one Monday item).
  const handleRequestQuotation = async (requestType: 'construction' | 'full' = 'construction') => {
    if (!projectId) return
    setQuotationBanner(null)
    setRequestingQuotation(true)
    try {
      // Attach the full plan PDF report alongside the server-generated Excel.
      // Plan pages are only mounted while the PDF tab is active — mirror
      // handleGeneratePdf: switch to it, then wait one frame for mount.
      let planBytes: ArrayBuffer | null = null
      let pdfFilename: string | null = null
      try {
        if (activeTab !== 'pdf') {
          setActiveTab('pdf')
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
        planBytes = await buildPlansPdfBytes(true)  // Monday attachment → always include punches
        if (planBytes) {
          const safeName = (project?.name || 'report').replace(/[\/\\:*?"<>|]/g, '_')
          const dateStr  = new Date().toISOString().split('T')[0]
          const idSuffix = String(projectId || '').replace(/-/g, '').slice(-8)
          pdfFilename = `${safeName}_plan_${idSuffix}_${dateStr}.pdf`
        }
      } catch (pdfErr) {
        // A rendering hiccup must not block the quotation itself — send without
        // the PDF (the Excel still goes through) and log for diagnosis.
        console.error('Quotation PDF build failed, sending without it:', pdfErr)
      }

      const res = await requestQuotation(projectId, planBytes, pdfFilename, requestType)
      if (res?.quotationRequestedAt) {
        setQuotationRequestedAt(res.quotationRequestedAt)
        // Tell the parent so currentProject.quotation_requested_at sticks —
        // otherwise navigating away and back to step 5 finds the prop still
        // null and the button label resets to "Get Quotation".
        onQuotationRequested?.(res.quotationRequestedAt)
      }
      setQuotationBanner('success')
      setTimeout(() => setQuotationBanner(null), 4000)
    } catch (err) {
      console.error('Quotation request failed:', err)
      setQuotationBanner('error')
      setTimeout(() => setQuotationBanner(null), 4000)
    } finally {
      setRequestingQuotation(false)
    }
  }

  // Publish the export handlers so the Summary hub can trigger them while
  // Step 5 is mounted off-screen. No dep array: re-publish every render so the
  // closures capture the latest state (pdfContent, activeTab, quotation flag).
  useEffect(() => {
    if (!exportApiRef) return
    exportApiRef.current = {
      generatePdf: handleGeneratePdf,
      requestQuotation: handleRequestQuotation,
      isAdmin,
      hasRequestedQuotation,
      isExporting,
      requestingQuotation,
    }
    return () => { if (exportApiRef) exportApiRef.current = null }
  })

  const dateStr = new Date().toLocaleDateString('he-IL')

  const tabs = isAdmin
    ? [
        { key: 'bom', label: t('step5.tab.bom') },
        { key: 'pdf', label: t('step5.tab.pdf') },
      ]
    : [
        { key: 'pdf', label: t('step5.tab.pdf') },
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

      {/* Quotation banner — pops up briefly after Get Quotation completes. */}
      {quotationBanner && (
        <div style={{
          position: 'fixed', top: '5rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9998, padding: '0.6rem 1rem', borderRadius: 8,
          background: quotationBanner === 'success' ? SUCCESS_BG : ERROR_BG,
          color: quotationBanner === 'success' ? SUCCESS : ERROR_DARK,
          fontSize: '0.85rem', fontWeight: 700,
          boxShadow: `0 4px 16px ${MODAL_SHADOW}`,
          maxWidth: '32rem', textAlign: 'center',
        }}>
          {quotationBanner === 'success'
            ? t('step5.quotation.success')
            : t('step5.quotation.failed')}
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

        {/* The action cluster moves to the Summary hub (Tier 2); hidden here
            when `hideActions` is set, but the handlers stay live via exportApiRef. */}
        {!hideActions && (<>
        {/* ── Get Quotation ──
            Available to all roles. Pushes the project to the Sadot
            quotation board on Monday. No credit movement here — the refund
            tooltip explains the policy. Label flips after the first
            request so a re-click reads "Request quotation again". */}
        <button
          onClick={() => handleRequestQuotation('construction')}
          disabled={!projectId || requestingQuotation}
          title={t('step5.quotation.refundNotice')}
          style={{
            padding: '0.35rem 1rem',
            background: hasRequestedQuotation ? WHITE : PRIMARY,
            color: BLACK,
            border: `1.5px solid ${hasRequestedQuotation ? BORDER : PRIMARY}`,
            borderRadius: '6px',
            fontSize: '0.78rem', fontWeight: '700',
            cursor: (projectId && !requestingQuotation) ? 'pointer' : 'not-allowed',
            opacity: (projectId && !requestingQuotation) ? 1 : 0.5,
            marginRight: '0.4rem',
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {requestingQuotation
            ? t('step5.quotation.sending')
            : hasRequestedQuotation
              ? t('step5.quotation.requestAgain')
              : t('step5.quotation.getQuotation')
          }
        </button>

        {/* ── Generate ──
            Non-admin: single "Generate PDF" button (plans only, no choices).
            Admin: dropdown with Excel + pricing/quantities/plans options. */}
        {!isAdmin ? (
          <button
            onClick={handleGeneratePdf}
            disabled={!projectId || isExporting}
            style={{
              padding: '0.35rem 1rem',
              background: PRIMARY, color: BLACK,
              border: 'none', borderRadius: '6px',
              fontSize: '0.78rem', fontWeight: '700',
              cursor: (projectId && !isExporting) ? 'pointer' : 'not-allowed',
              opacity: (projectId && !isExporting) ? 1 : 0.5,
            }}
          >↓ {t('step5.btn.generatePdf')}</button>
        ) : (
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
          >↓ {t('step5.btn.generate')} ▾</button>

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
                  try {
                    await downloadProposal(projectId, project?.name)
                    // Fire-and-forget: trigger Monday item + email (xlsx only,
                    // no PDF). Don't block the user on this — failures are
                    // server-side best-effort already.
                    sendReportEmail(projectId).catch(err =>
                      console.warn('Failed to push xlsx-only report:', err)
                    )
                  }
                  catch (err) { console.error('Failed to generate proposal:', err); alert('Failed to generate proposal') }
                }}
                style={{
                  padding: '0.35rem 0.75rem', background: SUCCESS_DARK, color: WHITE,
                  border: 'none', borderRadius: '5px', fontSize: '0.78rem', fontWeight: '700',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >↓ Proposal file</button>

              {/* Production instructions (saw cuts + punch) — admin-only */}
              <button
                onClick={async () => {
                  setMenuOpen(false)
                  try {
                    await downloadProduction(projectId, project?.name)
                  }
                  catch (err) { console.error('Failed to generate production instructions:', err); alert('Failed to generate production instructions') }
                }}
                style={{
                  padding: '0.35rem 0.75rem', background: PRIMARY, color: WHITE,
                  border: 'none', borderRadius: '5px', fontSize: '0.78rem', fontWeight: '700',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >↓ Production file</button>

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
              >↓ {t('step5.btn.generatePdf')}</button>
            </div>
          )}
        </div>
        )}
        </>)}
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
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <AreasLayoutPage
              pageRef={page2Ref}
              panels={panels} areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
            />
          </ScaledPage>

          <ScaledPage scale={pageScale}>
            <InstallMethodPage
              pageRef={page3Ref}
              panels={panels}
              areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              roofType={roofType}
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
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
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
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
              project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
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
                  canViewPunches={isAdmin || exportPunches}
                  count={groupCount}
                  project={project} projectId={projectId} panelType={panelType} panelWp={panelWp} totalKw={totalKw} date={dateStr} owner={owner}
                />
              </ScaledPage>
            )
          })}

        </div>
      )}

    </div>
  )
}
