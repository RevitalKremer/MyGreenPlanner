import { useState, useRef } from 'react'
import './ImageUploader.css'
import { useLang } from '../i18n/LangContext'

function ImageUploader({ onImageUploaded, onClose }) {
  const { t } = useLang()
  const [uploadedImage, setUploadedImage] = useState(null)
  const [rotation, setRotation] = useState(0)
  const [imageScale, setImageScale] = useState(1)
  const [imageFile, setImageFile] = useState(null)
  const fileInputRef = useRef(null)

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file && file.type.startsWith('image/')) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        setUploadedImage(e.target.result)
      }
      reader.readAsDataURL(file)
    } else {
      alert(t('welcome.invalidImage'))
    }
  }

  const handleRotationChange = (e) => {
    setRotation(parseInt(e.target.value))
  }

  const handleScaleChange = (e) => {
    setImageScale(parseFloat(e.target.value))
  }

  const handleConfirm = () => {
    if (uploadedImage && imageFile) {
      onImageUploaded({
        imageData: uploadedImage,
        file: imageFile,
        rotation: rotation,
        scale: imageScale
      })
    }
  }

  const handleReset = () => {
    setUploadedImage(null)
    setRotation(0)
    setImageScale(1)
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const quickRotate = (degrees) => {
    setRotation((rotation + degrees) % 360)
  }

  return (
    <div className="image-uploader-container">
        <div className="uploader-content">
          {!uploadedImage ? (
            <div className="upload-area">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="image-upload"
              />
              <label htmlFor="image-upload" className="upload-label">
                <div className="upload-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                </div>
                <p>{t('uploader.clickToUpload')}</p>
                <p className="upload-hint">{t('uploader.supported')}</p>
              </label>
            </div>
          ) : (
            <div className="image-preview-container">
              <div className="image-preview">
                <img
                  src={uploadedImage}
                  alt="Uploaded roof"
                  style={{
                    transform: `rotate(${rotation}deg) scale(${imageScale})`,
                    transition: 'transform 0.2s ease'
                  }}
                />
                <div className="north-indicator" style={{ transform: `rotate(${rotation}deg)` }}>
                  <span className="north-arrow">↑</span>
                  <span className="north-label">N</span>
                </div>
              </div>

              <div className="image-controls">
                <div className="control-section">
                  <label className="control-label">
                    {t('uploader.rotateAlign')}
                  </label>
                  <div className="rotation-control">
                    <button
                      className="quick-rotate-btn"
                      onClick={() => quickRotate(-90)}
                      title={t('uploader.rotateLeftTitle')}
                    >
                      {t('uploader.rotateLeft')}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={rotation}
                      onChange={handleRotationChange}
                      className="slider rotation-slider"
                    />
                    <button
                      className="quick-rotate-btn"
                      onClick={() => quickRotate(90)}
                      title={t('uploader.rotateRightTitle')}
                    >
                      {t('uploader.rotateRight')}
                    </button>
                  </div>
                  <div className="rotation-display">{rotation}°</div>
                </div>

                <div className="control-section">
                  <label className="control-label">
                    {t('uploader.zoom')}
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={imageScale}
                    onChange={handleScaleChange}
                    className="slider scale-slider"
                  />
                  <div className="scale-display">{Math.round(imageScale * 100)}%</div>
                </div>

                <div className="instruction-box">
                  <p><strong>{t('uploader.instructions')}</strong></p>
                  <ol>
                    <li>{t('uploader.inst1')}</li>
                    <li>{t('uploader.inst2')}</li>
                    <li>{t('uploader.inst3')}</li>
                    <li>{t('uploader.inst4')}</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {uploadedImage && (
            <div className="uploader-footer">
              <button className="btn-reset" onClick={handleReset}>
                {t('uploader.uploadDifferent')}
              </button>
              <button className="btn-confirm" onClick={handleConfirm}>
                {t('uploader.useThis')}
              </button>
            </div>
          )}
        </div>
    </div>
  )
}

export default ImageUploader
