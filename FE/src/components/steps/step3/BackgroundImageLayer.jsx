/**
 * Renders background roof image in Step 3 tabs (Areas, Rails, Bases).
 * Transforms the image to match panel coordinate space.
 */
export default function BackgroundImageLayer({ 
  imageSrc, 
  uploadedImageData, 
  bbox,           // { minX, maxX, minY, maxY }
  toSvg,          // (x, y) => [svgX, svgY]
  sc,             // scale factor
}) {
  if (!imageSrc || !uploadedImageData) return null

  const imgW = uploadedImageData.width || 3000
  const imgH = uploadedImageData.height || 2000
  
  // Calculate image bounds in SVG space
  const [tl_x, tl_y] = toSvg(0, 0)
  const [br_x, br_y] = toSvg(imgW, imgH)
  
  const svgImgW = br_x - tl_x
  const svgImgH = br_y - tl_y

  return (
    <image
      href={imageSrc}
      x={tl_x}
      y={tl_y}
      width={svgImgW}
      height={svgImgH}
      opacity={1.0}
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }}
    />
  )
}
