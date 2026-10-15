import { animate, motionValue } from 'framer-motion'
import type { Rect } from '@shared/types'

/**
 * The visible "shell" (rounded glass panel) is positioned inside the transparent window with motion
 * values. Mode changes animate it between two rectangles while the OS window stays put, which is far
 * smoother than resizing a transparent window every frame.
 */
export const shell = {
  x: motionValue(0),
  y: motionValue(0),
  width: motionValue(window.innerWidth),
  height: motionValue(window.innerHeight)
}

const KEYS = ['x', 'y', 'width', 'height'] as const
let running: Array<{ stop(): void }> = []
let token = 0

function stopAll(): void {
  running.forEach((r) => r.stop())
  running = []
}

/** Fill the whole window (the steady state). */
export function fillWindow(): void {
  stopAll()
  shell.x.set(0)
  shell.y.set(0)
  shell.width.set(window.innerWidth)
  shell.height.set(window.innerHeight)
}

function setRect(r: Rect): void {
  shell.x.set(r.x)
  shell.y.set(r.y)
  shell.width.set(r.width)
  shell.height.set(r.height)
}

export const isAnimating = (): boolean => running.length > 0

/** Animate the shell from one rectangle to another; resolves when finished (or interrupted). */
export function runTransition(from: Rect, to: Rect, instant: boolean): Promise<void> {
  stopAll()
  const mine = ++token
  setRect(from)
  if (instant) {
    setRect(to)
    return Promise.resolve()
  }
  const anims = KEYS.map((k) => {
    const target = k === 'x' ? to.x : k === 'y' ? to.y : k === 'width' ? to.width : to.height
    return animate(shell[k], target, { duration: 0.3, ease: [0.22, 1, 0.36, 1] })
  })
  running = anims
  return Promise.all(anims.map((a) => a.then(() => undefined))).then(() => {
    if (token === mine) running = []
  })
}
