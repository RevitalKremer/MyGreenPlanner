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
   * Segment a roof from map tiles using geographic coordinates
   */
  static async segmentRoofGeo(imageBlob, lat, lng, bounds) {
    const formData = new FormData()
    formData.append('image', imageBlob, 'map_tile.png')
    formData.append('lat', lat.toString())
    formData.append('lng', lng.toString())
    formData.append('bounds', JSON.stringify(bounds))

    try {
      const response = await fetch(`${BACKEND_URL}/segment-roof-coordinates`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Segmentation failed')
      }

      const geojson = await response.json()
      return geojson
    } catch (error) {
      console.error('Roof segmentation failed:', error)
      throw error
    }
  }

  /**
   * Segment a roof from map without providing image (backend fetches tiles)
   * This avoids CORS issues with map tiles
   */
  static async segmentRoofFromMap(lat, lng, zoom, bounds) {
    const formData = new FormData()
    formData.append('lat', lat.toString())
    formData.append('lng', lng.toString())
    formData.append('zoom', zoom.toString())
    formData.append('bounds', JSON.stringify(bounds))

    try {
      const response = await fetch(`${BACKEND_URL}/segment-roof-from-map`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Segmentation failed')
      }

      const geojson = await response.json()
      return geojson
    } catch (error) {
      console.error('Roof segmentation from map failed:', error)
      throw error
    }
  }

  /**
   * Segment a roof using pixel coordinates
   */
  static async segmentRoofPixel(imageBlob, pointX, pointY) {
    const formData = new FormData()
    formData.append('image', imageBlob, 'map_tile.png')
    formData.append('point_x', pointX.toString())
    formData.append('point_y', pointY.toString())

    try {
      const response = await fetch(`${BACKEND_URL}/segment-roof`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Segmentation failed')
      }

      const geojson = await response.json()
      return geojson
    } catch (error) {
      console.error('Roof segmentation failed:', error)
      throw error
    }
  }
}

/**
 * Capture map tiles as an image for SAM2 processing
 */
export async function captureMapView(map, bounds) {
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
