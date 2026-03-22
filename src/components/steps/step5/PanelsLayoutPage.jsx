import { useMemo } from 'react'
import { CadPage } from '../Step5PdfReport'
import HatchedPanels from '../step4/HatchedPanels'
import { getPanelsBoundingBox } from '../step4/tabUtils'

export default function PanelsLayoutPage({ panels = [], refinedArea, project, panelType, panelWp, totalKw, date, pageRef }) {
  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1

  const { sc, svgW, svgH, toSvg } = useMemo(() => {
    if (!panels.length) return { sc: 1, svgW: 100, svgH: 100, toSvg: () => [0, 0] }
    const bbox = getPanelsBoundingBox(panels)
    const PAD  = 40
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? 850 / bboxW : 1
    return {
      sc,
      svgW: bboxW * sc + PAD * 2,
      svgH: bboxH * sc + PAD * 2,
      toSvg: (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc],
    }
  }, [panels])

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
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%" height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <HatchedPanels
          panels={panels}
          selectedTrapId={null}
          toSvg={toSvg}
          sc={sc}
          pixelToCmRatio={pixelToCmRatio}
          clipIdPrefix="pdf-panels"
        />
      </svg>
    </CadPage>
  )
}
