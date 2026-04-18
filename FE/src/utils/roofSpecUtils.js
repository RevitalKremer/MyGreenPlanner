/**
 * Shared roof-spec resolution helpers.
 *
 * Central source of truth for resolving a specific area's effective roof type
 * across the codebase. For non-mixed projects the project-level type applies
 * to every area. For mixed projects each area carries its own roofSpec.
 */

/**
 * Resolve the effective roof type string for one area.
 *
 * @param {string} projectRoofType - project.roofSpec.type ('concrete'|'tiles'|'iskurit'|'insulated_panel'|'mixed')
 * @param {object} [areaOrSpec]    - step2 area object (has .roofSpec) OR a roofSpec dict directly
 * @returns {string} e.g. 'concrete', 'tiles', 'iskurit', 'insulated_panel'
 */
export function resolveAreaRoofType(projectRoofType, areaOrSpec) {
  const prt = projectRoofType || 'concrete'
  if (prt !== 'mixed') return prt
  // Mixed: read the area's own spec (or default to concrete).
  const spec = areaOrSpec?.roofSpec ?? areaOrSpec
  return spec?.type || 'concrete'
}

/**
 * Resolve the full roof spec dict for one area (type + purlin params).
 *
 * @param {string} projectRoofType
 * @param {object} [area] - step2 area object (has .roofSpec with type/distanceBetweenPurlinsCm/installationOrientation)
 * @returns {{ type: string, purlinDistCm: number, installationOrientation: string|null }}
 */
export function resolveAreaRoofSpec(projectRoofType, area) {
  const type = resolveAreaRoofType(projectRoofType, area)
  if (projectRoofType !== 'mixed') {
    return { type, purlinDistCm: 0, installationOrientation: null }
  }
  const rs = area?.roofSpec || {}
  return {
    type,
    purlinDistCm: rs.distanceBetweenPurlinsCm || 0,
    installationOrientation: rs.installationOrientation || null,
  }
}

/**
 * Check whether a specific area is tiles-typed.
 *
 * @param {string} projectRoofType
 * @param {object} [area]
 * @returns {boolean}
 */
export function isAreaTiles(projectRoofType, area) {
  return resolveAreaRoofType(projectRoofType, area) === 'tiles'
}

/**
 * Check whether ALL areas in the project are tiles-typed.
 * When true, construction-frame tabs (bases, detail) can be hidden.
 *
 * @param {string} projectRoofType
 * @param {object[]} areas - step2 areas array
 * @returns {boolean}
 */
export function allAreasTiles(projectRoofType, areas) {
  if (!areas || areas.length === 0) return projectRoofType === 'tiles'
  return areas.every(a => isAreaTiles(projectRoofType, a))
}
