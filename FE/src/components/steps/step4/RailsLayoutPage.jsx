import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import RailLayoutTab from '../step3/RailLayoutTab'
import { getPanelsBoundingBox } from '../step3/tabUtils'

const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

// Must match PM_PAD and MAX_W inside RailLayoutTab's printMode path
const PM_PAD = 24, MAX_W = 900

export default function RailsLayoutPage({
  panels = [], refinedArea,
  trapSettingsMap = {}, trapLineRailsMap = {},
  beRailsData = null,
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  const { t } = useLang()
  const { naturalW, naturalH } = useMemo(() => {
    if (!panels.length) return { naturalW: MAX_W + PM_PAD * 2, naturalH: 200 }
    const bbox = getPanelsBoundingBox(panels)
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? MAX_W / bboxW : 1
    return { naturalW: MAX_W + PM_PAD * 2, naturalH: bboxH * sc + PM_PAD * 2 }
  }, [panels])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step4.pdf.rails')}
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
          <RailLayoutTab
            panels={panels}
            refinedArea={refinedArea}
            trapSettingsMap={trapSettingsMap}
            trapLineRailsMap={trapLineRailsMap}
            beRailsData={beRailsData}
            printMode
          />
        </div>
      </div>
    </CadPage>
  )
}
