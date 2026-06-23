import { useState, useEffect, useMemo, useRef } from 'react'
import { useLang } from '../../i18n/LangContext'
import {
  getElectricalBomEffective, computeElectricalBOM, recalcElectricalBOM,
  fetchSadotEquipment, requestQuotation, downloadElectricalProposal, getProjectOwner,
} from '../../services/projectsApi'
import { CadPage } from './Step5PdfReport'
import { buildFleet } from './Step7StringsPlan'
import { StringCanvas } from './step7/StringsPlanTab'
import SldTab from './step7/SldTab'
import SummaryTab from './step7/SummaryTab'
import { pagesToPdf, PAGE_W_PX, PAGE_H_PX } from '../../utils/pdfCapture'
import {
  PRIMARY, PRIMARY_DARK, TEXT, TEXT_SECONDARY, TEXT_MUTED, TEXT_PLACEHOLDER,
  BORDER, BORDER_FAINT, BG_FAINT, BG_LIGHT, PRIMARY_BG, WHITE, BLACK, SUCCESS_DARK,
  SUCCESS, SUCCESS_BG, ERROR, ERROR_DARK, ERROR_BG,
} from '../../styles/colors'

// Visually scale a CadPage to fit the preview, keeping the inner page at natural
// size so the PDF capture (which resets the parent transform) stays sharp.
function ScaledPage({ scale, children }: any) {
  return (
    <div style={{ width: PAGE_W_PX * scale, height: PAGE_H_PX * scale, flexShrink: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: PAGE_W_PX, height: PAGE_H_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

// Step 9 — electrical (Sadot goods) BOM + a PDF tab with the Step 7 diagrams.
// Admins see the BOM table; everyone gets the PDF tab (download + get quotation
// for the electrical equipment only).
export default function Step9ElectricalBom({ projectId, project, user, panels, strings, inverterLayout, panelWatt, panelTypeName, inverters, onQuotationRequested, exportApiRef = null, hideActions = false }: any) {
  const { t, lang } = useLang()
  const isAdmin = user?.role === 'admin'
  const sadotUrlFor = (u: any): string | null => (u && typeof u === 'object' ? (u[lang] || u.en || u.he || null) : (u || null))

  const [activeTab, setActiveTab] = useState<'bom' | 'pdf'>(isAdmin ? 'bom' : 'pdf')

  // ── Electrical BOM (admin table) ──
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const load = async () => {
    if (!projectId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await getElectricalBomEffective(projectId)
      setItems(res.items || [])
    } catch {
      try { await computeElectricalBOM(projectId); const res = await getElectricalBomEffective(projectId); setItems(res.items || []) }
      catch { setItems([]) }
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const handleRecalc = async () => {
    if (!projectId) return
    setLoading(true)
    try { await recalcElectricalBOM(projectId) } catch { /* ignore */ }
    await load()
  }

  // ── Fleet (units/ports) for the diagrams ──
  const [equipment, setEquipment] = useState<any[]>([])
  useEffect(() => { fetchSadotEquipment().then(setEquipment).catch(() => setEquipment([])) }, [])
  const byKey = useMemo(() => Object.fromEntries(equipment.map(e => [e.type_key, e])), [equipment])
  const { units, ports } = useMemo(() => buildFleet(inverters, byKey), [inverters, byKey])

  const realCount = (panels || []).filter((p: any) => !p.isEmpty).length
  const totalKw = realCount * (panelWatt || 0) / 1000
  const hasStrings = (strings || []).length > 0

  // ── PDF export ──
  const page1Ref = useRef<HTMLDivElement>(null)
  const page2Ref = useRef<HTMLDivElement>(null)
  const page3Ref = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [quotationRequestedAt, setQuotationRequestedAt] = useState<string | null>(project?.quotation_requested_at ?? null)
  useEffect(() => { setQuotationRequestedAt(project?.quotation_requested_at ?? null) }, [project?.quotation_requested_at])
  const [banner, setBanner] = useState<'success' | 'error' | null>(null)

  // Owner (created-by + company) for the PDF title block.
  const [owner, setOwner] = useState<{ full_name: string | null; email: string | null; company_name: string | null } | null>(null)
  useEffect(() => { if (projectId) getProjectOwner(projectId).then(setOwner).catch(() => setOwner(null)) }, [projectId])

  // Fit pages to the container width (like Step 5).
  const pdfScrollRef = useRef<HTMLDivElement>(null)
  const [pageScale, setPageScale] = useState(1)
  useEffect(() => {
    const el = pdfScrollRef.current
    if (!el) return
    const compute = () => setPageScale(Math.min(1, (el.clientWidth - 64) / PAGE_W_PX))
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeTab])

  // Generate dropdown (admin).
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const generateRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !generateRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const pdfFilename = () => {
    const safe = (project?.name || 'electrical').replace(/[\/\\:*?"<>|]/g, '_')
    const date = new Date().toISOString().split('T')[0]
    return `${safe}_electrical_${date}.pdf`
  }
  // Plan pages only render under the PDF tab — switch to it (and wait a frame
  // for mount) before capturing, mirroring Step 5.
  const buildPdf = async () => {
    if (activeTab !== 'pdf') { setActiveTab('pdf'); await new Promise(r => requestAnimationFrame(r)) }
    return pagesToPdf([page1Ref.current, page2Ref.current, page3Ref.current])
  }

  const handleDownload = async () => {
    setIsExporting(true)
    try {
      const bytes = await buildPdf(); if (!bytes) return
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = pdfFilename()
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch (e) { console.error('Electrical PDF failed', e) }
    finally { setIsExporting(false) }
  }

  const handleQuotation = async () => {
    if (!projectId) return
    setIsExporting(true); setBanner(null)
    try {
      const bytes = await buildPdf().catch(() => null)
      const res = await requestQuotation(projectId, bytes, bytes ? pdfFilename() : null, 'equipment')
      if (res?.quotationRequestedAt) { setQuotationRequestedAt(res.quotationRequestedAt); onQuotationRequested?.(res.quotationRequestedAt) }
      setBanner('success')
    } catch { setBanner('error') }
    finally { setIsExporting(false) }
  }

  // Publish handlers so the Final hub can trigger them while Step 9 is mounted
  // off-screen (no dep array — re-publish each render to capture latest state).
  useEffect(() => {
    if (!exportApiRef) return
    exportApiRef.current = {
      generatePdf: handleDownload,
      requestQuotation: handleQuotation,
      downloadEquipmentXlsx: () => downloadElectricalProposal(projectId, project?.name),
      isExporting, hasRequestedQuotation: !!quotationRequestedAt,
    }
    return () => { if (exportApiRef) exportApiRef.current = null }
  })

  const tabs: [string, string][] = isAdmin
    ? [['bom', t('step9.tab.bom')], ['pdf', t('step9.tab.pdf')]]
    : [['pdf', t('step9.tab.pdf')]]

  const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, borderBottom: `1px solid ${BORDER}` }
  const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.88rem', color: TEXT, borderBottom: `1px solid ${BORDER_FAINT}` }
  const hasRequested = !!quotationRequestedAt

  const pageProps = { project, projectId, panelType: panelTypeName || project?.panelType, panelWp: panelWatt, totalKw, count: realCount, date: new Date().toLocaleDateString(), owner }

  // Action cluster — Get Quotation (equipment) + Generate, styled like Step 5.
  const actions = (
    <>
      <button onClick={handleQuotation} disabled={!projectId || isExporting} title={t('step5.quotation.refundNotice')}
        style={{ padding: '0.35rem 1rem', background: hasRequested ? WHITE : PRIMARY, color: BLACK, border: `1.5px solid ${hasRequested ? BORDER : PRIMARY}`, borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, cursor: (projectId && !isExporting) ? 'pointer' : 'not-allowed', opacity: (projectId && !isExporting) ? 1 : 0.5, marginRight: '0.4rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        {isExporting ? t('step5.quotation.sending') : hasRequested ? t('step5.quotation.requestAgain') : t('step9.getQuotation')}
      </button>
      {!isAdmin ? (
        <button onClick={handleDownload} disabled={!projectId || isExporting || !hasStrings}
          style={{ padding: '0.35rem 1rem', background: PRIMARY, color: BLACK, border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, cursor: (projectId && !isExporting && hasStrings) ? 'pointer' : 'not-allowed', opacity: (projectId && !isExporting && hasStrings) ? 1 : 0.5 }}>
          ↓ {t('step9.downloadPdf')}
        </button>
      ) : (
        <div style={{ position: 'relative' }}>
          <button ref={generateRef} onClick={() => setMenuOpen(o => !o)} disabled={!projectId}
            style={{ padding: '0.35rem 1rem', background: PRIMARY, color: BLACK, border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, cursor: projectId ? 'pointer' : 'not-allowed', opacity: projectId ? 1 : 0.5 }}>
            ↓ {t('step5.btn.generate')} ▾
          </button>
          {menuOpen && (
            <div ref={menuRef} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.75rem', minWidth: 210, zIndex: 999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button onClick={async () => { setMenuOpen(false); try { await downloadElectricalProposal(projectId, project?.name) } catch (e) { console.error(e); alert('Failed to generate equipment proposal') } }}
                style={{ padding: '0.35rem 0.75rem', background: SUCCESS_DARK, color: WHITE, border: 'none', borderRadius: 5, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>↓ {t('step9.menu.equipmentXlsx')}</button>
              <button onClick={() => { setMenuOpen(false); handleDownload() }} disabled={!hasStrings}
                style={{ padding: '0.35rem 0.75rem', background: PRIMARY_DARK, color: WHITE, border: 'none', borderRadius: 5, fontSize: '0.78rem', fontWeight: 700, cursor: hasStrings ? 'pointer' : 'not-allowed', opacity: hasStrings ? 1 : 0.5, textAlign: 'left' }}>↓ {t('step9.menu.diagramsPdf')}</button>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar (with action cluster, like Step 5) */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: `2px solid ${BORDER_FAINT}`, background: BG_LIGHT, padding: '0 1rem', gap: '0.25rem', flexShrink: 0 }}>
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key as any)}
            style={{ padding: '0.55rem 1rem', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              background: activeTab === key ? 'white' : 'transparent', color: activeTab === key ? TEXT : TEXT_PLACEHOLDER,
              borderBottom: activeTab === key ? `2px solid ${PRIMARY}` : '2px solid transparent', marginBottom: '-2px' }}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {!hideActions && banner && (
          <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.25rem 0.55rem', borderRadius: 6, marginRight: '0.4rem',
            background: banner === 'success' ? SUCCESS_BG : ERROR_BG, color: banner === 'success' ? SUCCESS : ERROR_DARK }}>
            {banner === 'success' ? t('step5.quotation.success') : t('step5.quotation.failed')}
          </span>
        )}
        {!hideActions && actions}
      </div>

      {/* BOM tab (admin) */}
      {isAdmin && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: BG_FAINT, padding: '2rem', display: activeTab === 'bom' ? 'block' : 'none' }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: TEXT }}>{t('step9.title')}</div>
                <div style={{ fontSize: '0.88rem', color: TEXT_SECONDARY, marginTop: '0.3rem' }}>{t('step9.subtitle')}</div>
              </div>
              <button onClick={handleRecalc} disabled={loading}
                style={{ padding: '0.5rem 1rem', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 6, color: PRIMARY_DARK, fontWeight: 600, fontSize: '0.85rem', cursor: loading ? 'wait' : 'pointer' }}>
                {t('step9.recalc')}
              </button>
            </div>
            <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_MUTED }}>…</div>
              ) : items.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_MUTED, fontSize: '0.9rem' }}>{t('step9.empty')}</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: PRIMARY_BG }}>
                    <tr>
                      <th style={th}>{t('step9.col.item')}</th>
                      <th style={th}>{t('step9.col.section')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{t('step9.col.qty')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{t('step9.col.price')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={`${it.element}-${i}`}>
                        <td style={td}>
                          {it.name || it.element}
                          {sadotUrlFor(it.sadotUrl) && (
                            <a href={sadotUrlFor(it.sadotUrl)!} target="_blank" rel="noreferrer" style={{ marginInlineStart: 8, fontSize: '0.75rem' }}>↗</a>
                          )}
                        </td>
                        <td style={{ ...td, color: TEXT_SECONDARY }}>{it.section || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{it.qty}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{it.priceIls != null ? Number(it.priceIls).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF tab (all) — full-width pages stacked vertically, fit to width */}
      <div style={{ flex: 1, minHeight: 0, display: activeTab === 'pdf' ? 'block' : 'none', background: BG_FAINT }}>
        {!hasStrings ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>{t('step9.noDiagrams')}</div>
        ) : (
          <div ref={pdfScrollRef} style={{ height: '100%', overflow: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <ScaledPage scale={pageScale}>
              <CadPage {...pageProps} pageRef={page1Ref} pageName={t('step7.tab.diagram')}>
                <div style={{ width: '100%', height: '100%' }}>
                  <StringCanvas panels={panels} strings={strings} units={units} ports={ports} layout={inverterLayout}
                    showMpptLines printMode />
                </div>
              </CadPage>
            </ScaledPage>
            <ScaledPage scale={pageScale}>
              <CadPage {...pageProps} pageRef={page2Ref} pageName={t('step7.tab.sld')}>
                <SldTab units={units} strings={strings} panelWatt={panelWatt} printMode />
              </CadPage>
            </ScaledPage>
            <ScaledPage scale={pageScale}>
              <CadPage {...pageProps} pageRef={page3Ref} pageName={t('step7.tab.distribution')}>
                <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                  <SummaryTab units={units} strings={strings} panelWatt={panelWatt} />
                </div>
              </CadPage>
            </ScaledPage>
          </div>
        )}
      </div>
    </div>
  )
}
