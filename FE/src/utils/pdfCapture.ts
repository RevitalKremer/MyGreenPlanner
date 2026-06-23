import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// A4 landscape page geometry shared by the PDF exporters (Step 5 construction,
// Step 9 electrical). ~3.2 px/mm gives a crisp on-screen page; html2canvas at
// scale 1.5 then yields ~225 DPI.
export const PAGE_W_MM = 297
export const PAGE_H_MM = 210
export const PAGE_W_PX = PAGE_W_MM * 3.2
export const PAGE_H_PX = PAGE_H_MM * 3.2

// Pre-rasterize a page's <svg> elements to <img> so html2canvas (which parses
// transformed/complex SVG poorly) captures them faithfully. Returns swap records
// to restore afterwards.
export async function rasterizeSvgs(pageEl: HTMLElement) {
  const svgs = Array.from(pageEl.querySelectorAll('svg')) as SVGSVGElement[]
  const swaps: { img: HTMLImageElement; svg: SVGSVGElement; url: string }[] = []
  for (const svg of svgs) {
    // Natural (pre-transform) dims from attributes; getBoundingClientRect would
    // be double-scaled inside a CSS scale() transform.
    const attrW = parseFloat(svg.getAttribute('width') || '')
    const attrH = parseFloat(svg.getAttribute('height') || '')
    const hasNaturalDims = attrW > 0 && attrH > 0 && !String(svg.getAttribute('width')).includes('%')
    let w: number, h: number
    if (hasNaturalDims) { w = Math.round(attrW); h = Math.round(attrH) }
    else { const r = svg.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height) }
    if (!w || !h) continue
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))

    // Inject the page font so serialized standalone SVG text isn't a blurry serif.
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    styleEl.textContent = `
      text, tspan {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
          'Helvetica Neue', Arial, sans-serif;
        text-rendering: geometricPrecision;
        shape-rendering: geometricPrecision;
      }
    `
    clone.insertBefore(styleEl, clone.firstChild)

    // Embed any remote <image> hrefs as data URLs so they're captured.
    const svgImages = clone.querySelectorAll('image')
    for (const svgImg of Array.from(svgImages)) {
      const href = svgImg.getAttribute('href') || svgImg.getAttribute('xlink:href')
      if (href && !href.startsWith('data:') && (href.startsWith('blob:') || href.startsWith('http'))) {
        try {
          const im = new Image(); im.crossOrigin = 'anonymous'
          await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = reject; im.src = href })
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight
          c.getContext('2d')!.drawImage(im, 0, 0)
          svgImg.setAttribute('href', c.toDataURL('image/png'))
        } catch { /* leave as-is */ }
      }
    }

    const xml = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
    const img = new Image(w, h)
    img.style.cssText = `display:block;width:${w}px;height:${h}px`
    await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; img.src = url })
    svg.parentNode!.replaceChild(img, svg)
    swaps.push({ img, svg, url })
  }
  return swaps
}

export function restoreSvgs(swaps: { img: HTMLImageElement; svg: SVGSVGElement; url: string }[]) {
  for (const { img, svg, url } of swaps) {
    img.parentNode?.replaceChild(svg, img)
    URL.revokeObjectURL(url)
  }
}

// Capture mounted page elements (each sized PAGE_W_PX × PAGE_H_PX) into a single
// landscape-A4 PDF. Returns null when no usable page element is present.
export async function pagesToPdf(elements: (HTMLElement | null | undefined)[]): Promise<ArrayBuffer | null> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  let firstPage = true
  for (const el of elements) {
    if (!el) continue
    const parent = el.parentElement as HTMLElement | null
    const savedTransform = parent?.style.transform ?? ''
    if (parent) parent.style.transform = 'none'

    const swaps = await rasterizeSvgs(el)
    const canvas = await html2canvas(el, {
      scale: 1.5, useCORS: true, allowTaint: true, backgroundColor: '#ffffff',
      logging: false, width: PAGE_W_PX, height: PAGE_H_PX,
    })
    restoreSvgs(swaps)
    if (parent) parent.style.transform = savedTransform

    const imgData = canvas.toDataURL('image/jpeg', 0.85)
    if (!firstPage) pdf.addPage()
    pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W_MM, PAGE_H_MM)
    firstPage = false
  }
  return firstPage ? null : (pdf.output('arraybuffer') as ArrayBuffer)
}
