import { useMemo, useCallback } from 'react'
import { CadPage } from '../Step4PdfReport'
import AreasTab from '../step3/AreasTab'
import { getPanelsBoundingBox, buildRowGroups } from '../step3/tabUtils'

const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

// Must match PAD and MAX_W inside AreasTab
const PAD = 40, MAX_W = 900

export default function AreasLayoutPage({
  panels = [], areas = {},
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const rowKeys = useMemo(() => buildRowGroups(nonEmptyPanels).keys, [nonEmptyPanels])

  const areaLabel = useCallback((areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }, [areas])

  const { naturalW, naturalH } = useMemo(() => {
    if (!nonEmptyPanels.length) return { naturalW: MAX_W + PAD * 2, naturalH: 200 }
    const bbox = getPanelsBoundingBox(nonEmptyPanels)
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? MAX_W / bboxW : 1
    return { naturalW: MAX_W + PAD * 2, naturalH: bboxH * sc + PAD * 2 }
  }, [nonEmptyPanels])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName="Areas"
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
            printMode
            printShowCounts={false}
          />
        </div>
      </div>
    </CadPage>
  )
}
