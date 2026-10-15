import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Backdrop } from '@/components/Backdrop'
import { CompactWidget } from '@/components/CompactWidget'
import { FullscreenPlayer } from '@/components/FullscreenPlayer'
import { MiniPlayer } from '@/components/MiniPlayer'
import { ResizeGrip } from '@/components/ResizeGrip'
import { SidePanel } from '@/components/SidePanel'
import { Toasts } from '@/components/Toasts'
import { useArtwork, usePalette } from '@/hooks/useArtwork'
import { useReducedMotion } from '@/hooks/useMotion'
import { NEUTRAL_PALETTE } from '@/lib/palette'
import { fillWindow, isAnimating, runTransition, shell } from '@/lib/shell'
import { useLyrics } from '@/store/lyrics'
import { OFFSET_STEP_MS, nudgeSongOffset } from '@/store/offsets'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { requestMode, useUi } from '@/store/ui'

function useBoot(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let off: Array<() => void> = []
    void (async () => {
      const api = window.lyra
      await useSettings.getState().init()
      await usePlayer.getState().init()
      useLyrics.getState().init()
      useUi.getState().setMode(await api.window.getMode())
      off = [
        api.window.onMode((e) => {
          useUi.getState().setMode(e.mode)
          if (!e.from || !e.to) return fillWindow()
          const reduced = useSettings.getState().settings.reducedMotion === 'on' || (useSettings.getState().settings.reducedMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          const to = e.to
          void runTransition(e.from, to, reduced).then(() => {
            // The window is still big here; shrinking it moves its origin to `to`, so the shell jumps to 0,0 at once.
            api.window.settle()
            if (to.x === 0 && to.y === 0) requestAnimationFrame(fillWindow)
          })
        }),
        api.app.onCommand((c) => {
          const p = usePlayer.getState()
          if (c === 'toggle-play') p.toggle()
          else if (c === 'next') void p.command({ type: 'next' })
          else if (c === 'previous') void p.command({ type: 'previous' })
          else if (c === 'open-settings') useUi.getState().setPanel('settings')
        })
      ]
      setReady(true)
    })()
    return () => off.forEach((f) => f())
  }, [])
  return ready
}

/** Writes artwork-derived colours to CSS variables so every surface can use them. */
function useThemeVars(): void {
  const theme = useSettings((s) => s.settings.theme)
  const url = usePlayer((s) => s.snapshot?.track?.artworkUrl ?? null)
  const art = useArtwork(url)
  const pal = usePalette(art)
  useEffect(() => {
    const p = theme === 'adaptive' ? pal : NEUTRAL_PALETTE
    const r = document.documentElement.style
    r.setProperty('--accent', theme === 'light' ? '#3a3a3a' : p.accent)
    r.setProperty('--tint1', p.tint1)
    r.setProperty('--tint2', p.tint2)
  }, [pal, theme])
}

function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input[type="text"], textarea') || e.ctrlKey || e.metaKey || e.altKey) return
      const onControl = !!t.closest('button, [role="slider"], input[type="range"]')
      const p = usePlayer.getState()
      const ui = useUi.getState()

      switch (e.key) {
        case ' ':
          if (onControl) return
          e.preventDefault()
          p.toggle()
          break
        case 'ArrowRight':
        case 'ArrowLeft': {
          if (t.closest('input[type="range"]')) return
          e.preventDefault()
          const fwd = e.key === 'ArrowRight'
          if (e.shiftKey) void p.command({ type: fwd ? 'next' : 'previous' })
          else p.seek(getNow() + (fwd ? 5000 : -5000))
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (t.closest('input[type="range"]') || !p.snapshot?.device) return
          e.preventDefault()
          p.setVolume(Math.min(100, Math.max(0, (p.snapshot.device.volumePercent ?? 0) + (e.key === 'ArrowUp' ? 5 : -5))))
          break
        }
        case 'f':
        case 'F':
          requestMode(ui.mode === 'full' ? 'mini' : 'full')
          break
        case 'd':
        case 'D':
          if (ui.mode === 'full') ui.toggleDistractionFree()
          break
        case '[':
        case ']': {
          nudgeSongOffset(e.key === ']' ? OFFSET_STEP_MS : -OFFSET_STEP_MS)
          break
        }
        case 'Escape':
          if (ui.panel !== 'none') ui.setPanel('none')
          else if (ui.mode === 'full') requestMode('mini')
          else if (ui.mode === 'mini') requestMode(useSettings.getState().settings.defaultMode === 'mini' ? 'compact' : useSettings.getState().settings.defaultMode)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function getNow(): number {
  const s = usePlayer.getState().snapshot
  if (!s) return 0
  return s.positionMs + (s.isPlaying ? Date.now() - s.sampledAt : 0)
}

export default function App() {
  const ready = useBoot()
  const mode = useUi((s) => s.mode)
  const settings = useSettings((s) => s.settings)
  const reduced = useReducedMotion()
  const [faded, setFaded] = useState(false)
  useThemeVars()
  useHotkeys()

  // Fade the small widget when the cursor leaves it (optional).
  useEffect(() => {
    if (!settings.autoHide || mode === 'full' || mode === 'mini') {
      setFaded(false)
      return
    }
    let t: ReturnType<typeof setTimeout>
    const leave = (): void => {
      clearTimeout(t)
      t = setTimeout(() => setFaded(true), 1200)
    }
    const enter = (): void => {
      clearTimeout(t)
      setFaded(false)
    }
    document.addEventListener('mouseleave', leave)
    document.addEventListener('mouseenter', enter)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mouseleave', leave)
      document.removeEventListener('mouseenter', enter)
    }
  }, [settings.autoHide, mode])

  useEffect(() => {
    const onResize = (): void => {
      if (!isAnimating()) fillWindow()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!ready) return null

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <div
        className="root"
        data-theme={settings.theme}
        data-mode={mode}
        data-reduced={reduced || undefined}
        data-faded={faded || undefined}
        style={{ ['--alpha' as string]: mode === 'full' ? 1 : settings.opacity }}
      >
        <motion.div className="shell" style={{ x: shell.x, y: shell.y, width: shell.width, height: shell.height }}>
          <Backdrop rich={mode === 'full'} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode === 'minimal' || mode === 'compact' ? 'widget' : mode}
              className="content"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.12 } }}
            >
              {mode === 'full' ? (
                <FullscreenPlayer />
              ) : mode === 'mini' ? (
                <MiniPlayer />
              ) : (
                <CompactWidget minimal={mode === 'minimal'} />
              )}
            </motion.div>
          </AnimatePresence>
          {(mode === 'mini' || mode === 'full') && <SidePanel />}
          <Toasts />
          {(mode === 'mini' || mode === 'compact' || mode === 'minimal') && <ResizeGrip />}
        </motion.div>
      </div>
    </MotionConfig>
  )
}
