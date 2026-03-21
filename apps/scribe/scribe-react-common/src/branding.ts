/**
 * Runtime branding configuration.
 *
 * Defaults to Scribe branding.  Apps that re-skin scribe (e.g. Folio) call
 * `setBranding()` **before** importing the App component so that all UI
 * reads the overridden values.
 */
export const branding = {
  appName: 'Scribe',
}

export function setBranding(config: Partial<typeof branding>) {
  Object.assign(branding, config)
}
