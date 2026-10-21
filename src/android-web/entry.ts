// Android entry: install the phone's `window.lyra` first, then start the same React app as on Windows.
import { ready } from './api'

await ready

document.documentElement.dataset.platform = 'android'
if (new URLSearchParams(location.search).has('overlay')) document.documentElement.dataset.overlay = '1'

const params = new URLSearchParams(location.search)

if (params.has('record')) {
  // the page Android films for a lyric video (clean lyrics + the song's video)
  document.documentElement.dataset.ambient = '1'
  await import('./record')
} else if (params.has('ambient')) {
  // the dim always-on-display style screen (also used by the screen saver)
  document.documentElement.dataset.ambient = '1'
  await import('./ambient')
} else {
  void import('@/main').then(async () => {
    const { startLyricNotifier } = await import('./lyricNotifier')
    startLyricNotifier()
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
}
