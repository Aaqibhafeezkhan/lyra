import { describe, expect, it } from 'vitest'
import { drawMotionBackground, type MotionStyle } from './scene'

function frameOperations(style: MotionStyle, t = 3, filmGrain = false): unknown[][] {
  const operations: unknown[][] = []
  const gradient = (kind: string) => ({ addColorStop: (offset: number, color: string) => operations.push([kind + ':stop', offset, color]) })
  const ctx = {
    save: () => operations.push(['save']),
    restore: () => operations.push(['restore']),
    fillRect: (...args: number[]) => operations.push(['fillRect', ...args]),
    createLinearGradient: (...args: number[]) => { operations.push(['linear', ...args]); return gradient('linear') },
    createRadialGradient: (...args: number[]) => { operations.push(['radial', ...args]); return gradient('radial') },
    beginPath: () => operations.push(['beginPath']),
    arc: (...args: number[]) => operations.push(['arc', ...args]),
    fill: () => operations.push(['fill']),
    set fillStyle(value: unknown) { operations.push(['fillStyle', typeof value === 'string' ? value : 'gradient']) },
    set globalAlpha(value: number) { operations.push(['alpha', value]) }
  }
  drawMotionBackground(ctx as unknown as CanvasRenderingContext2D, 320, 180, t, '#171827', '#090a12', '#a78bfa', style, filmGrain)
  return operations
}

describe('drawMotionBackground', () => {
  it.each(['aurora', 'gradient', 'particles'] as const)('%s produces a repeatable frame at a fixed timestamp', (style) => {
    expect(frameOperations(style, 3.25)).toEqual(frameOperations(style, 3.25))
  })

  it('changes motion as time advances', () => {
    expect(frameOperations('aurora', 1)).not.toEqual(frameOperations('aurora', 5))
    expect(frameOperations('gradient', 1)).not.toEqual(frameOperations('gradient', 5))
    expect(frameOperations('particles', 1)).not.toEqual(frameOperations('particles', 5))
  })

  it('keeps the three background styles visually distinct', () => {
    expect(frameOperations('aurora')).not.toEqual(frameOperations('gradient'))
    expect(frameOperations('particles')).not.toEqual(frameOperations('gradient'))
  })

  it('adds a deterministic grain pass when enabled', () => {
    const clean = frameOperations('gradient', 3.25, false)
    const grain = frameOperations('gradient', 3.25, true)
    expect(grain).not.toEqual(clean)
    expect(grain.filter((op) => op[0] === 'fillRect').length - clean.filter((op) => op[0] === 'fillRect').length).toBe(180)
    expect(grain).toEqual(frameOperations('gradient', 3.25, true))
  })
})
