/**
 * Compute the target dimensions for a thumbnail, preserving aspect ratio.
 * If both dimensions are already ≤ maxEdge, returns them unchanged.
 * Otherwise scales so the longest edge equals maxEdge.
 */
export function thumbnailDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height }
  }

  if (width >= height) {
    return {
      width: maxEdge,
      height: Math.round((height / width) * maxEdge),
    }
  } else {
    return {
      width: Math.round((width / height) * maxEdge),
      height: maxEdge,
    }
  }
}

const DEFAULT_MAX_EDGE = 200

/**
 * Generate a JPEG thumbnail from raw image bytes.
 *
 * Decodes the image via an offscreen <img> + object URL, draws it
 * scaled-down onto a <canvas>, and exports as JPEG. The longest edge
 * is capped at `maxEdge` (default 200px); aspect ratio is preserved.
 *
 * Returns the thumbnail as a Uint8Array (JPEG bytes).
 */
export async function generateThumbnail(
  imageData: Uint8Array,
  contentType: string,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<Uint8Array> {
  const blob = new Blob([imageData], { type: contentType })
  const url = URL.createObjectURL(blob)

  try {
    const img = await loadImage(url)
    const dims = thumbnailDimensions(img.naturalWidth, img.naturalHeight, maxEdge)

    const canvas = document.createElement('canvas')
    canvas.width = dims.width
    canvas.height = dims.height

    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, dims.width, dims.height)

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/jpeg',
        0.7,
      )
    })

    const buffer = await jpegBlob.arrayBuffer()
    return new Uint8Array(buffer)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (_e) => reject(new Error('Failed to load image'))
    img.src = src
  })
}
