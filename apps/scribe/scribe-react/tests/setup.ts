// Setup file for vitest
import '@testing-library/jest-dom'

// Polyfill for AbortSignal compatibility with react-router v7
// This fixes the "Expected signal to be an instance of AbortSignal" error
// when using navigate() in tests with jsdom
if (typeof globalThis.AbortSignal === 'undefined') {
  // @ts-ignore
  globalThis.AbortSignal = AbortSignal
}

// Ensure AbortController is available
if (typeof globalThis.AbortController === 'undefined') {
  // @ts-ignore
  globalThis.AbortController = AbortController
}

// Patch AbortSignal to work with react-router's navigation
// The issue is that jsdom's AbortSignal is different from Node's AbortSignal
const OriginalAbortController = globalThis.AbortController

if (OriginalAbortController) {
  // @ts-ignore
  globalThis.AbortController = class PatchedAbortController extends OriginalAbortController {
    constructor() {
      super()
      // Ensure the signal has the correct prototype
      Object.setPrototypeOf(this.signal, AbortSignal.prototype)
    }
  }
}
