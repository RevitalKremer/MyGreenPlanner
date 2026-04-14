import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import BasesPlanTab from '../step3/BasesPlanTab'
import { getPanelsBoundingBox, expandBboxForImage, computePrintFit } from '../step3/tabUtils'

const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

const PAD = 12  // print mode — minimal padding, edit bars are hidden

export default function BasesLayoutPage({
  panels = [], refinedArea, areas = [],
  uploadedImageData, imageSrc,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  beBasesData = null, beTrapezoidsData = null,
  project, panelType, panelWp, totalKw, date, pageRef, user,
}) {
  const { t } = useLang()
  const { naturalW, naturalH, sc } = useMemo(() => {
    // Match BasesPlanTab's bbox computation (uses non-empty panels)
    const nonEmpty = panels.filter(p => !p.isEmpty)
    if (!nonEmpty.length) return { naturalW: CONTENT_W, naturalH: 200, sc: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmpty)
    const bbox = expandBboxForImage(panelBbox, uploadedImageData)
    return computePrintFit(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, CONTENT_W, CONTENT_H, PAD)
  }, [panels, uploadedImageData])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step4.pdf.bases')}
      project={project}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      count={panels.length}
      date={date}
      user={user}
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
            areas={areas}
            uploadedImageData={uploadedImageData}
            imageSrc={imageSrc}
            trapSettingsMap={trapSettingsMap}
            trapLineRailsMap={trapLineRailsMap}
            trapRCMap={trapRCMap}
            customBasesMap={customBasesMap}
            beBasesData={beBasesData}
            beTrapezoidsData={beTrapezoidsData}
            printMode
            printSc={sc}
          />
        </div>
      </div>
    </CadPage>
  )
}
