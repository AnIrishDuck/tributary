// Setup file for vitest
import '@testing-library/jest-dom'

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
