import { localToScreen } from '../../../utils/railLayoutService'

/**
 * Resolve area frame from areaData, trying areaId, areaLabel, and label as keys.
 * Returns context object or null if no frame found.
 */
export function resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap) {
  const areaId = areaData.areaId ?? areaData.areaLabel ?? areaData.label
  const af = areaFrames[areaId] ?? areaFrames[String(areaId)] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
  if (!af) return null
  const areaTrapIds = areaTrapsMap[areaId] ?? areaTrapsMap[String(areaId)] ?? areaTrapsMap[areaData.areaLabel] ?? []
  const fullTrapId = areaTrapIds.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTrapIds[0]
  const liveOffsets = customBasesMap[fullTrapId]
  return { af, areaId, areaTrapIds, fullTrapId, liveOffsets }
}

/**
 * Compute screen coordinates for a single base line.
 * Returns { btx, bty, bbx, bby, lx, la, offsetCm }.
 */
export function baseScreenCoords(sb, sbi, { af, liveOffsets, pixelToCmRatio, toSvg }) {
  const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
  const { angleRad: tAngle, localBounds: tLB } = tFrame
  const line = tLines?.find(l => l.lineIdx === sb.panelLineIdx) ?? tLines?.[0]
  const offsetCm = liveOffsets?.[sbi] != null ? liveOffsets[sbi] / 10 : sb.offsetFromStartCm
  const lx = tIsRtl ? tLB.maxX - offsetCm / pixelToCmRatio : tLB.minX + offsetCm / pixelToCmRatio
  const depthPx = sb.startCm / pixelToCmRatio
  const lenPx = sb.lengthCm / pixelToCmRatio
  const ty = tIsBtt ? (line?.maxY ?? tLB.maxY) - depthPx - lenPx : (line?.minY ?? tLB.minY) + depthPx
  const by = ty + lenPx
  const st = localToScreen({ x: lx, y: ty }, tFrame.center, tAngle)
  const sbo = localToScreen({ x: lx, y: by }, tFrame.center, tAngle)
  const [btx, bty] = toSvg(st.x, st.y)
  const [bbx, bby] = toSvg(sbo.x, sbo.y)
  const la = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
  return { btx, bty, bbx, bby, lx, la, offsetCm }
}
