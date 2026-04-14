import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import AreasTab, { InstallMethodLegend } from '../step3/AreasTab'
import { getPanelsBoundingBox, expandBboxForImage, computePrintFit } from '../step3/tabUtils'
import { ROOF_CONCRETE, ROOF_TILES, ROOF_CORRUGATED } from '../../../styles/colors'

const ROOF_COLOR_MAP = {
  concrete: ROOF_CONCRETE,
  tiles: ROOF_TILES,
  iskurit: ROOF_CORRUGATED,
  insulated_panel: ROOF_CORRUGATED,
}

const CONTENT_W = (297 - 2 * 8) * 3.2
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2

const PAD = 12

export default function InstallMethodPage({
  panels = [], uploadedImageData, imageSrc,
  roofType = 'concrete',
  project, projectId, panelType, panelWp, totalKw, date, pageRef, user,
}) {
  const { t } = useLang()
  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const { naturalW, naturalH, sc } = useMemo(() => {
    if (!nonEmptyPanels.length) return { naturalW: CONTENT_W, naturalH: 200, sc: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    const bbox = expandBboxForImage(panelBbox, uploadedImageData)
    return computePrintFit(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, CONTENT_W, CONTENT_H, PAD)
  }, [nonEmptyPanels, uploadedImageData])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step4.pdf.installMethod')}
      project={project}
      projectId={projectId}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      count={nonEmptyPanels.length}
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
          <AreasTab
            panels={panels}
            uploadedImageData={uploadedImageData}
            imageSrc={imageSrc}
            roofType={roofType}
            printMode
            printSc={sc}
            printShowAreas={false}
            printShowCounts={false}
            printShowInstallMethod
          />
        </div>
        <InstallMethodLegend roofType={roofType} roofColor={ROOF_COLOR_MAP[roofType] ?? ROOF_CONCRETE} t={t} />
      </div>
    </CadPage>
  )
}
