import { useState } from 'react'
import { PRIMARY, TEXT, WARNING } from '../styles/colors'
import { useLang } from '../i18n/LangContext'
import { captureMapView } from '../services/sam2Service'
import { blobToImagePayload } from '../utils/imagePayload'
// react-leaflet types don't align well with runtime — cast to any to suppress JSX type errors
import { MapContainer as _MapContainer, TileLayer as _TileLayer, useMap } from 'react-leaflet'
const MapContainer = _MapContainer as any
const TileLayer = _TileLayer as any
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './RoofMapper.css'

// Fix for default marker icon in React-Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

function LocationHandler({ triggerLocation }) {
  const map = useMap()
  if (triggerLocation) map.setView(triggerLocation, 20)
  return null
}

// Renders a "Use this view" button overlaid on the map. Captures the visible
// tiles as an image and forwards it to the parent as the project image.
function CaptureControl({ onCapture, label }) {
  const map = useMap()
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const bounds = map.getBounds()
      const blob = await captureMapView(map, {
        north: bounds.getNorth(), south: bounds.getSouth(),
        east: bounds.getEast(), west: bounds.getWest(),
      })
      const payload = await blobToImagePayload(blob, 'map_view.png')
      onCapture(payload)
    } catch (err) {
      console.error('Map capture failed:', err)
      alert('Failed to capture map view. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 500, padding: '0.6rem 1.4rem',
        background: PRIMARY, color: TEXT, border: 'none', borderRadius: '8px',
        cursor: busy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.9rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)', opacity: busy ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}

function RoofMapper({ onCapture }) {
  const { t } = useLang()
  const [center] = useState([32.0853, 34.7818]) // Tel Aviv default
  const [zoom] = useState(21)
  const [tileSource, setTileSource] = useState('google')
  const [userLocation, setUserLocation] = useState(null)

  const govmapKey = import.meta.env.VITE_GOVMAP_API_KEY

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          setUserLocation([latitude, longitude] as any)
        },
        (error) => {
          console.error('Error getting location:', error)
          alert(t('step1.geolocationDenied'))
        }
      )
    } else {
      alert(t('step1.geolocationUnsupported'))
    }
  }

  const cycleTileSource = () => {
    const sources = ['google', 'govmap']
    const idx = sources.indexOf(tileSource)
    setTileSource(sources[(idx + 1) % sources.length])
  }

  const getTileLayerConfig = () => {
    switch (tileSource) {
      case 'govmap': {
        const govmapUrl = govmapKey
          ? `https://tiles.govmap.gov.il/orthophoto/{z}/{x}/{y}?token=${govmapKey}`
          : 'https://tiles.govmap.gov.il/orthophoto/{z}/{x}/{y}'
        return { url: govmapUrl, attribution: '&copy; Survey of Israel (מדידות ישראל) | GovMap', maxZoom: 23, maxNativeZoom: 22 }
      }
      case 'google':
      default:
        return {
          url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          attribution: '&copy; Google Maps',
          maxZoom: 22, maxNativeZoom: 22,
          subdomains: ['0', '1', '2', '3'],
        }
    }
  }

  const tileConfig = getTileLayerConfig()

  const getSourceLabel = () => {
    switch (tileSource) {
      case 'govmap': return '🇮🇱 GovMap (Z22)'
      case 'google': return '🛰️ Google (Z22)'
      default:       return '🛰️ Satellite'
    }
  }

  return (
    <div className="roof-mapper">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          key={tileSource}
          attribution={tileConfig.attribution}
          url={tileConfig.url}
          maxZoom={tileConfig.maxZoom}
          maxNativeZoom={tileConfig.maxNativeZoom}
          {...((tileConfig as any).subdomains && { subdomains: (tileConfig as any).subdomains })}
        />

        <LocationHandler triggerLocation={userLocation} />
        <CaptureControl onCapture={onCapture} label={t('step1.useThisView')} />
      </MapContainer>

      <div className="map-controls">
        <button className="control-button" title="Get current location" onClick={handleGetLocation}>
          📍 My Location
        </button>
        <button
          className="control-button satellite active"
          title="Click to switch imagery source"
          onClick={cycleTileSource}
        >
          {getSourceLabel()}
        </button>
      </div>

      {tileSource === 'govmap' && !govmapKey && (
        <div className="tile-warning" style={{ backgroundColor: WARNING, color: 'white' }}>
          ⚠️ GovMap requires API key. Add VITE_GOVMAP_API_KEY to .env file
        </div>
      )}
      {tileSource === 'govmap' && govmapKey && (
        <div className="tile-warning">
          ✨ GovMap: Israeli official orthophoto - BEST for Israel (10-15cm resolution)
        </div>
      )}
      {tileSource === 'google' && (
        <div className="tile-warning">
          ✨ Google: Best overall resolution (zoom 22) - recommended for Israel
        </div>
      )}
    </div>
  )
}

export default RoofMapper
