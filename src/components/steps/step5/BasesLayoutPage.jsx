import { useMemo } from 'react'
import { CadPage } from '../Step5PdfReport'
import BasesPlanTab from '../step4/BasesPlanTab'
import { getPanelsBoundingBox } from '../step4/tabUtils'

const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

const PAD = 60, MAX_W = 900

export default function BasesLayoutPage({
  panels = [], refinedArea,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  const { naturalW, naturalH } = useMemo(() => {
    if (!panels.length) return { naturalW: MAX_W + PAD * 2, naturalH: 200 }
    const bbox = getPanelsBoundingBox(panels)
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? MAX_W / bboxW : 1
    return { naturalW: MAX_W + PAD * 2, naturalH: bboxH * sc + PAD * 2 }
  }, [panels])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
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
          <BasesPlanTab
            panels={panels}
            refinedArea={refinedArea}
            trapSettingsMap={trapSettingsMap}
            trapLineRailsMap={trapLineRailsMap}
            trapRCMap={trapRCMap}
            customBasesMap={customBasesMap}
            printMode
          />
        </div>
      </div>
    </CadPage>
  )
}
