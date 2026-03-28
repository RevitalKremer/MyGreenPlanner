import { mgpRequest } from './mgpApi'

export async function listProjects() {
  const res = await mgpRequest('/projects')
  if (!res.ok) throw new Error('Failed to load projects')
  return res.json()
}

export async function createProject(name, location, layout, data) {
  const res = await mgpRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, location: location || null, layout, data }),
  })
  if (!res.ok) throw new Error('Failed to create project')
  return res.json()
}

export async function updateProject(id, payload, step = null) {
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

export async function computeRails(id, step3Data = null) {
  const res = await mgpRequest(`/projects/${id}/rails`, {
    method: 'PUT',
    ...(step3Data != null ? { body: JSON.stringify({ step3: step3Data }) } : {}),
  })
  if (!res.ok) throw new Error('Failed to compute rails')
  return res.json()
}

export async function getRails(id) {
  const res = await mgpRequest(`/projects/${id}/rails`)
  if (!res.ok) throw new Error('Failed to fetch rails')
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
