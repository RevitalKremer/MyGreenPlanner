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

export async function computeBases(id, step3Data = null, trapezoidConfigs = null) {
  const body = {}
  if (step3Data) body.step3 = step3Data
  if (trapezoidConfigs) body.trapezoidConfigs = trapezoidConfigs
  const res = await mgpRequest(`/projects/${id}/bases`, {
    method: 'PUT',
    ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error('Failed to compute bases')
  return res.json()
}

export async function getBases(id) {
  const res = await mgpRequest(`/projects/${id}/bases`)
  if (!res.ok) throw new Error('Failed to fetch bases')
  return res.json()
}

export async function saveTab(id, tabName, step3Data = null, trapezoidConfigs = null) {
  const body = {}
  if (step3Data) body.step3 = step3Data
  if (trapezoidConfigs) body.trapezoidConfigs = trapezoidConfigs
  const res = await mgpRequest(`/projects/${id}/saveTab/${tabName}`, {
    method: 'PUT',
    ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Failed to save tab ${tabName}`)
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
