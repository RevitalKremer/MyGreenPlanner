import { useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { CadPage } from '../Step4PdfReport'
import AreasTab from '../step3/AreasTab'
import { getPanelsBoundingBox } from '../step3/tabUtils'

const PAD = 40, MAX_W = 900
const CONTENT_W = (297 - 2 * 8) * 3.2
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2

export default function PanelsLayoutPage({ panels = [], project, panelType, panelWp, totalKw, date, pageRef }) {
  const { t } = useLang()
  const { naturalW, naturalH } = useMemo(() => {
    const nonEmpty = panels.filter(p => !p.isEmpty)
    if (!nonEmpty.length) return { naturalW: MAX_W + PAD * 2, naturalH: 200 }
    const bbox = getPanelsBoundingBox(nonEmpty)
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc    = bboxW > 0 ? MAX_W / bboxW : 1
    return { naturalW: MAX_W + PAD * 2, naturalH: bboxH * sc + PAD * 2 }
  }, [panels])

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
            printMode
            printShowAreas={false}
            printShowCounts
          />
        </div>
      </div>
    </CadPage>
  )
}
