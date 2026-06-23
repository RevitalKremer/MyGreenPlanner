import { mgpRequest } from './mgpApi'
import type { ProjectData, ProjectLayout } from '../types/projectData'

export async function listProjects({ limit = null, offset = 0, search = null }: { limit?: number | null; offset?: number; search?: string | null } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (offset > 0) params.set('offset', String(offset))
  if (search) params.set('search', search)
  const qs = params.toString()
  const url = qs ? `/projects?${qs}` : '/projects'
  const res = await mgpRequest(url)
  if (!res.ok) throw new Error('Failed to load projects')
  return res.json() // returns { projects, total, offset, limit, has_more }
}

export async function createProject(name, clientName, location, layout, data, roofSpec = null) {
  const res = await mgpRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      client_name: clientName,
      location: location || null,
      layout,
      data,
      ...(roofSpec ? { roof_spec: roofSpec } : {})
    }),
  })
  if (!res.ok) throw new Error('Failed to create project')
  return res.json()
}

export async function updateProject(id: string, payload: { name?: string; client_name?: string; location?: string | null; layout?: ProjectLayout; data?: ProjectData }, step: number | null = null) {
  const url = step != null ? `/projects/${id}?step=${step}` : `/projects/${id}`
  const res = await mgpRequest(url, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save project')
  return res.json()
}

export async function deleteProject(id) {
  const res = await mgpRequest(`/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete project')
}

export async function getProject(id) {
  const res = await mgpRequest(`/projects/${id}`)
  if (!res.ok) throw new Error('Project not found')
  return res.json()
}

// Project OWNER display details for the report title block (name/email/company).
export async function getProjectOwner(id: string): Promise<{ full_name: string | null; email: string | null; company_name: string | null }> {
  const res = await mgpRequest(`/projects/${id}/owner`)
  if (!res.ok) throw new Error('Failed to load project owner')
  return res.json()
}

export async function getConstructionData(id: string): Promise<{ data: ProjectData }> {
  const res = await mgpRequest(`/projects/${id}/construction-data`)
  if (!res.ok) throw new Error('Failed to fetch construction data')
  return res.json()
}

export async function saveTab(id, tabName, payload = null) {
  const res = await mgpRequest(`/projects/${id}/saveTab/${tabName}`, {
    method: 'PUT',
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  })
  if (!res.ok) throw new Error(`Failed to save tab ${tabName}`)
  return res.json()
}

export async function resetTab(id, tabName) {
  const res = await mgpRequest(`/projects/${id}/resetTab/${tabName}`, { method: 'PUT' })
  if (!res.ok) throw new Error(`Failed to reset tab ${tabName}`)
  return res.json()
}

// Error thrown when the BE rejects a step transition with a structured
// validation payload. The caller can read `.fromStep`, `.toStep`, and
// `.errors` to surface translated messages and highlight offending fields.
export class StepTransitionError extends Error {
  fromStep: number
  toStep: number
  errors: Array<{ code: string; field: string; params?: Record<string, any> }>
  constructor(fromStep: number, toStep: number, errors: any[]) {
    super(`step_transition_invalid (${fromStep}->${toStep})`)
    this.name = 'StepTransitionError'
    this.fromStep = fromStep
    this.toStep = toStep
    this.errors = errors || []
  }
}

export async function updateStep(id, newStep, skip = false) {
  const res = await mgpRequest(`/projects/${id}/step?new_step=${newStep}${skip ? '&skip=true' : ''}`, { method: 'PUT' })
  if (!res.ok) {
    let body: any = null
    try { body = await res.json() } catch {}
    const detail = body?.detail
    if (detail && typeof detail === 'object' && detail.code === 'step_transition_invalid') {
      throw new StepTransitionError(detail.fromStep, detail.toStep, detail.errors)
    }
    throw new Error('Failed to update step')
  }
  return res.json()
}

export async function approvePlan(id, strictConsent, step = 4) {
  const res = await mgpRequest(`/projects/${id}/approvePlan?strictConsent=${strictConsent}&step=${step}`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error('Failed to update plan approval')
  return res.json()
}

export async function fetchPanelTypes() {
  const res = await mgpRequest('/products/panel-types')
  if (!res.ok) throw new Error('Failed to load panel types')
  return res.json()
}

export async function fetchProducts() {
  const res = await mgpRequest('/products/materials')
  if (!res.ok) throw new Error('Failed to load products')
  return res.json()
}

export async function fetchAppDefaults() {
  const res = await mgpRequest('/settings/defaults')
  if (!res.ok) throw new Error('Failed to load app defaults')
  return res.json()
}

// ── BOM ─────────────────────────────────────────────────────────────────────

export async function getBOM(id, lang = null) {
  const url = lang ? `/projects/${id}/bom?lang=${lang}` : `/projects/${id}/bom`
  const res = await mgpRequest(url)
  if (!res.ok) throw new Error('BOM not yet computed')
  return res.json()
}

export async function computeBOM(id, lang = null) {
  const url = lang ? `/projects/${id}/bom/compute?lang=${lang}` : `/projects/${id}/bom/compute`
  const res = await mgpRequest(url, { method: 'PUT' })
  if (!res.ok) throw new Error('Failed to compute BOM')
  return res.json()
}

export async function recalcBOM(id, lang = null) {
  const url = lang ? `/projects/${id}/bom/recalc?lang=${lang}` : `/projects/${id}/bom/recalc`
  const res = await mgpRequest(url, { method: 'PUT' })
  if (!res.ok) throw new Error('Failed to recalc BOM')
  return res.json()
}

export async function saveBomDeltas(id, deltas) {
  const res = await mgpRequest(`/projects/${id}/bom/deltas`, {
    method: 'PUT',
    body: JSON.stringify(deltas),
  })
  if (!res.ok) throw new Error('Failed to save BOM deltas')
  return res.json()
}

// ── Electrical (Tier 2) ──────────────────────────────────────────────────────

export async function fetchSadotEquipment() {
  const res = await mgpRequest('/products/sadot-equipment')
  if (!res.ok) throw new Error('Failed to load Sadot equipment')
  return res.json()
}

export async function fetchElectricalRegulations() {
  const res = await mgpRequest('/electrical-regulations')
  if (!res.ok) throw new Error('Failed to load electrical regulations')
  return res.json()
}

export async function getInverterSuggestions(id: string, params: { regulationKey?: string | null; amperageA?: number | null; productCategory?: string | null } = {}) {
  const res = await mgpRequest(`/projects/${id}/electrical/inverter-suggestions`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Failed to load inverter suggestions')
  return res.json()
}

export async function generateStrings(id: string) {
  const res = await mgpRequest(`/projects/${id}/electrical/strings/generate`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to generate string plan')
  return res.json() // { strings, issues, summary }
}

export async function validateStrings(id: string, strings: any[]) {
  const res = await mgpRequest(`/projects/${id}/electrical/strings/validate`, {
    method: 'POST',
    body: JSON.stringify({ strings }),
  })
  if (!res.ok) throw new Error('Failed to validate string plan')
  return res.json() // { issues }
}

export async function computeElectricalBOM(id: string) {
  const res = await mgpRequest(`/projects/${id}/electrical-bom/compute`, { method: 'PUT' })
  if (!res.ok) throw new Error('Failed to compute electrical BOM')
  return res.json()
}

export async function recalcElectricalBOM(id: string) {
  const res = await mgpRequest(`/projects/${id}/electrical-bom/recalc`, { method: 'PUT' })
  if (!res.ok) throw new Error('Failed to recalc electrical BOM')
  return res.json()
}

export async function getElectricalBomEffective(id: string) {
  const res = await mgpRequest(`/projects/${id}/electrical-bom/effective`)
  if (!res.ok) throw new Error('Electrical BOM not yet computed')
  return res.json()
}

export async function saveElectricalBomDeltas(id: string, deltas: any) {
  const res = await mgpRequest(`/projects/${id}/electrical-bom/deltas`, {
    method: 'PUT',
    body: JSON.stringify(deltas),
  })
  if (!res.ok) throw new Error('Failed to save electrical BOM deltas')
  return res.json()
}

async function _downloadFromServer(path, suggestedFilename) {
  const res = await mgpRequest(path)
  if (!res.ok) throw new Error(`Failed to fetch ${path}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadProposal(id, projectName = 'proposal') {
  const safeName = String(projectName).replace(/[\/\\:*?"<>|]/g, '_')
  const date = new Date().toISOString().split('T')[0]
  await _downloadFromServer(`/projects/${id}/proposal.xlsx`, `${safeName}_proposal_${date}.xlsx`)
}

export async function downloadProduction(id, projectName = 'production') {
  // Admin-only: saw-cut + punch production instructions (Hebrew, regardless of lang).
  const safeName = String(projectName).replace(/[\/\\:*?"<>|]/g, '_')
  const date = new Date().toISOString().split('T')[0]
  await _downloadFromServer(`/projects/${id}/production.xlsx`, `${safeName}_production_${date}.xlsx`)
}

export async function downloadProposalPdf(id, content: string[], projectName = 'proposal') {
  // content ∈ ['pricing', 'quantities'] — subset or both, must match BE endpoint.
  const safeName = String(projectName).replace(/[\/\\:*?"<>|]/g, '_')
  const date = new Date().toISOString().split('T')[0]
  const label = content.join('_')
  const params = content.map(c => `content=${encodeURIComponent(c)}`).join('&')
  await _downloadFromServer(`/projects/${id}/proposal.pdf?${params}`, `${safeName}_${label}_${date}.pdf`)
}

export async function fetchProposalPdfBytes(id: string, content: string[]): Promise<ArrayBuffer> {
  const params = content.map(c => `content=${encodeURIComponent(c)}`).join('&')
  const res = await mgpRequest(`/projects/${id}/proposal.pdf?${params}`)
  if (!res.ok) throw new Error('Failed to fetch proposal PDF')
  return res.arrayBuffer()
}

export async function sendReportEmail(
  id: string,
  pdfBytes: ArrayBuffer | null = null,
  filename: string | null = null,
): Promise<void> {
  // BE always generates the xlsx server-side; the PDF here is optional. Calling
  // with null/null is how the standalone "Download Excel" flow triggers the
  // Monday item creation + email without uploading a PDF.
  const formData = new FormData()
  if (pdfBytes != null && filename) {
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename)
  }
  const res = await mgpRequest(`/projects/${id}/send-report`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error('Failed to send report email')
}

/**
 * Push the project to the Monday.com quotation board (or the main board, when
 * MONDAY_QUOTATION_BOARD_ID isn't configured) and mark the project as having
 * been quoted. No credits move — the refund is admin-driven after the order
 * signs externally. Optionally accepts the PDF the FE just built; the BE
 * always attaches the proposal xlsx.
 *
 * Returns `{ quotationRequestedAt, status, ... }`. Status is `cooldown` when
 * the server short-circuited a re-click within the 30s window.
 */
export async function requestQuotation(
  id: string,
  pdfBytes: ArrayBuffer | null = null,
  filename: string | null = null,
): Promise<{ status: string; quotationRequestedAt: string | null; monday?: any; monday_error?: string | null }> {
  const formData = new FormData()
  if (pdfBytes != null && filename) {
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename)
  }
  const res = await mgpRequest(`/projects/${id}/request-quotation`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error('Failed to request quotation')
  return res.json()
}

// ── Version ─────────────────────────────────────────────────────────────────

export async function getBackendVersion() {
  const res = await mgpRequest('/version')
  if (!res.ok) return null
  const data = await res.json()
  return data.version
}

export function getFrontendVersion() {
  // Injected at build time from FE/package.json via vite.config.js `define`.
  return __APP_VERSION__
}

// ── Images ──────────────────────────────────────────────────────────────────

/**
 * Upload an image for a project. Replaces any existing image.
 * @param {string} projectId - Project UUID
 * @param {Blob} imageBlob - Image file blob
 * @returns {Promise<{imageId: string, width: number, height: number, contentType: string, fileSize: number}>}
 */
export async function uploadProjectImage(projectId, imageBlob) {
  const formData = new FormData()
  formData.append('file', imageBlob, 'image.jpg')
  
  const res = await mgpRequest(`/projects/${projectId}/image`, {
    method: 'POST',
    body: formData,
    // FormData is detected automatically - Content-Type will be set by browser with boundary
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to upload image' }))
    throw new Error(error.detail || 'Failed to upload image')
  }
  
  return res.json()
}

/**
 * Get the URL for fetching a project's image.
 * @param {string} projectId - Project UUID
 * @returns {string} - Image path (not full URL, for use with mgpRequest)
 */
export function getProjectImageUrl(projectId) {
  return `/projects/${projectId}/image`
}

/**
 * Check if a project has an uploaded image (separate from base64 in layout).
 * @param {string} projectId - Project UUID
 * @returns {Promise<boolean>}
 */
export async function projectHasImage(projectId) {
  const res = await mgpRequest(`/projects/${projectId}/image`, { method: 'HEAD' })
  return res.ok
}
