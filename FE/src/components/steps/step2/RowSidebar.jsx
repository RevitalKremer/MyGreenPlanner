import { useState, useEffect, useMemo } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_LIGHT, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER } from '../../../styles/colors'
// BLUE_BG, BLUE_BORDER kept for trapezoid badge (shared config indicator)
import TrapezoidConfigEditor from './TrapezoidConfigEditor'

export default function RowSidebar({
  panels,
  selectedPanels, setSelectedPanels, setTrapIdOverride,
  rows, areaGroups, areaLabel, getAreaKey, onMergeRowIntoArea,
  onGroupSelectedRowsIntoArea,
  onDetachRowToNewArea,
  areaTrapezoidMap, sharedTrapIds, trapezoidConfigs,
  rectAreas = [],
  setRectAreas,
  panelTypes = [],
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
  selectedRow,
  selectedTrapezoidId,
  trapIdOverride,         // truthy only when user explicitly clicked a trap
  selectedAreaLabel,
  refinedArea,
  resetTrapezoidConfig,
  panelGapCm,
  lineGapCm,
  showMounting = true,
  angleMin,
  angleMax,
  frontHeightMin,
  frontHeightMax,
  roofType = 'concrete',
  rowMounting = {},
  setRowMounting,
}) {
  const { t } = useLang()
  const [collapsed, setCollapsed] = useState(false)

  // Normalize areaGroups: prefer the prop; fall back to building from rows.
  // Used by both the dropdown and the rendered area card.
  const normalizedGroups = useMemo(() => {
    if (areaGroups && areaGroups.length > 0) return areaGroups
    return rows.map((row, i) => ({
      groupId: getAreaKey(row[0]),
      label: rectAreas[getAreaKey(row[0])]?.label,
      rows: [{ rowIdx: i, row, areaIdx: getAreaKey(row[0]), panelRowIndex: 0 }],
      areaIndices: [getAreaKey(row[0])],
    }))
  }, [areaGroups, rows, rectAreas, getAreaKey])

  // Currently displayed area in the sidebar. One area at a time; user can
  // switch via dropdown, and selecting a panel/row outside the current area
  // auto-switches to its area (canvas click → follow selection).
  const [displayedAreaId, setDisplayedAreaId] = useState(null)

  // Select the first row of a group (panels + trap-mode off).
  const selectFirstRow = (group) => {
    const firstRow = group?.rows?.[0]
    if (!firstRow) return
    setSelectedPanels(firstRow.row.map(p => p.id))
    setTrapIdOverride(null)
  }

  // Handler used by dropdown: switch displayed area AND auto-select its first row.
  const pickArea = (groupId) => {
    setDisplayedAreaId(groupId)
    const group = normalizedGroups.find(g => g.groupId === groupId)
    selectFirstRow(group)
  }

  // Default to the first area on mount / when groups appear — auto-select its first row.
  useEffect(() => {
    if (displayedAreaId == null && normalizedGroups.length > 0) {
      setDisplayedAreaId(normalizedGroups[0].groupId)
      // Only select first row if nothing is already selected (avoid clobbering
      // an initial selection from elsewhere).
      if (selectedPanels.length === 0) selectFirstRow(normalizedGroups[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedGroups, displayedAreaId])

  // Auto-switch the displayed area when a panel from another area gets selected
  // (e.g. user clicked a panel on the canvas). Deliberately NOT listening to
  // displayedAreaId — otherwise picking an area from the dropdown would
  // immediately snap back to the currently-selected panel's area.
  useEffect(() => {
    if (selectedPanels.length === 0) return
    const firstId = selectedPanels[0]
    const found = normalizedGroups.find(g => g.rows.some(r => r.row.some(p => p.id === firstId)))
    if (found) setDisplayedAreaId(prev => (prev === found.groupId ? prev : found.groupId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPanels])

  const displayedGroup = normalizedGroups.find(g => g.groupId === displayedAreaId) ?? normalizedGroups[0]

  // Analyse the current selection — tells us whether to show:
  //   · "Group N rows into one area"  (selection spans ≥ 2 area groups)
  //   · "Split row into its own area" (single row selected inside a
  //     multi-row area, i.e. 1 row from 1 group whose parent group has ≥ 2 rows)
  const selectionInfo = useMemo(() => {
    if (!selectedPanels || selectedPanels.length === 0) return null
    const selSet = new Set(selectedPanels)
    const rowKeys = new Set()   // "areaGroupId|rowIndex"
    const groupIds = new Set()
    const areaIdxs = new Set()  // rectArea indices
    for (const p of (panels || [])) {
      if (p.isEmpty || !selSet.has(p.id)) continue
      const areaIdx = p.area ?? p.row ?? 0
      const ra = rectAreas[areaIdx]
      const gid = ra?.areaGroupId ?? areaIdx
      const ri = p.panelRowIdx ?? 0
      rowKeys.add(`${gid}|${ri}`)
      groupIds.add(gid)
      areaIdxs.add(areaIdx)
    }
    const rowCount = rowKeys.size
    const groupCount = groupIds.size
    if (groupCount === 0) return null
    // Split-eligibility: exactly one rectArea selected, and that area's group
    // currently has ≥ 2 rows (so splitting it off is meaningful).
    let canSplit = false
    if (areaIdxs.size === 1 && rowCount === 1) {
      const onlyIdx = [...areaIdxs][0]
      const gid = rectAreas[onlyIdx]?.areaGroupId
      const siblings = rectAreas.filter(a => a?.areaGroupId === gid).length
      if (siblings >= 2) canSplit = true
    }
    return {
      rowCount, groupCount, canSplit,
      canGroup: groupCount >= 2,
    }
  }, [selectedPanels, panels, rectAreas])

  // "Apply to all rows" — write current default a/h to every row of every area
  // and to area defaults (so newly added rows pick them up too).
  const applyDefaultsToAll = () => {
    const fh = panelFrontHeight ?? ''
    const ang = panelAngle ?? ''
    setRectAreas?.(prev => prev.map(a => ({ ...a, frontHeight: fh, angle: ang })))
    if (setRowMounting) {
      const fhNum = parseFloat(fh)
      const angNum = parseFloat(ang)
      setRowMounting(prev => {
        const next = {}
        Object.entries(prev || {}).forEach(([label, rows]) => {
          next[label] = (rows || []).map(r => ({
            angleDeg: isNaN(angNum) ? r?.angleDeg : angNum,
            frontHeightCm: isNaN(fhNum) ? r?.frontHeightCm : fhNum,
          }))
        })
        return next
      })
    }
  }

  // Update a specific row's a/h. Used by the inline row-level editor.
  const updateRowMounting = (label, rowIdx, patch) => {
    if (!setRowMounting) return
    setRowMounting(prev => {
      const next = { ...(prev || {}) }
      const rows = [...(next[label] || [])]
      rows[rowIdx] = { ...(rows[rowIdx] || {}), ...patch }
      next[label] = rows
      return next
    })
  }

  return (
    <div style={{
      position: 'absolute', top: '20px', right: '20px',
      width: collapsed ? '32px' : '255px', minHeight: '36px',
      overflowX: 'hidden', overflowY: collapsed ? 'hidden' : 'auto',
      maxHeight: 'calc(100% - 40px)',
      padding: '1.25rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: `2px solid ${PRIMARY}`,
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_FAINT, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && <>
      <h3 style={{ margin: '0 0 1rem 0', color: TEXT_SECONDARY, fontSize: '1rem', fontWeight: '700' }}>
        {t('step2.sidebar.title')}
      </h3>

      {/* Panel type selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          {t('step2.sidebar.panelType')}
        </div>
        <select
          value={panelType ?? ''}
          onChange={e => setPanelType?.(e.target.value)}
          style={{ width: '100%', padding: '0.35rem 0.5rem', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '6px', fontSize: '0.82rem', color: TEXT_DARK, background: 'white', cursor: 'pointer' }}
        >
          {panelTypes.map(t => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.kw}W ({t.lengthCm}×{t.widthCm} cm)
            </option>
          ))}
        </select>
      </div>

      {/* Default mounting settings (visibility controlled by DB roof_types) */}
      {showMounting && (
        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.7rem 0.5rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BORDER_FAINT}` }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            {t('step2.sidebar.defaultMounting')}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.angle')}</div>
              <input
                type="number" min={angleMin} max={angleMax} step="1"
                value={panelAngle ?? ''}
                onChange={e => setPanelAngle?.(e.target.value)}
                onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanelAngle?.(String(Math.min(angleMax, Math.max(angleMin, v)))) }}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder={`${angleMin}–${angleMax}`}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.frontH')}</div>
              <input
                type="number" min={frontHeightMin} max={frontHeightMax} step="1"
                value={panelFrontHeight ?? ''}
                onChange={e => setPanelFrontHeight?.(e.target.value)}
                onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanelFrontHeight?.(String(Math.min(frontHeightMax, Math.max(frontHeightMin, v)))) }}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder={`${frontHeightMin}–${frontHeightMax}`}
              />
            </div>
          </div>
          {rectAreas.length > 0 && (
            <button
              onClick={applyDefaultsToAll}
              style={{ width: '100%', padding: '0.28rem 0', background: 'white', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '600', color: TEXT_DARK }}
            >
              {t('step2.sidebar.applyToAll')}
            </button>
          )}
        </div>
      )}

      {panels.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: TEXT_MUTED, margin: '0 0 0.5rem', lineHeight: 1.4 }}>
          {t('step2.sidebar.drawHint')}
        </p>
      )}

      {/* Selection action banner —
          · spans ≥ 2 areas → "Group into one area"
          · single row inside a multi-row area → "Split into its own area" */}
      {selectionInfo?.canGroup && onGroupSelectedRowsIntoArea && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.6rem', background: PRIMARY_BG_LIGHT, border: `2px solid ${PRIMARY}`, borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: TEXT_DARK, marginBottom: '0.35rem', lineHeight: 1.35 }}>
            {selectionInfo.rowCount} rows selected across {selectionInfo.groupCount} areas
          </div>
          <button
            onClick={() => onGroupSelectedRowsIntoArea()}
            style={{ width: '100%', padding: '0.35rem 0', background: PRIMARY, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}
          >
            Group into one area
          </button>
        </div>
      )}
      {selectionInfo?.canSplit && onDetachRowToNewArea && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.6rem', background: PRIMARY_BG_LIGHT, border: `2px solid ${PRIMARY}`, borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: TEXT_DARK, marginBottom: '0.35rem', lineHeight: 1.35 }}>
            Selected row is part of a multi-row area
          </div>
          <button
            onClick={() => onDetachRowToNewArea()}
            style={{ width: '100%', padding: '0.35rem 0', background: PRIMARY, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}
          >
            Split into its own area
          </button>
        </div>
      )}

      {/* State: panels placed */}
      {panels.length > 0 && (
        <>

          {/* Area selector + single area card */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                {t('step2.sidebar.areas')} ({normalizedGroups.length})
              </div>
              {normalizedGroups.length > 1 && (
                <select
                  value={displayedAreaId ?? ''}
                  onChange={e => {
                    const n = Number(e.target.value)
                    pickArea(Number.isNaN(n) ? e.target.value : n)
                  }}
                  style={{ flex: 1, padding: '0.2rem 0.3rem', fontSize: '0.7rem', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', color: TEXT_DARK, background: 'white', cursor: 'pointer' }}
                >
                  {normalizedGroups.map(g => {
                    const tCount = [...new Set(g.areaIndices.flatMap(ai => areaTrapezoidMap[ai] || []))].length
                    const pCount = g.rows.flatMap(r => r.row).length
                    return (
                      <option key={g.groupId} value={g.groupId}>
                        {g.label} — {pCount}p, {g.rows.length}r, {tCount}t
                      </option>
                    )
                  })}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {(displayedGroup ? [displayedGroup] : []).map((group) => {
                const isMultiRow = group.rows.length > 1
                const allGroupPanels = group.rows.flatMap(r => r.row)
                const isGroupSelected = allGroupPanels.some(p => selectedPanels.includes(p.id))
                const firstAreaKey = group.areaIndices[0]
                const trapIds = [...new Set(group.areaIndices.flatMap(ai => areaTrapezoidMap[ai] || []))]
                const totalPanels = allGroupPanels.length

                return (
                  <div key={group.groupId}>
                    <div style={{
                      padding: '0.4rem 0.5rem 0.35rem 0.6rem',
                      background: isGroupSelected ? PRIMARY_BG_LIGHT : BG_LIGHT,
                      border: `2px solid ${isGroupSelected ? PRIMARY : 'transparent'}`,
                      borderRadius: '8px',
                      transition: 'all 0.12s',
                    }}>
                      {/* Top row: dot + name + panel count */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span
                          onClick={() => { setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: isGroupSelected ? PRIMARY : BORDER_MID, cursor: 'pointer' }}
                        />
                        <input
                          value={rectAreas[firstAreaKey]?.label ?? areaLabel(firstAreaKey, 0)}
                          onChange={e => {
                            const newLabel = e.target.value
                            setRectAreas?.(prev => prev.map(a =>
                              a.areaGroupId === group.groupId ? { ...a, label: newLabel } : a
                            ))
                          }}
                          onClick={ev => { ev.stopPropagation(); setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.82rem', fontWeight: '600', color: TEXT_DARK, background: 'transparent', border: 'none', borderBottom: isGroupSelected ? `1px solid ${PRIMARY}` : '1px solid transparent', outline: 'none', padding: '0', minWidth: 0, flex: 1, cursor: 'text' }}
                        />
                        <span
                          onClick={() => { setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.72rem', color: TEXT_LIGHT, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}
                        >
                          {isMultiRow && `${group.rows.length}r `}{totalPanels}p
                        </span>
                      </div>

                      {/* Rows section — always shown, even for single-row areas */}
                      <div style={{ marginTop: '0.35rem', paddingLeft: '13px' }}>
                        <div style={{ fontSize: '0.58rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>
                          Rows ({group.rows.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                          {group.rows.map((r, ri) => {
                            // Row is "selected" only when its panels are selected AND no trap
                            // was explicitly picked. Using trapIdOverride (not the derived
                            // selectedTrapezoidId, which falls back to the first panel's trap).
                            const isSubSelected = r.row.some(p => selectedPanels.includes(p.id)) && !trapIdOverride
                            const groupLabel = rectAreas[firstAreaKey]?.label
                            const rowEntry = (rowMounting?.[groupLabel] || [])[ri] || {}
                            const aDefault = parseFloat(panelAngle) || 0
                            const fhDefault = parseFloat(panelFrontHeight) || 0
                            const rowAng = rowEntry.angleDeg ?? aDefault
                            const rowFh = rowEntry.frontHeightCm ?? fhDefault
                            return (
                              <div
                                key={ri}
                                onClick={() => { setSelectedPanels(r.row.map(p => p.id)); setTrapIdOverride(null) }}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', padding: '0.15rem 0.3rem', borderRadius: '4px', background: isSubSelected ? PRIMARY_BG_ALT : 'transparent' }}
                              >
                                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: isSubSelected ? PRIMARY : BORDER_LIGHT, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.68rem', color: isSubSelected ? TEXT_DARK : TEXT_VERY_LIGHT, flex: 1 }}>
                                  Row {ri + 1} — {r.row.length}p
                                </span>
                                {showMounting && (
                                  <span style={{ fontSize: '0.6rem', color: TEXT_PLACEHOLDER, whiteSpace: 'nowrap' }}>
                                    {rowAng.toFixed(0)}° · {rowFh.toFixed(0)}cm
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Traps section — always shown, even for single-trap areas */}
                      {trapIds.length > 0 && (
                        <div style={{ marginTop: '0.35rem', paddingLeft: '13px' }}>
                          <div style={{ fontSize: '0.58rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>
                            Traps ({trapIds.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                            {trapIds.map(trapId => {
                              const trapPanels = panels.filter(p => group.areaIndices.includes(p.area ?? p.row) && p.trapezoidId === trapId)
                              // Trap is "selected" only when user explicitly clicked it
                              // (trapIdOverride set). Prevents highlighting the first-panel's
                              // trap as selected after a plain row click.
                              const isTrapItemSelected = trapIdOverride === trapId
                              const isShared = sharedTrapIds.has(trapId)
                              return (
                                <div
                                  key={trapId}
                                  onClick={() => { setSelectedPanels(trapPanels.map(p => p.id)); setTrapIdOverride(trapId) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', padding: '0.15rem 0.3rem', borderRadius: '4px', background: isTrapItemSelected ? PRIMARY_BG_ALT : 'transparent' }}
                                >
                                  <span
                                    title={isShared ? 'Shared config — changes affect all areas using this trapezoid' : trapId}
                                    style={{
                                      fontSize: '0.6rem', fontWeight: '700',
                                      padding: '1px 5px', borderRadius: '8px',
                                      background: isShared ? BLUE_BG : BG_MID,
                                      color: isShared ? BLUE : TEXT_PLACEHOLDER,
                                      border: isShared ? `1px solid ${BLUE_BORDER}` : '1px solid transparent',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {trapId}{isShared && ' ⇄'}
                                  </span>
                                  <span style={{ fontSize: '0.68rem', color: isTrapItemSelected ? TEXT_DARK : TEXT_VERY_LIGHT, marginLeft: 'auto' }}>{trapPanels.length}p</span>
                                  {!!trapezoidConfigs?.[trapId] && (
                                    <span title={t('step2.sidebar.customConfig')} style={{ width: '5px', height: '5px', borderRadius: '50%', background: PRIMARY, flexShrink: 0 }} />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* "Add to Area..." merge — single-row areas only; row-level a/h means
                          different-mounting merges are now safe. */}
                      {!isMultiRow && isGroupSelected && (() => {
                        const allGroups = areaGroups || []
                        const compatibleTargets = allGroups.filter(g => g.groupId !== group.groupId)
                        if (compatibleTargets.length === 0) return null
                        return (
                          <div style={{ marginTop: '0.3rem', paddingLeft: '13px' }}>
                            <select
                              defaultValue=""
                              onChange={e => {
                                if (e.target.value) {
                                  const n = Number(e.target.value)
                                  onMergeRowIntoArea?.(firstAreaKey, Number.isNaN(n) ? e.target.value : n)
                                  e.target.value = ''
                                }
                              }}
                              style={{ width: '100%', padding: '0.2rem 0.3rem', fontSize: '0.68rem', border: `1px solid ${BORDER}`, borderRadius: '4px', color: TEXT_SECONDARY, cursor: 'pointer', background: 'white' }}
                            >
                              <option value="" disabled>{t('step2.sidebar.addToArea')}</option>
                              {compatibleTargets.map(g => (
                                <option key={g.groupId} value={g.groupId}>
                                  {g.label} ({g.rows.flatMap(r => r.row).length}p)
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </>
      )}

      {/* Detail window — one of two views based on selection */}
      {selectedRow && roofType !== 'tiles' && (() => {
        const areaKey = getAreaKey(selectedRow[0])
        const area = areaKey !== null ? (rectAreas?.[areaKey] ?? null) : null
        const groupLabel = area?.label
        const rowIdx = selectedRow[0]?.panelRowIdx ?? area?.rowIndex ?? 0
        const rowEntry = (rowMounting?.[groupLabel] || [])[rowIdx] || {}
        const aDefault = parseFloat(panelAngle) || 0
        const fhDefault = parseFloat(panelFrontHeight) || 0
        const rowAng = rowEntry.angleDeg ?? aDefault
        const rowFh = rowEntry.frontHeightCm ?? fhDefault
        const isTrapView = !!trapIdOverride

        return (
          <div style={{ marginTop: '0.75rem', borderTop: `1px solid ${BORDER_FAINT}`, paddingTop: '0.75rem' }}>
            {/* ROW window — editable a/h */}
            {!isTrapView && showMounting && groupLabel && setRowMounting && (
              <div style={{ padding: '0.6rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BG_MID}` }}>
                <div style={{ fontSize: '0.72rem', fontWeight: '700', color: PRIMARY_DARK, marginBottom: '0.5rem' }}>
                  Row {rowIdx + 1} — {groupLabel}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.angle')}</div>
                    <input
                      type="number" min={angleMin} max={angleMax} step="0.5"
                      value={rowAng}
                      onChange={e => updateRowMounting(groupLabel, rowIdx, { angleDeg: parseFloat(e.target.value) || 0 })}
                      onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateRowMounting(groupLabel, rowIdx, { angleDeg: Math.min(angleMax, Math.max(angleMin, v)) }) }}
                      style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.frontH')}</div>
                    <input
                      type="number" min={frontHeightMin} max={frontHeightMax} step="0.5"
                      value={rowFh}
                      onChange={e => updateRowMounting(groupLabel, rowIdx, { frontHeightCm: parseFloat(e.target.value) || 0 })}
                      onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateRowMounting(groupLabel, rowIdx, { frontHeightCm: Math.min(frontHeightMax, Math.max(frontHeightMin, v)) }) }}
                      style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TRAP window — preview + read-only a/h + lineOrientations */}
            {isTrapView && (
              <TrapezoidConfigEditor
                selectedRow={selectedRow}
                selectedTrapezoidId={selectedTrapezoidId}
                selectedAreaLabel={selectedAreaLabel}
                refinedArea={refinedArea}
                trapezoidConfigs={trapezoidConfigs}
                getAreaKey={getAreaKey}
                resetTrapezoidConfig={resetTrapezoidConfig}
                panelFrontHeight={panelFrontHeight}
                panelAngle={panelAngle}
                rectAreas={rectAreas}
                setRectAreas={setRectAreas}
                panelGapCm={panelGapCm}
                lineGapCm={lineGapCm}
                showMounting={showMounting}
                angleMin={angleMin}
                angleMax={angleMax}
                frontHeightMin={frontHeightMin}
                frontHeightMax={frontHeightMax}
                panelSpec={panelTypes.find(t => t.id === panelType) ?? panelTypes[0]}
                rowMounting={rowMounting}
                setRowMounting={setRowMounting}
              />
            )}
          </div>
        )
      })()}
      </>}
    </div>
  )
}
