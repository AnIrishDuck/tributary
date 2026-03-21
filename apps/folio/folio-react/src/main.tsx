// Set Folio branding before any component imports
import { setBranding } from 'scribe-react-common/src/branding'
setBranding({ appName: 'Folio' })

// Polyfill Buffer for browser compatibility
import { Buffer } from 'buffer'
window.Buffer = Buffer

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from 'scribe-react/src/App'
import 'scribe-react/src/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
