import React from 'react'
import RoofMapper from '../RoofMapper'
import ImageUploader from '../ImageUploader'

export default function Step1RoofAllocation({
  uploadedImageMode,
  setUploadedImageMode,
  backendStatus,
  uploadedImageData,
  handleImageUploaded,
  imageRef,
  setImageRef,
  handleImageClick,
  roofPolygon,
  selectedPoint,
  setSelectedPoint,
  setRoofPolygon,
  setProcessedImage,
  handlePointSelect
}) {
  return (
    <>
      {/* Step Options Toolbar */}
      <div className="step-options">
        <button 
          className="btn-option" 
          onClick={() => setUploadedImageMode(!uploadedImageMode)}
        >
          {uploadedImageMode ? 'Map' : 'Image'}
        </button>
        <div className="step-instruction" style={{ flex: 1, padding: '0 1rem', color: '#666666', fontWeight: '500' }}>
          {uploadedImageMode ? 'Upload an image and click on the roof' : 'Click on the roof to identify it (SAM2 will process)'}
        </div>
        <div className="step-status">
          {backendStatus.status === 'checking' && (
            <span className="status-badge status-checking">Checking</span>
          )}
          {backendStatus.status === 'running' && backendStatus.model_loaded && (
            <span className="status-badge status-ready">SAM2 Ready</span>
          )}
          {backendStatus.status === 'running' && !backendStatus.model_loaded && (
            <span className="status-badge status-warning">Loading</span>
          )}
          {backendStatus.status === 'offline' && (
            <span className="status-badge status-offline">Offline</span>
          )}
        </div>
      </div>
      
      {/* Step Content Area */}
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageMode ? (
          uploadedImageData ? (
            <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
              <div className="uploaded-image-container" style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}>
                <img 
                  ref={(el) => setImageRef(el)}
                  src={uploadedImageData.imageData} 
                  alt="Uploaded roof"
                  onClick={handleImageClick}
                  style={{
                    display: 'block',
                    transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                    maxWidth: '100%',
                    maxHeight: 'calc(100vh - 250px)',
                    width: 'auto',
                    height: 'auto',
                    cursor: 'crosshair'
                  }}
                />
                {roofPolygon && roofPolygon.coordinates && imageRef && (
                  <svg
                    viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`
                    }}
                  >
                    <polygon
                      points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                      fill="rgba(196, 214, 0, 0.3)"
                      stroke="#C4D600"
                      strokeWidth="3"
                    />
                  </svg>
                )}
                {selectedPoint && imageRef && (
                  <div 
                    className="selected-point-marker"
                    style={{
                      position: 'absolute',
                      left: `calc(50% + ${(selectedPoint.x - imageRef.naturalWidth / 2) * (imageRef.width / imageRef.naturalWidth)}px)`,
                      top: `calc(50% + ${(selectedPoint.y - imageRef.naturalHeight / 2) * (imageRef.height / imageRef.naturalHeight)}px)`,
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: '3px solid #FF5722',
                      background: 'rgba(255, 87, 34, 0.5)',
                      transform: `translate(-50%, -50%) rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                      transformOrigin: 'center',
                      pointerEvents: 'none',
                      zIndex: 10
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <ImageUploader 
              onImageUploaded={handleImageUploaded}
              onClose={() => {}} 
            />
          )
        ) : (
          <RoofMapper 
            onPointSelect={handlePointSelect}
            selectedPoint={selectedPoint}
            roofPolygon={roofPolygon}
          />
        )}

        {/* Info Panel - only shown in Step 1 */}
        {selectedPoint && (
          <div className="info-panel">
            <h3>Selected Location</h3>
            {uploadedImageMode ? (
              <>
                <p>Pixel X: {selectedPoint.x}</p>
                <p>Pixel Y: {selectedPoint.y}</p>
              </>
            ) : (
              <>
                <p>Latitude: {selectedPoint.lat?.toFixed(6)}</p>
                <p>Longitude: {selectedPoint.lng?.toFixed(6)}</p>
              </>
            )}
            {roofPolygon && (
              <div>
                <h4>Roof Polygon Created</h4>
                {roofPolygon.area && (
                  <p>Area: {roofPolygon.area.toLocaleString()} {uploadedImageMode ? 'pixels' : 'm²'}</p>
                )}
                {roofPolygon.confidence && (
                  <p>Confidence: {(roofPolygon.confidence * 100).toFixed(1)}%</p>
                )}
                {roofPolygon.coordinates && <p>Points: {roofPolygon.coordinates.length}</p>}
                
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                  <button 
                    onClick={() => {
                      setSelectedPoint(null)
                      setRoofPolygon(null)
                      setProcessedImage(null)
                    }}
                    style={{
                      background: '#f44336',
                      color: 'white',
                      border: 'none',
                      padding: '0.75rem 1rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600'
                    }}
                  >
                    Clear & Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
