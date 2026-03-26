import { mgpRequest } from './mgpApi'

export async function listProjects() {
  const res = await mgpRequest('/projects')
  if (!res.ok) throw new Error('Failed to load projects')
  return res.json()
}

export async function createProject(name, location, data) {
  const res = await mgpRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, location: location || null, data }),
  })
  if (!res.ok) throw new Error('Failed to create project')
  return res.json()
}

export async function updateProject(id, payload) {
  const res = await mgpRequest(`/projects/${id}`, {
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

export async function fetchPanelTypes() {
  const res = await mgpRequest('/products/panel-types')
  if (!res.ok) throw new Error('Failed to load panel types')
  return res.json()
}
