import { useState, useRef } from 'react'
import './ImageUploader.css'
import { useLang } from '../i18n/LangContext'

function ImageUploader({ onImageUploaded, onClose: _onClose }) {
  const { t } = useLang()
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)
  const [imageScale, setImageScale] = useState(1)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadFromFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert(t('welcome.invalidImage'))
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setUploadedImage(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file) loadFromFile(file)
  }

  const handlePasteClick = async () => {
    try {
      // @ts-ignore — navigator.clipboard.read() not in older lib.dom.d.ts
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((tp: string) => tp.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const file = new File([blob], 'pasted_image.png', { type: blob.type || 'image/png' })
        loadFromFile(file)
        return
      }
      alert(t('uploader.clipboardNoImage'))
    } catch (err) {
      console.error('Clipboard read failed:', err)
      alert(t('uploader.clipboardError'))
    }
  }

  const handleRotationChange = (e) => setRotation(parseInt(e.target.value))
  const handleScaleChange    = (e) => setImageScale(parseFloat(e.target.value))

  const handleConfirm = () => {
    if (uploadedImage && imageFile) {
      const img = new Image()
      img.onload = () => {
        onImageUploaded({
          imageData: uploadedImage,
          file: imageFile,
          rotation: rotation,
          scale: imageScale,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      }
      img.src = uploadedImage
    }
  }

  const handleReset = () => {
    setUploadedImage(null)
    setRotation(0)
    setImageScale(1)
    setImageFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const quickRotate = (degrees) => setRotation((rotation + degrees) % 360)

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
              <div className="upload-options">
                <label htmlFor="image-upload" className="upload-option">
                  <div className="upload-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                  </div>
                  <p>{t('uploader.uploadOption')}</p>
                  <p className="upload-hint">{t('uploader.supported')}</p>
                </label>
                <button type="button" className="upload-option" onClick={handlePasteClick}>
                  <div className="upload-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                    </svg>
                  </div>
                  <p>{t('uploader.pasteOption')}</p>
                  <p className="upload-hint">{t('uploader.pasteHint')}</p>
                </button>
              </div>
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
