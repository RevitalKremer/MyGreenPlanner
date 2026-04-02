import { CadPage } from '../Step4PdfReport'
import DetailView from '../step3/DetailView'

// CadPage content area dimensions (A4 landscape, scale 3.2 px/mm, frame 8mm, footer 26mm)
const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

// Compute the natural size of a DetailView (printMode) for given geometry.
// Mirrors the padT formula in DetailView so the fitZoom is accurate.
function computeNaturalSize(rc, settings, lineRails, panelLines) {
  const SC = 2.2
  const railOffsetCm   = lineRails?.[0]?.[0] ?? 0
  const blockHeightCm  = settings.blockHeightCm
  const panelLengthCm  = settings.panelLengthCm
  const baseOverhangCm = settings.baseOverhangCm
  const { heightRear, heightFront, baseLength, angle } = rc

  const angleRad = angle * Math.PI / 180
  const bW       = baseLength    * SC
  const OHx      = baseOverhangCm * Math.cos(angleRad) * SC
  const hR       = heightRear    * SC
  const hF       = heightFront   * SC
  const railOffH = railOffsetCm  * Math.cos(angleRad) * SC
  const blockH   = blockHeightCm * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + seg.gapBeforeCm + seg.depthCm, 0)

  const padL = Math.max(120, railOffH + OHx + 40)
  const panelExtCm = (totalPanelDepthCm - railOffsetCm) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx) + 70)

  const _panelOffsetApprox = 2 * SC + 10 + 3
  const _slopeAbove = bW > 0 ? (hR - hF) * railOffH / bW : 0
  const _annotAbove = Math.cos(angleRad) * (_panelOffsetApprox + 30)
  const padT = Math.max(55, hR - hF + _slopeAbove + _annotAbove + 40)
  const padB = blockH + 290

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  // DetailView (printMode) wraps the SVG in a div with padding + header
  // padding: 1rem 1.5rem = 16px top/bottom, 24px left/right; header ≈ 27px
  return { w: svgW + 48, h: svgH + 59 }
}

export default function TrapDetailPage({
  trapId, rc, settings = {}, lineRails = null, panelLines = null,
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  if (!rc) return null

  const { w: naturalW, h: naturalH } = computeNaturalSize(rc, settings, lineRails, panelLines)
  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  return (
    <CadPage
      pageRef={pageRef}
      pageName={trapId}
      project={project}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      panelCount={null}
      date={date}
    >
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute',
          top: (CONTENT_H - naturalH * fitZoom) / 2,
          left: (CONTENT_W - naturalW * fitZoom) / 2,
          width: naturalW,
          height: naturalH,
          transform: `scale(${fitZoom})`,
          transformOrigin: 'top left',
        }}>
          <DetailView
            rc={rc}
            trapId={trapId}
            panelLines={panelLines}
            settings={settings}
            lineRails={lineRails}
            printMode
          />
        </div>
      </div>
    </CadPage>
  )
}
