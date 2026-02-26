import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted fonts (no Google Fonts requests)
import '@fontsource/indie-flower/400.css'
import '@fontsource/gloria-hallelujah/400.css'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
