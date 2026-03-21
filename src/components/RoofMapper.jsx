import { useState, useRef } from 'react'
import { PRIMARY, WARNING } from '../styles/colors'
import { MapContainer, TileLayer, Marker, Polygon, useMapEvents, useMap } from 'react-leaflet'
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

// Custom marker icon for roof selection
const roofMarkerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

function MapClickHandler({ onPointSelect }) {
  const map = useMapEvents({
    click: (e) => {
      const bounds = map.getBounds()
      const boundsObj = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      }
      onPointSelect(e.latlng, map, boundsObj)
    },
  })
  return null
}

function LocationHandler({ triggerLocation }) {
  const map = useMap()
  
  if (triggerLocation) {
    map.setView(triggerLocation, 20)
  }
  
  return null
}

function RoofMapper({ onPointSelect, selectedPoint, roofPolygon }) {
  // Default center - can be changed to user's location
  const [center] = useState([32.0853, 34.7818]) // Tel Aviv as default
  const [zoom] = useState(21) // Maximum zoom for best roof identification
  const [tileSource, setTileSource] = useState('google') // Start with Google - works without API key
  const [userLocation, setUserLocation] = useState(null)

  const govmapKey = import.meta.env.VITE_GOVMAP_API_KEY

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          setUserLocation([latitude, longitude])
        },
        (error) => {
          console.error('Error getting location:', error)
          alert('Unable to get your location. Please enable location services.')
        }
      )
    } else {
      alert('Geolocation is not supported by your browser.')
    }
  }

  const cycleTileSource = () => {
    const sources = ['google', 'govmap']
    const currentIndex = sources.indexOf(tileSource)
    const nextIndex = (currentIndex + 1) % sources.length
    setTileSource(sources[nextIndex])
  }

  const getTileLayerConfig = () => {
    switch (tileSource) {
      case 'govmap':
        // GovMap - Israeli government high-resolution orthophoto
        const govmapUrl = govmapKey 
          ? `https://tiles.govmap.gov.il/orthophoto/{z}/{x}/{y}?token=${govmapKey}`
          : 'https://tiles.govmap.gov.il/orthophoto/{z}/{x}/{y}'
        return {
          url: govmapUrl,
          attribution: '&copy; Survey of Israel (מדידות ישראל) | GovMap',
          maxZoom: 23,
          maxNativeZoom: 22
        }
      case 'google':
      default:
        return {
          url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          attribution: '&copy; Google Maps',
          maxZoom: 22,
          maxNativeZoom: 22,
          subdomains: ['0', '1', '2', '3']
        }
    }
  }

  const tileConfig = getTileLayerConfig()
  
  const getSourceLabel = () => {
    switch (tileSource) {
      case 'govmap': return '🇮🇱 GovMap (Z22)'
      case 'google': return '🛰️ Google (Z22)'
      case 'bing': return '🛰️ Bing (Z19)'
      case 'mapi': return '🇮🇱 Israel Hiking (Z16)'
      case 'mapbox': return '🛰️ Mapbox (Z22)'
      case 'esri': return '🛰️ Esri (Z19)'
      default: return '🛰️ Satellite'
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
          {...(tileConfig.subdomains && { subdomains: tileConfig.subdomains })}
        />
        
        <MapClickHandler onPointSelect={onPointSelect} />
        <LocationHandler triggerLocation={userLocation} />
        
        {selectedPoint && (
          <Marker 
            position={[selectedPoint.lat, selectedPoint.lng]} 
            icon={roofMarkerIcon}
          />
        )}

        {roofPolygon && roofPolygon.coordinates && (
          <Polygon
            positions={roofPolygon.coordinates}
            pathOptions={{
              color: PRIMARY,
              fillColor: PRIMARY,
              fillOpacity: 0.3,
              weight: 2
            }}
          />
        )}
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
      {tileSource === 'bing' && (
        <div className="tile-warning">
          💡 Bing Maps: Good aerial coverage for Israel (zoom 19)
        </div>
      )}
      {tileSource === 'mapi' && (
        <div className="tile-warning">
          🇮🇱 Israel Hiking: Based on Israeli data but lower zoom (zoom 16)
        </div>
      )}
      {tileSource === 'mapbox' && (
        <div className="tile-warning">
          💡 Mapbox: High resolution satellite imagery (zoom 22)
        </div>
      )}
    </div>
  )
}

export default RoofMapper
