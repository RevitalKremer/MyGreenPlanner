/**
 * Per-trap base-beam extension variants.
 *
 * Each `ComputedTrapezoid.geometry.extensions: TrapExtension[]` holds the
 * trap's extension variants:
 *  - Index 0 is the trap's BE-default extension (zero for concrete and
 *    parallel-purlin roofs; the iskurit / insulated_panel perpendicular
 *    default for those roofs).
 *  - Indices 1..N are user-created alternatives, appended in change order;
 *    never reordered, never re-indexed.
 *
 * Bases identify their variation directly through `Base.trapezoidId`:
 *  - `"A1"`    → parent A1, default extension (index 0)
 *  - `"A1.N"`  → variation N of A1 (index N)
 *
 * This module owns the parser / resolver / lookup helpers used by drag
 * handlers (FE preview) and mirrored in the BE post-process.
 */

export type TrapExtension = {
  frontExtMm: number
  backExtMm: number
}

export type ExtensionsMap = Record<string, TrapExtension[]>

const EPS = 0.001

/**
 * Split a base's trapezoidId into (parentTrapId, extensionIdx).
 *
 *  parseVariationTrapId("A1")    → { parentTrapId: "A1",   extensionIdx: 0 }
 *  parseVariationTrapId("A1.2")  → { parentTrapId: "A1",   extensionIdx: 2 }
 *  parseVariationTrapId("A1.X")  → { parentTrapId: "A1.X", extensionIdx: 0 }  (non-digit suffix kept as part of parent)
 */
export function parseVariationTrapId(trapezoidId: string): { parentTrapId: string; extensionIdx: number } {
  if (!trapezoidId || !trapezoidId.includes('.')) {
    return { parentTrapId: trapezoidId, extensionIdx: 0 }
  }
  const dot = trapezoidId.lastIndexOf('.')
  const parent = trapezoidId.slice(0, dot)
  const suffix = trapezoidId.slice(dot + 1)
  if (!/^\d+$/.test(suffix)) {
    return { parentTrapId: trapezoidId, extensionIdx: 0 }
  }
  return { parentTrapId: parent, extensionIdx: Number(suffix) }
}

/** Display label for a base's variation (round-trip with the trapezoidId). */
export function variationLabel(parentTrapId: string, extensionIdx: number): string {
  return extensionIdx > 0 ? `${parentTrapId}.${extensionIdx}` : parentTrapId
}

/**
 * Resolve `(frontExtMm, backExtMm)` against a trap's current extensions list.
 * Exact-match (within EPS) → returns existing index, unchanged list.
 * No match → returns a new list with the entry appended and the new tail index.
 */
export function resolveOrAppendExtension(
  map: ExtensionsMap,
  parentTrapId: string,
  ext: TrapExtension,
): { map: ExtensionsMap; extensionIdx: number } {
  const list = map[parentTrapId] ?? [{ frontExtMm: 0, backExtMm: 0 }]
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (Math.abs(e.frontExtMm - ext.frontExtMm) < EPS &&
        Math.abs(e.backExtMm  - ext.backExtMm)  < EPS) {
      return { map, extensionIdx: i }
    }
  }
  const next = { ...map, [parentTrapId]: [...list, { frontExtMm: ext.frontExtMm, backExtMm: ext.backExtMm }] }
  return { map: next, extensionIdx: next[parentTrapId].length - 1 }
}

/** Safe lookup with `{0, 0}` fallback when the trap or index isn't found. */
export function getExtension(
  map: ExtensionsMap,
  parentTrapId: string,
  extensionIdx: number,
): TrapExtension {
  const list = map[parentTrapId]
  if (!list) return { frontExtMm: 0, backExtMm: 0 }
  return list[extensionIdx] ?? { frontExtMm: 0, backExtMm: 0 }
}

/** Convenience: resolve a base's extension directly from its trapezoidId. */
export function getExtensionForBase(
  map: ExtensionsMap,
  baseTrapezoidId: string,
): TrapExtension {
  const { parentTrapId, extensionIdx } = parseVariationTrapId(baseTrapezoidId)
  return getExtension(map, parentTrapId, extensionIdx)
}
