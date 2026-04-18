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

export async function createProject(name, location, layout, data, roofSpec = null) {
  const res = await mgpRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({ 
      name, 
      location: location || null, 
      layout, 
      data,
      ...(roofSpec ? { roof_spec: roofSpec } : {})
    }),
  })
  if (!res.ok) throw new Error('Failed to create project')
  return res.json()
}

export async function updateProject(id: string, payload: { name?: string; location?: string | null; layout?: ProjectLayout; data?: ProjectData }, step: number | null = null) {
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

export async function updateStep(id, newStep) {
  const res = await mgpRequest(`/projects/${id}/step?new_step=${newStep}`, { method: 'PUT' })
  if (!res.ok) throw new Error('Failed to update step')
  return res.json()
}

export async function approvePlan(id, strictConsent) {
  const res = await mgpRequest(`/projects/${id}/approvePlan?strictConsent=${strictConsent}`, {
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

export async function getBomDeltas(id) {
  const res = await mgpRequest(`/projects/${id}/bom/deltas`)
  if (!res.ok) throw new Error('Failed to fetch BOM deltas')
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

export async function getEffectiveBOM(id, lang = null) {
  const url = lang ? `/projects/${id}/bom/effective?lang=${lang}` : `/projects/${id}/bom/effective`
  const res = await mgpRequest(url)
  if (!res.ok) throw new Error('Failed to fetch effective BOM')
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
  return '0.0.1' // Keep in sync with package.json
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
