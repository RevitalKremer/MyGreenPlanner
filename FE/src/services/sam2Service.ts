/**
 * Service to interact with the SAM2 backend for roof segmentation
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export class SAM2Service {
  
  /**
   * Check if the backend is running and ready
   */
  static async checkHealth() {
    try {
      const response = await fetch(`${BACKEND_URL}/`)
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Backend health check failed:', error)
      return { status: 'offline', model_loaded: false }
    }
  }

  /**
   * Detect all panels in a plan image.
   * sampleX/sampleY are optional — a clicked panel helps SAM2 identify panel appearance.
   * Returns: { panels: [{ x, y, width, height, rotation, confidence }] } in image pixels.
   */
  static async segmentAllPanels(imageBlob, sampleX = null, sampleY = null) {
    const formData = new FormData()
    formData.append('image', imageBlob, 'plan.png')
    if (sampleX !== null) formData.append('sample_x', sampleX.toString())
    if (sampleY !== null) formData.append('sample_y', sampleY.toString())

    try {
      const response = await fetch(`${BACKEND_URL}/segment-all-panels`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Panel detection failed')
      }
      return await response.json()
    } catch (error) {
      console.error('Panel detection failed:', error)
      throw error
    }
  }

  /**
   * Fill a polygon boundary with a regular panel grid.
   * polygon: [[x,y], ...] in image pixel coordinates
   * Returns: { panels: [{ x, y, width, height, rotation, confidence }] }
   */
  static async fillPanelsInPolygon(imageBlob, polygon, sampleX, sampleY) {
    const formData = new FormData()
    formData.append('image', imageBlob, 'plan.png')
    formData.append('polygon', JSON.stringify(polygon))
    formData.append('sample_x', sampleX.toString())
    formData.append('sample_y', sampleY.toString())

    try {
      const response = await fetch(`${BACKEND_URL}/fill-panels-in-polygon`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Panel fill failed')
      }
      return await response.json()
    } catch (error) {
      console.error('Panel fill failed:', error)
      throw error
    }
  }
}

/**
 * Capture map tiles as an image for SAM2 processing
 */
export async function captureMapView(map, bounds): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      // Use leaflet-image or html2canvas to capture the map
      // For now, we'll use a simple approach with the tile layer
      
      const container = map.getContainer()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      // Set canvas size based on map container
      canvas.width = container.offsetWidth
      canvas.height = container.offsetHeight
      
      // Get all tile images
      const tiles = container.querySelectorAll('.leaflet-tile-pane img')
      
      if (tiles.length === 0) {
        reject(new Error('No tiles found'))
        return
      }

      // Draw tiles onto canvas
      tiles.forEach(tile => {
        const transform = tile.style.transform
        if (transform) {
          // Parse transform to get position
          const match = transform.match(/translate3d\(([^,]+)px,\s*([^,]+)px/)
          if (match) {
            const x = parseFloat(match[1])
            const y = parseFloat(match[2])
            ctx.drawImage(tile, x, y)
          }
        }
      })

      // Convert canvas to blob
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create image blob'))
        }
      }, 'image/png')
      
    } catch (error) {
      reject(error)
    }
  })
}
