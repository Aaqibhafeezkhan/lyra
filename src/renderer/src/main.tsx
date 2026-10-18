import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/widget.css'
import './styles/player.css'
import './styles/lyrics.css'
import './styles/panels.css'
import './styles/android.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
