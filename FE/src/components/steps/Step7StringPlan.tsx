import { useState, useEffect, useMemo } from 'react'
import { useLang } from '../../i18n/LangContext'
import { generateStrings, validateStrings } from '../../services/projectsApi'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED, TEXT_VERY_LIGHT,
  BORDER, BORDER_FAINT, BG_FAINT, BG_LIGHT,
  SUCCESS_BG, SUCCESS_DARK,
  ERROR_DARK, ERROR_BG, WARNING_DARK, WARNING_BG,
  STRING_PALETTE,
} from '../../styles/colors'

const stringColor = (i: number) => STRING_PALETTE[i % STRING_PALETTE.length]

// Lightweight read-only SVG: draws placed panels colored by their string group.
function StringCanvas({ panels, colorByPanelId }) {
  const real = (panels || []).filter((p: any) => !p.isEmpty)
  const bounds = useMemo(() => {
    if (!real.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of real) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.width); maxY = Math.max(maxY, p.y + p.height)
    }
    const pad = (maxX - minX) * 0.03 || 10
    return { minX: minX - pad, minY: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [real])

  if (!bounds) return <div style={{ color: TEXT_MUTED, padding: '2rem', textAlign: 'center' }}>—</div>
  return (
    <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      {real.map((p: any) => {
        const cx = p.x + p.width / 2, cy = p.y + p.height / 2
        const fill = colorByPanelId[p.id] || TEXT_VERY_LIGHT
        return (
          <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}>
            <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={fill} fillOpacity={0.78} stroke="white" strokeWidth={Math.max(1, p.width * 0.02)} />
          </g>
        )
      })}
    </svg>
  )
}

// Step 7 — auto-generate per-area strings, validate against inverter limits,
// and visualize string groups by color. v1: no manual per-panel reassignment.
export default function Step7StringPlan({ projectId, panels, strings, onStringsChange }) {
  const { t } = useLang()
  const [issues, setIssues] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  // Validate any pre-existing strings on mount so the panel reflects state.
  useEffect(() => {
    if (projectId && (strings || []).length) {
      validateStrings(projectId, strings).then(r => setIssues(r.issues || [])).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const colorByPanelId = useMemo(() => {
    const map: Record<number, string> = {}
    ;(strings || []).forEach((s: any, i: number) => {
      const c = stringColor(i)
      ;(s.panelIds || []).forEach((pid: number) => { map[pid] = c })
    })
    return map
  }, [strings])

  const handleGenerate = async () => {
    if (!projectId) return
    setBusy(true)
    try {
      const res = await generateStrings(projectId)
      onStringsChange(res.strings || [])
      setIssues(res.issues || [])
      setSummary(res.summary || null)
    } catch { /* surfaced via empty result */ }
    finally { setBusy(false) }
  }

  const issueText = (it: any) => {
    const params = { ...(it.params || {}) }
    if (Array.isArray(params.specs)) params.specs = params.specs.join(', ')
    return t(`step7.issue.${it.code}`, params)
  }
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const hasStrings = (strings || []).length > 0

  return (
    <div style={{ height: '100%', display: 'flex', background: BG_FAINT }}>
      {/* Canvas */}
      <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: TEXT }}>{t('step7.title')}</div>
        <div style={{ fontSize: '0.85rem', color: TEXT_SECONDARY, margin: '0.3rem 0 1rem' }}>{t('step7.subtitle')}</div>
        <div style={{ flex: 1, background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', minHeight: 0 }}>
          {hasStrings
            ? <StringCanvas panels={panels} colorByPanelId={colorByPanelId} />
            : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>{t('step7.noStrings')}</div>}
        </div>
      </div>

      {/* Sidebar */}
      <div style={{ width: 320, borderLeft: `1px solid ${BORDER_FAINT}`, background: 'white', padding: '1.5rem 1.25rem', overflowY: 'auto' }}>
        <button onClick={handleGenerate} disabled={busy || !projectId}
          style={{ width: '100%', padding: '0.7rem', background: busy ? BG_LIGHT : PRIMARY_DARK, color: busy ? TEXT_MUTED : 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.95rem', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : (hasStrings ? t('step7.regenerate') : t('step7.generate'))}
        </button>

        {summary && (
          <div style={{ marginTop: '1rem', background: PRIMARY_BG, borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.82rem', color: PRIMARY_DARK }}>
            {t('step7.summary', { strings: summary.stringCount, sMin: summary.seriesMin ?? '—', sMax: summary.seriesMax ?? '—' })}
          </div>
        )}

        {hasStrings && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.5rem' }}>{t('step7.issuesHeading')}</div>
            {errors.length === 0 && warnings.length === 0 ? (
              <div style={{ background: SUCCESS_BG, color: SUCCESS_DARK, borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}>{t('step7.valid')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {errors.map((it, i) => (
                  <div key={`e${i}`} style={{ background: ERROR_BG, color: ERROR_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
                {warnings.map((it, i) => (
                  <div key={`w${i}`} style={{ background: WARNING_BG, color: WARNING_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasStrings && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.5rem' }}>{t('step7.legend')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(strings || []).map((s: any, i: number) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: TEXT }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: stringColor(i), flexShrink: 0 }} />
                  <span>{s.id} · {(s.panelIds || []).length}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
