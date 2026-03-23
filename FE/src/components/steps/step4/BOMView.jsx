import { useMemo, useState } from 'react'
import {
  TEXT, TEXT_SECONDARY, TEXT_DARKEST, TEXT_MUTED,
  TEXT_LIGHT, TEXT_FAINT, TEXT_PLACEHOLDER,
  BG_FAINT, BG_MID, BORDER_FAINT, BORDER,
  PRIMARY, PRIMARY_DARK, PRIMARY_BG,
  AMBER, AMBER_BG, AMBER_BORDER, AMBER_DARK,
  ADD_GREEN, ADD_GREEN_BG,
  DANGER, WHITE, BLACK, WHITE_10, WHITE_50,
  SECTION_HEADER_BG,
} from '../../../styles/colors'
import { buildBOM } from '../../../utils/constructionCalculator'
import { PRODUCT_DICT, productByType } from '../../../data/productDict'

const ALL_ELEMENTS = PRODUCT_DICT.map(p => p.type)

function deltaKey(areaLabel, element) { return `${areaLabel}||${element}` }

function defaultExtras(element, qty) {
  return Math.ceil(qty * (productByType[element]?.extraPct ?? 0) / 100)
}

// ── Inline editable number ──────────────────────────────────────────────────
function EditNum({ value, disabled, onCommit, dim = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')

  function start() { if (!disabled) { setDraft(String(value)); setEditing(true) } }
  function commit() {
    const v = parseInt(draft, 10)
    if (!isNaN(v) && v >= 0) onCommit(v)
    setEditing(false)
  }
  function cancel() { setEditing(false) }

  if (editing) return (
    <input autoFocus type="number" value={draft} min={0}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
      style={{ width: '3.6rem', textAlign: 'right', fontSize: '0.85rem', fontWeight: '700',
        padding: '0.15rem 0.3rem', border: `2px solid ${AMBER}`, borderRadius: '4px', outline: 'none', background: AMBER_BG }} />
  )

  return (
    <span onClick={start} title={disabled ? undefined : 'Click to edit'}
      style={{ fontWeight: '700', fontSize: '0.92rem',
        color: disabled ? TEXT_FAINT : dim ? TEXT_MUTED : TEXT_DARKEST,
        textDecoration: disabled ? 'line-through' : 'none',
        cursor: disabled ? 'default' : 'text',
        borderBottom: disabled ? 'none' : `1.5px dashed ${BORDER}`,
        padding: '1px 3px', borderRadius: '2px',
      }}>
      {value}
    </span>
  )
}

// ── Total badge ─────────────────────────────────────────────────────────────
function TotalBadge({ value, removed }) {
  if (removed) return (
    <span style={{ fontWeight: '700', color: TEXT_FAINT, textDecoration: 'line-through', fontSize: '0.88rem' }}>{value}</span>
  )
  return (
    <span style={{
      display: 'inline-block', minWidth: '2.6rem', textAlign: 'center',
      background: PRIMARY, color: BLACK, fontWeight: '800', fontSize: '0.82rem',
      padding: '2px 8px', borderRadius: '12px', letterSpacing: '0.02em',
    }}>{value}</span>
  )
}

// ── Sortable column header ───────────────────────────────────────────────────
function SortTh({ label, colKey, sortKey, sortDir, onSort, style = {} }) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      style={{
        padding: '0.5rem 0.8rem', fontWeight: '700', color: active ? PRIMARY_DARK : TEXT_SECONDARY,
        fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        background: active ? PRIMARY_BG : SECTION_HEADER_BG,
        ...style,
      }}
    >
      {label}
      <span style={{ marginLeft: '4px', opacity: active ? 1 : 0.3, fontSize: '0.65rem' }}>
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </th>
  )
}

// ───────────────────────────────────────────────────────────────────────────
export default function BOMView({ rowConstructions, rowLabels = [], bomDeltas = {}, onBomDeltasChange }) {
  const baseRows = useMemo(() => buildBOM(rowConstructions, rowLabels), [rowConstructions, rowLabels])
  const areaLabels = useMemo(() => [...new Set(baseRows.map(r => r.areaLabel))], [baseRows])

  // ── Filter / sort state ─────────────────────────────────────────────────
  const [filterArea,   setFilterArea]   = useState('')
  const [filterText,   setFilterText]   = useState('')
  const [showRemoved,  setShowRemoved]  = useState(true)
  const [sortKey,      setSortKey]      = useState('area')
  const [sortDir,      setSortDir]      = useState('asc')

  function handleSort(col) {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
  }

  // ── Add-row state ────────────────────────────────────────────────────────
  const [addArea, setAddArea]       = useState('')
  const [addElement, setAddElement] = useState('')
  const [addQty, setAddQty]         = useState('')

  const overrides   = bomDeltas.overrides ?? {}
  const additions   = bomDeltas.additions ?? []
  const hasAnyDelta = Object.keys(overrides).length > 0 || additions.length > 0

  function patch(next) { onBomDeltasChange?.({ overrides, additions, ...next }) }

  function setOverrideField(key, field, value) {
    const base = overrides[key] ?? {}
    patch({ overrides: { ...overrides, [key]: { ...base, [field]: value } } })
  }
  function toggleRemoved(key) {
    const base = overrides[key] ?? {}
    patch({ overrides: { ...overrides, [key]: { ...base, removed: !base.removed } } })
  }
  function restoreRow(key) {
    const next = { ...overrides }; delete next[key]; patch({ overrides: next })
  }
  function handleAddRow() {
    const qty = parseInt(addQty, 10)
    if (!addArea || !addElement || isNaN(qty) || qty <= 0) return
    patch({ additions: [...additions, { id: `add_${Date.now()}`, areaLabel: addArea, element: addElement, qty, extras: defaultExtras(addElement, qty) }] })
    setAddElement(''); setAddQty('')
  }
  function removeAddition(id) { patch({ additions: additions.filter(a => a.id !== id) }) }
  function setAdditionField(id, field, value) {
    patch({ additions: additions.map(a => a.id === id ? { ...a, [field]: value } : a) })
  }
  function resetToDefaults() { onBomDeltasChange?.({}) }

  // ── Build display rows ──────────────────────────────────────────────────
  const displayRows = useMemo(() => {
    const result = baseRows.map(row => {
      const key    = deltaKey(row.areaLabel, row.element)
      const ov     = overrides[key]
      const qty    = ov?.qty    != null ? ov.qty    : row.qty
      const extras = ov?.extras != null ? ov.extras : defaultExtras(row.element, qty)
      return { ...row, key, isAdded: false, removed: ov?.removed ?? false,
        modified: ov != null, qty, extras, total: qty + extras, baseQty: row.qty }
    })
    additions.forEach(add => {
      const extras = add.extras ?? 0
      result.push({ areaLabel: add.areaLabel, element: add.element, qty: add.qty, extras,
        total: add.qty + extras, totalLengthM: null, key: add.id, isAdded: true,
        removed: false, modified: false, baseQty: null, addId: add.id })
    })
    return result
  }, [baseRows, overrides, additions])

  // ── Filter + sort ────────────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    let rows = displayRows

    if (!showRemoved)
      rows = rows.filter(r => !r.removed)

    if (filterArea)
      rows = rows.filter(r => r.areaLabel === filterArea)

    if (filterText) {
      const q = filterText.toLowerCase()
      rows = rows.filter(r => {
        const product = productByType[r.element]
        return (
          r.areaLabel.toLowerCase().includes(q) ||
          r.element.toLowerCase().includes(q) ||
          (product?.name ?? '').toLowerCase().includes(q) ||
          (product?.pn  ?? '').toLowerCase().includes(q)
        )
      })
    }

    const dir = sortDir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'area':    return dir * a.areaLabel.localeCompare(b.areaLabel)
        case 'element': {
          const na = productByType[a.element]?.name ?? a.element
          const nb = productByType[b.element]?.name ?? b.element
          return dir * na.localeCompare(nb)
        }
        case 'length':  return dir * ((a.totalLengthM ?? -1) - (b.totalLengthM ?? -1))
        case 'qty':     return dir * (a.qty    - b.qty)
        case 'extras':  return dir * (a.extras - b.extras)
        case 'total':   return dir * (a.total  - b.total)
        default:        return 0
      }
    })

    return rows
  }, [displayRows, showRemoved, filterArea, filterText, sortKey, sortDir])

  // ── Totals (over unfiltered+unremoved rows for summary, filtered for footer) ─
  const totalAngleM = useMemo(() =>
    displayRows.filter(r => !r.removed && (r.element === 'angle_profile_40x40' || r.element === 'angle_profile_40x40_diag'))
      .reduce((s, r) => s + (r.totalLengthM ?? 0), 0)
  , [displayRows])

  const grandTotal = useMemo(() =>
    displayRows.filter(r => !r.removed).reduce((s, r) => s + r.total, 0)
  , [displayRows])

  const totalItems = displayRows.filter(r => !r.removed).length

  const thStyle = { textAlign: 'left' }
  const thRight = { textAlign: 'right' }
  const thCenter = { textAlign: 'center' }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Summary header card ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: PRIMARY_DARK, borderRadius: '10px 10px 0 0', overflow: 'hidden',
      }}>
        <div style={{ flex: 1, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: '700', color: PRIMARY, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.2rem' }}>
            Bill of Materials
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: '800', color: WHITE, letterSpacing: '-0.01em' }}>
            {areaLabels.length} {areaLabels.length === 1 ? 'area' : 'areas'} · {totalItems} line items
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', borderLeft: `1px solid ${WHITE_10}` }}>
          <div style={{ padding: '0.8rem 1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.1rem', borderRight: `1px solid ${WHITE_10}` }}>
            <div style={{ fontSize: '0.6rem', color: WHITE_50, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Angle profile</div>
            <div style={{ fontSize: '1rem', fontWeight: '800', color: PRIMARY }}>{totalAngleM.toFixed(1)} m</div>
          </div>
          <div style={{ padding: '0.8rem 1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.1rem' }}>
            <div style={{ fontSize: '0.6rem', color: WHITE_50, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Total pieces</div>
            <div style={{ fontSize: '1rem', fontWeight: '800', color: PRIMARY }}>{grandTotal.toLocaleString()}</div>
          </div>
          {hasAnyDelta && (
            <div style={{ padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', borderLeft: `1px solid ${WHITE_10}` }}>
              <button onClick={resetToDefaults} style={{
                fontSize: '0.72rem', padding: '0.35rem 0.75rem', cursor: 'pointer',
                background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: '6px',
                color: AMBER_DARK, fontWeight: '700', whiteSpace: 'nowrap',
              }}>↺ Reset</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '0.6rem', alignItems: 'center',
        padding: '0.6rem 0.8rem',
        background: SECTION_HEADER_BG,
        borderLeft: `1px solid ${BORDER_FAINT}`, borderRight: `1px solid ${BORDER_FAINT}`,
      }}>
        <span style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Filter</span>
        <select
          value={filterArea}
          onChange={e => setFilterArea(e.target.value)}
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', border: `1px solid ${BORDER}`, borderRadius: '5px', background: WHITE, minWidth: '8rem' }}
        >
          <option value="">All areas</option>
          {areaLabels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          type="text"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Search element…"
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', border: `1px solid ${BORDER}`, borderRadius: '5px', background: WHITE, flex: 1, minWidth: '10rem' }}
        />
        {(filterArea || filterText) && (
          <button onClick={() => { setFilterArea(''); setFilterText('') }}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', cursor: 'pointer', background: 'none', border: `1px solid ${BORDER}`, borderRadius: '5px', color: TEXT_MUTED }}>
            ✕ Clear filter
          </button>
        )}
        {sortKey !== 'area' && (
          <button onClick={() => { setSortKey('area'); setSortDir('asc') }}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', cursor: 'pointer', background: 'none', border: `1px solid ${BORDER}`, borderRadius: '5px', color: TEXT_MUTED }}>
            ↺ Clear sort
          </button>
        )}
        <button
          onClick={() => setShowRemoved(v => !v)}
          style={{
            fontSize: '0.75rem', padding: '0.2rem 0.6rem', cursor: 'pointer', borderRadius: '5px',
            border: `1px solid ${showRemoved ? BORDER : AMBER_BORDER}`,
            background: showRemoved ? 'none' : AMBER_BG,
            color: showRemoved ? TEXT_MUTED : AMBER_DARK,
            fontWeight: showRemoved ? '400' : '600',
          }}
        >
          {showRemoved ? 'Hide removed' : 'Show removed'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: TEXT_PLACEHOLDER, flexShrink: 0 }}>
          {visibleRows.length} of {displayRows.length} rows
        </span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${BORDER_FAINT}`, borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
          <thead>
            <tr>
              <th style={{ background: SECTION_HEADER_BG, width: '2.5rem', padding: '0.5rem 0.6rem', color: TEXT_PLACEHOLDER, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>#</th>
              <SortTh label="Area"      colKey="area"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle }} />
              <SortTh label="Element"   colKey="element" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle }} />
              <SortTh label="Length (m)" colKey="length" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thRight, width: '5.5rem' }} />
              <SortTh label="Qty"       colKey="qty"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thRight, width: '4rem' }} />
              <SortTh label="Extras"    colKey="extras"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thRight, width: '4.5rem' }} />
              <SortTh label="Total"     colKey="total"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ ...thCenter, width: '5.5rem' }} />
              <th style={{ background: SECTION_HEADER_BG, width: '3.5rem' }} />
            </tr>
          </thead>
          <tbody>
            {(() => {
              let lineNum = 0
              return visibleRows.map((row, ri) => {
                if (!row.removed) lineNum++
                const displayNum = row.removed ? null : lineNum
              const product    = productByType[row.element]
              const rowBg      = row.isAdded  ? ADD_GREEN_BG
                               : row.removed  ? BG_MID
                               : row.modified ? AMBER_BG
                               : ri % 2 === 0 ? WHITE : BG_FAINT
              const leftAccent = row.isAdded  ? `3px solid ${ADD_GREEN}`
                               : row.removed  ? `3px solid ${BORDER}`
                               : row.modified ? `3px solid ${AMBER}`
                               : '3px solid transparent'
              return (
                <tr key={row.key} style={{
                  background: rowBg,
                  borderTop: `1px solid ${BORDER_FAINT}`,
                  borderLeft: leftAccent,
                }}>
                  {/* # */}
                  <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums',
                    color: TEXT_PLACEHOLDER }}>
                    {row.isAdded
                      ? <span style={{ fontSize: '0.6rem', background: ADD_GREEN, color: WHITE, borderRadius: '3px', padding: '1px 4px', fontWeight: '800' }}>+</span>
                      : displayNum ?? '—'}
                  </td>

                  {/* Area */}
                  <td style={{ padding: '0.5rem 0.8rem', color: row.removed ? TEXT_LIGHT : TEXT_MUTED,
                    fontWeight: '600', fontSize: '0.82rem',
                    textDecoration: row.removed ? 'line-through' : 'none' }}>
                    {row.areaLabel}
                  </td>

                  {/* Element */}
                  <td style={{ padding: '0.5rem 0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {row.isAdded && (
                        <span style={{ fontSize: '0.6rem', background: ADD_GREEN, color: WHITE, borderRadius: '4px', padding: '1px 5px', fontWeight: '800', flexShrink: 0 }}>NEW</span>
                      )}
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600',
                          color: row.removed ? TEXT_LIGHT : TEXT,
                          textDecoration: row.removed ? 'line-through' : 'none' }}>
                          {product?.name ?? row.element}
                        </div>
                        {product?.pn && (
                          <div style={{ fontFamily: 'monospace', fontSize: '0.72rem',
                            color: row.removed ? TEXT_FAINT : TEXT_MUTED, marginTop: '1px' }}>
                            P/N {product.pn}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Length */}
                  <td style={{ padding: '0.5rem 0.8rem', textAlign: 'right', color: TEXT_PLACEHOLDER, fontSize: '0.8rem' }}>
                    {row.totalLengthM != null ? row.totalLengthM.toFixed(2) : '—'}
                  </td>

                  {/* Qty */}
                  <td style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>
                    <EditNum value={row.qty} disabled={row.removed}
                      onCommit={v => row.isAdded ? setAdditionField(row.addId, 'qty', v) : setOverrideField(row.key, 'qty', v)} />
                  </td>

                  {/* Extras */}
                  <td style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>
                    <EditNum value={row.extras} disabled={row.removed} dim={row.extras === 0}
                      onCommit={v => row.isAdded ? setAdditionField(row.addId, 'extras', v) : setOverrideField(row.key, 'extras', v)} />
                  </td>

                  {/* Total */}
                  <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>
                    <TotalBadge value={row.total} removed={row.removed} />
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {row.isAdded ? (
                      <ActionBtn onClick={() => removeAddition(row.addId)} title="Delete row" color={DANGER}>✕</ActionBtn>
                    ) : (
                      <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                        <ActionBtn onClick={() => toggleRemoved(row.key)}
                          title={row.removed ? 'Restore' : 'Mark removed'}
                          color={row.removed ? ADD_GREEN : TEXT_LIGHT}>
                          {row.removed ? '↩' : '✕'}
                        </ActionBtn>
                        {overrides[row.key] && (
                          <ActionBtn onClick={() => restoreRow(row.key)} title="Reset to default" color={AMBER_DARK}>↺</ActionBtn>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })
            })()}

            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: TEXT_PLACEHOLDER, fontStyle: 'italic' }}>
                  No rows match the current filter.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: PRIMARY_BG, borderTop: `2px solid ${PRIMARY}` }}>
              <td colSpan={3} style={{ padding: '0.55rem 0.8rem', color: PRIMARY_DARK, fontWeight: '700', fontSize: '0.82rem' }}>
                Total linear meters (angle profile)
              </td>
              <td style={{ padding: '0.55rem 0.8rem', textAlign: 'right', fontWeight: '800', color: PRIMARY_DARK, fontSize: '0.95rem' }}>
                {totalAngleM.toFixed(2)} m
              </td>
              <td /><td />
              <td style={{ padding: '0.55rem 0.8rem', textAlign: 'center' }}>
                <span style={{
                  display: 'inline-block', minWidth: '2.6rem', textAlign: 'center',
                  background: PRIMARY_DARK, color: WHITE, fontWeight: '800', fontSize: '0.82rem',
                  padding: '2px 8px', borderRadius: '12px',
                }}>{grandTotal.toLocaleString()}</span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Add row panel ───────────────────────────────────────────────── */}
      <div style={{
        marginTop: '1.25rem', border: `1.5px dashed ${ADD_GREEN}`,
        borderRadius: '10px', padding: '0.9rem 1.1rem', background: ADD_GREEN_BG,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: '800', color: WHITE,
            background: ADD_GREEN, borderRadius: '4px', padding: '2px 6px', letterSpacing: '0.06em' }}>+ ADD ROW</span>
          <span style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>Add a custom line item to the BOM</span>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Area">
            <select value={addArea} onChange={e => setAddArea(e.target.value)} style={selectStyle}>
              <option value="">— select area —</option>
              {areaLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Element">
            <select value={addElement} onChange={e => setAddElement(e.target.value)}
              style={{ ...selectStyle, minWidth: '16rem' }}>
              <option value="">— select element —</option>
              {ALL_ELEMENTS.map(el => (
                <option key={el} value={el}>{productByType[el]?.name ?? el}</option>
              ))}
            </select>
          </Field>
          <Field label="Qty">
            <input type="number" value={addQty} min={1} placeholder="0"
              onChange={e => setAddQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddRow() }}
              style={{ ...selectStyle, width: '4.5rem', textAlign: 'right' }} />
          </Field>
          <button onClick={handleAddRow} disabled={!addArea || !addElement || !addQty}
            style={{
              padding: '0.38rem 1.1rem', cursor: 'pointer', fontWeight: '800', fontSize: '0.82rem',
              background: (!addArea || !addElement || !addQty) ? BG_MID : ADD_GREEN,
              color: (!addArea || !addElement || !addQty) ? TEXT_MUTED : WHITE,
              border: 'none', borderRadius: '6px',
            }}>Add</button>
        </div>
      </div>

    </div>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────────
function ActionBtn({ onClick, title, color, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      color, fontSize: '0.8rem', padding: '2px 4px', borderRadius: '3px', lineHeight: 1,
    }}>{children}</button>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <label style={{ fontSize: '0.65rem', fontWeight: '700', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  )
}

const selectStyle = {
  fontSize: '0.82rem', padding: '0.32rem 0.5rem',
  border: `1px solid ${BORDER}`, borderRadius: '6px',
  background: WHITE, minWidth: '8rem',
}
