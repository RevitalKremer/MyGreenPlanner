import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step5PdfReport'
import AreasTab, { InstallMethodLegend } from '../step3/AreasTab'
import { getPanelsBoundingBox, computePrintFit } from '../step3/tabUtils'
import { ROOF_CONCRETE, ROOF_TILES, ROOF_FLAT_INSTALLATION, ROOF_CORRUGATED } from '../../../styles/colors'
import { resolveAreaRoofType } from '../../../utils/roofSpecUtils'

const ROOF_COLOR_MAP = {
  concrete: ROOF_CONCRETE,
  tiles: ROOF_TILES,
  flat_installation: ROOF_FLAT_INSTALLATION,
  iskurit: ROOF_CORRUGATED,
  insulated_panel: ROOF_CORRUGATED,
}

const CONTENT_W = (297 - 2 * 8) * 3.2
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2

const PAD = 12

export default function InstallMethodPage({
  panels = [], uploadedImageData, imageSrc,
  roofType = 'concrete',
  areas = [],
  project, projectId, panelType, panelWp, totalKw, date, pageRef, user,
}) {
  const { t } = useLang()
  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const { panelBbox, naturalW, naturalH, sc } = useMemo(() => {
    if (!nonEmptyPanels.length) return { panelBbox: null, naturalW: CONTENT_W, naturalH: 200, sc: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    const fit = computePrintFit(panelBbox.maxX - panelBbox.minX, panelBbox.maxY - panelBbox.minY, CONTENT_W, CONTENT_H, PAD)
    return { panelBbox, ...fit }
  }, [nonEmptyPanels])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step5.pdf.installMethod')}
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
            areas={areas}
            uploadedImageData={uploadedImageData}
            imageSrc={imageSrc}
            roofType={roofType}
            printMode
            printSc={sc}
            printBbox={panelBbox}
            printShowAreas={false}
            printShowCounts={false}
            printShowInstallMethod
          />
        </div>
        {(() => {
          if (roofType === 'mixed') {
            const seen = new Set()
            const entries = []
            for (const a of (areas || [])) {
              const typ = resolveAreaRoofType(roofType, a)
              if (seen.has(typ)) continue
              seen.add(typ)
              entries.push({ type: typ, color: ROOF_COLOR_MAP[typ] ?? ROOF_CONCRETE })
            }
            return <InstallMethodLegend entries={entries} t={t} />
          }
          return <InstallMethodLegend roofType={roofType} roofColor={ROOF_COLOR_MAP[roofType] ?? ROOF_CONCRETE} t={t} />
        })()}
      </div>
    </CadPage>
  )
}
