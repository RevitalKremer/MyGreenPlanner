export type ImagePayload = {
  imageData: string
  file: File
  rotation: number
  scale: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

// Convert an image Blob to the payload shape expected by handleImageUploaded.
// Used by RoofMapper (map capture) — rotation always 0.
export async function blobToImagePayload(blob: Blob, filename: string): Promise<ImagePayload> {
  const dataURL = await blobToDataURL(blob)
  const img = await loadImage(dataURL)
  return {
    imageData: dataURL,
    file: new File([blob], filename, { type: blob.type || 'image/png' }),
    rotation: 0,
    scale: 1,
    width: img.naturalWidth,
    height: img.naturalHeight,
  }
}

// Bake a rotation into image pixels. Returns a new dataURL whose natural size
// is the rotated bounding box; corners outside the original image are filled
// with `bgColor` so downstream code never sees transparency. Rotation is
// permanent — callers should set payload.rotation = 0 after baking.
export async function bakeImageRotation(
  dataURL: string,
  rotationDegrees: number,
  bgColor = '#ffffff',
): Promise<{ dataURL: string; width: number; height: number }> {
  const normalized = ((rotationDegrees % 360) + 360) % 360
  const img = await loadImage(dataURL)
  if (normalized === 0) {
    return { dataURL, width: img.naturalWidth, height: img.naturalHeight }
  }
  const rad = (normalized * Math.PI) / 180
  const w = img.naturalWidth
  const h = img.naturalHeight
  const sin = Math.abs(Math.sin(rad))
  const cos = Math.abs(Math.cos(rad))
  const newW = Math.round(w * cos + h * sin)
  const newH = Math.round(w * sin + h * cos)
  const canvas = document.createElement('canvas')
  canvas.width = newW
  canvas.height = newH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, newW, newH)
  ctx.translate(newW / 2, newH / 2)
  ctx.rotate(rad)
  ctx.drawImage(img, -w / 2, -h / 2)
  return { dataURL: canvas.toDataURL('image/png'), width: newW, height: newH }
}

export async function dataURLToFile(dataURL: string, filename: string, mimeType = 'image/png'): Promise<File> {
  const res = await fetch(dataURL)
  const blob = await res.blob()
  return new File([blob], filename, { type: mimeType })
}
