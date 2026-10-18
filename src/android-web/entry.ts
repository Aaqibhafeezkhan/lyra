// Android entry: install the phone's `window.lyra` first, then start the same React app as on Windows.
import { ready } from './api'

await ready

document.documentElement.dataset.platform = 'android'

void import('@/main').then(async () => {
  const { useUi, requestMode } = await import('@/store/ui')
  // hardware / gesture Back: close a panel, leave the cinema layout, otherwise let the app go to the background
  window.__lyraNative!.back = () => {
    const ui = useUi.getState()
    if (ui.panel !== 'none') {
      ui.setPanel('none')
      return true
    }
    if (ui.mode === 'full') {
      requestMode('mini')
      return true
    }
    return false
  }
})
