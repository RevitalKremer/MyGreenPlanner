import { mgpRequest } from './mgpApi'

// Products
export const getProducts = () => mgpRequest('/admin/products').then(r => r.json())
export const createProduct = (data) => mgpRequest('/admin/products', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json())
export const updateProduct = (id, data) => mgpRequest(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json())
export const deleteProduct = (id) => mgpRequest(`/admin/products/${id}`, { method: 'DELETE' })

// Settings
export const getSettings = () => mgpRequest('/admin/settings').then(r => r.json())
export const updateSetting = (key, value_json) => mgpRequest(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value_json }) }).then(r => r.json())
