import { CadPage } from '../Step5PdfReport'
import DetailView from '../step3/DetailView'

// CadPage content area dimensions (A4 landscape, scale 3.2 px/mm, frame 8mm, footer 26mm)
const CONTENT_W = (297 - 2 * 8) * 3.2   // ≈ 899 px
const CONTENT_H = (210 - 2 * 8 - 26) * 3.2  // ≈ 537 px

// Compute the natural size of a DetailView (printMode) for given geometry.
// Mirrors the padT formula in DetailView so the fitZoom is accurate.
// Mirror DetailView's layout math exactly, using BE geometry as source of truth.
function computeNaturalSize(settings, lineRails, panelLines, beDetailData) {
  const geom = beDetailData?.geometry
  if (!geom) return { w: 500, h: 400 }

  const SC = 2.2
  const railOffsetCm   = lineRails?.[0]?.[0] ?? lineRails?.['0']?.[0] ?? 0
  const panelLengthCm  = settings.panelLengthCm
  const baseOverhangCm = settings.baseOverhangCm
  const { heightRear, heightFront, baseLength, angle } = geom

  const angleRad = angle * Math.PI / 180
  const bW       = baseLength    * SC
  const OHx      = baseOverhangCm * Math.cos(angleRad) * SC
  const hR       = heightRear    * SC
  const hF       = heightFront   * SC
  const railOffH = railOffsetCm  * Math.cos(angleRad) * SC
  const blockH   = (geom.blockHeightCm ?? 0) * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + (seg.gapBeforeCm ?? 0) + (seg.depthCm ?? 0), 0)

  // Trap default extension lives at geometry.extensions[0]; see TrapezoidGeometry type.
  const defaultExt = geom.extensions?.[0] ?? { frontExtMm: 0, backExtMm: 0 }
  const defaultFrontExtCm = (defaultExt.frontExtMm ?? 0) / 10
  const defaultRearExtCm = (defaultExt.backExtMm ?? 0) / 10
  const rearExtPx = defaultRearExtCm * SC
  const padL = Math.max(120, railOffH + OHx + defaultFrontExtCm * SC + 40)
  const panelExtCm = (totalPanelDepthCm - railOffsetCm) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx, rearExtPx) + 70)

  const _panelOffsetApprox = 2 * SC + 10 + 3
  const _slopeAbove = bW > 0 ? (hR - hF) * railOffH / bW : 0
  const _annotAbove = Math.cos(angleRad) * (_panelOffsetApprox + 40)
  const padT = Math.max(55, hR - hF + _slopeAbove + _annotAbove + 30)
  const padB = blockH + 230

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  // DetailView (printMode) wraps the SVG in a div with padding + header
  // padding: 1rem 1.5rem = 16px top/bottom, 24px left/right; header ≈ 27px
  return { w: svgW + 48, h: svgH + 59 }
}

export default function TrapDetailPage({
  trapId, memberIds = null, rc, settings = {}, lineRails = null, panelLines = null,
  beDetailData = null, fullTrapGhost = null, count = null,
  project, projectId, panelType, panelWp, totalKw, date, pageRef, user,
}) {
  if (!rc) return null

  const { w: naturalW, h: naturalH } = computeNaturalSize(settings, lineRails, panelLines, beDetailData)
  const fitZoom = Math.min(CONTENT_W / naturalW, CONTENT_H / naturalH)

  // Group of structurally identical traps share one page — show every member's
  // ID in the title block so the reader knows the drawing applies to all of them.
  const pageName = memberIds && memberIds.length > 1 ? memberIds.join(', ') : trapId

  return (
    <CadPage
      pageRef={pageRef}
      pageName={pageName}
      project={project}
      projectId={projectId}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      count={count}
      date={date}
      user={user}
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
            twinIds={memberIds ? memberIds.filter(id => id !== trapId) : []}
            panelLines={panelLines}
            settings={settings}
            lineRails={lineRails}
            beDetailData={beDetailData}
            fullTrapGhost={fullTrapGhost}
            printMode
          />
        </div>
      </div>
    </CadPage>
  )
}
