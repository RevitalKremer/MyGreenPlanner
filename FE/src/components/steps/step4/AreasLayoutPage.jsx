import { useMemo, useCallback } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import AreasTab from '../step3/AreasTab'
import { getPanelsBoundingBox, expandBboxForImage, buildRowGroups } from '../step3/tabUtils'

const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

// Must match PAD and MAX_W inside AreasTab
const PAD = 40, MAX_W = 900

export default function AreasLayoutPage({
  panels = [], areas = {},
  uploadedImageData, imageSrc,
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  const { t } = useLang()
  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const rowKeys = useMemo(() => buildRowGroups(nonEmptyPanels).keys, [nonEmptyPanels])

  // Map areaGroupKey → areas entry (handles multi-row where rowKeys are rectArea indices)
  const areaByGroupKey = useMemo(() => {
    const map = {}
    const areaByLabel = {}
    for (const a of (Array.isArray(areas) ? areas : [])) { if (a.label) areaByLabel[a.label] = a }
    const seen = new Set()
    for (const p of nonEmptyPanels) {
      const gk = p.areaGroupKey ?? p.area ?? 0
      if (seen.has(gk)) continue
      seen.add(gk)
      const tid = p.trapezoidId
      const matched = (Array.isArray(areas) ? areas : []).find(a => a.trapezoidIds?.includes(tid))
        ?? areaByLabel[tid?.replace(/\d+$/, '')]
      if (matched) map[gk] = matched
    }
    return map
  }, [nonEmptyPanels, areas])

  const areaLabel = useCallback((areaKey, i) => {
    const g = areaByGroupKey[areaKey]?.label ?? (Array.isArray(areas) ? areas[areaKey] : undefined)?.label
    return g ? `${g}` : t('step4.pdf.area', { n: i + 1 })
  }, [areas, areaByGroupKey, t])

  const { naturalW, naturalH } = useMemo(() => {
    if (!nonEmptyPanels.length) return { naturalW: MAX_W + PAD * 2, naturalH: 200 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    const bbox = expandBboxForImage(panelBbox, uploadedImageData)
    
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? MAX_W / bboxW : 1
    return { naturalW: MAX_W + PAD * 2, naturalH: bboxH * sc + PAD * 2 }
  }, [nonEmptyPanels, uploadedImageData])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step4.pdf.areas')}
      project={project}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      panelCount={panels.length}
      date={date}
    >
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          position: 'absolute',
          top: (CONTENT_H - naturalH * fitZoom) / 2,
          left: (CONTENT_W - naturalW * fitZoom) / 2,
          width: naturalW, height: naturalH,
          transform: `scale(${fitZoom})`,
          transformOrigin: 'top left',
        }}>
          <AreasTab
            panels={panels}
            areas={areas}
            rowKeys={rowKeys}
            areaLabel={areaLabel}
            uploadedImageData={uploadedImageData}
            imageSrc={imageSrc}
            printMode
            printShowCounts={false}
          />
        </div>
      </div>
    </CadPage>
  )
}
