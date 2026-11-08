// Development-only page: served by the dev server, never part of the production build.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/ui/styles/global.css'
import { CityPage } from './CityPage'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element')
}

createRoot(root).render(
  <StrictMode>
    <CityPage />
  </StrictMode>,
)
