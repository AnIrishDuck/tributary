// Setup file for vitest
import '@testing-library/jest-dom'

// Polyfill URL.createObjectURL / revokeObjectURL (jsdom doesn't implement them).
// Needed by generateThumbnail and any code that creates blob URLs.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test-url'
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}

// Polyfill HTMLCanvasElement 2D context and toBlob (jsdom lacks Canvas support).
// Needed by generateThumbnail which renders images onto a <canvas>.
HTMLCanvasElement.prototype.getContext = function () {
  return { drawImage() {} } as any
}
HTMLCanvasElement.prototype.toBlob = function (
  cb: (blob: Blob | null) => void,
  _type?: string,
  _quality?: number,
) {
  const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
  const blob = new Blob([bytes], { type: 'image/jpeg' })
  if (!blob.arrayBuffer) {
    ;(blob as any).arrayBuffer = () => Promise.resolve(bytes.buffer)
  }
  cb(blob)
}

// Polyfill Image constructor for offscreen image loading in generateThumbnail.
const _OrigImage = globalThis.Image
function FakeImage(this: any) {
  const self = this
  self.naturalWidth = 200
  self.naturalHeight = 150
  self.onload = null as any
  self.onerror = null as any
  Object.defineProperty(self, 'src', {
    set() {
      setTimeout(() => { if (self.onload) self.onload(new Event('load')) }, 0)
    },
  })
}
globalThis.Image = FakeImage as any

// Fix AbortSignal compatibility with react-router v7 in jsdom environment.
//
// jsdom replaces globalThis.AbortController/AbortSignal with its own
// implementations. When react-router calls navigate(), it creates a native
// Request (via Node's undici) passing the signal from globalThis.AbortController.
// undici checks `signal instanceof AbortSignal` using the *native* AbortSignal,
// which fails because jsdom's AbortSignal is a different class.
//
// The fix: wrap the global Request constructor to strip out the incompatible
// signal and recreate it from a native AbortController, OR patch the global
// AbortController to produce native signals.

// Approach: Wrap the global Request constructor to handle incompatible signals.
// When react-router creates `new Request(url, { signal })`, we intercept it,
// create a native AbortController, and use its signal instead.
const NativeRequest = globalThis.Request
if (NativeRequest) {
  // @ts-ignore
  globalThis.Request = class PatchedRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal) {
        // If the signal fails the native instanceof check, replace it
        // with a signal from a fresh (native) AbortController.
        // We detect this by trying to construct the parent; if it throws,
        // we retry without the signal.
        try {
          super(input, init)
          return
        } catch (e: any) {
          if (e?.message?.includes('AbortSignal') || e?.message?.includes('signal')) {
            // Create a native AbortController by using Node's internal one
            // We remove the signal entirely since it's only used for cancellation
            // in navigation, and test navigation doesn't need cancellation support.
            const { signal, ...restInit } = init
            super(input, restInit as RequestInit)
            return
          }
          throw e
        }
      }
      super(input, init)
    }
  }
}
