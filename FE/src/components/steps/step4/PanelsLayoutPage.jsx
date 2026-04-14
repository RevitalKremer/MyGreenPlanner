import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import AreasTab from '../step3/AreasTab'
import { getPanelsBoundingBox, computePrintFit } from '../step3/tabUtils'

const PAD = 12  // print mode — minimal padding
const CONTENT_W = (297 - 2 * 8) * 3.2
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2

export default function PanelsLayoutPage({ panels = [], uploadedImageData, imageSrc, project, panelType, panelWp, totalKw, date, pageRef, user }) {
  const { t } = useLang()
  const { naturalW, naturalH, sc } = useMemo(() => {
    const nonEmpty = panels.filter(p => !p.isEmpty)
    if (!nonEmpty.length) return { naturalW: CONTENT_W, naturalH: 200, sc: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmpty)

    // If image exists, expand bbox to include full image dimensions
    let bbox = panelBbox
    if (uploadedImageData) {
      const imgW = uploadedImageData.width || 3000
      const imgH = uploadedImageData.height || 2000
      bbox = {
        minX: Math.min(panelBbox.minX, 0),
        maxX: Math.max(panelBbox.maxX, imgW),
        minY: Math.min(panelBbox.minY, 0),
        maxY: Math.max(panelBbox.maxY, imgH)
      }
    }

    return computePrintFit(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, CONTENT_W, CONTENT_H, PAD)
  }, [panels, uploadedImageData])

  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={t('step4.pdf.panels')}
      project={project}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      panelCount={panels.filter(p => !p.isEmpty).length}
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
            printMode
            printSc={sc}
            printShowAreas={false}
            printShowCounts
          />
        </div>
      </div>
    </CadPage>
  )
}
