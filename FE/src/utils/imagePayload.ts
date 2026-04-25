export type ImagePayload = {
  imageData: string
  file: File
  rotation: number
  scale: number
  width: number
  height: number
}

// Convert an image Blob to the payload shape expected by handleImageUploaded.
// Used by RoofMapper (map capture) and Step1 (paste from clipboard).
export function blobToImagePayload(blob: Blob, filename: string): Promise<ImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const dataURL = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.onload = () => resolve({
        imageData: dataURL,
        file: new File([blob], filename, { type: blob.type || 'image/png' }),
        rotation: 0,
        scale: 1,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
      img.src = dataURL
    }
    reader.readAsDataURL(blob)
  })
}
