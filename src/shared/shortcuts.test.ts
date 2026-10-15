import { describe, expect, it } from 'vitest'
import { ACCEL_PATTERN, GLOBAL_SHORTCUTS, effectiveAccel } from './shortcuts'

describe('shortcuts', () => {
  it('all defaults are valid accelerators', () => {
    for (const s of GLOBAL_SHORTCUTS) expect(ACCEL_PATTERN.test(s.accel)).toBe(true)
  })
  it('accepts sane overrides and rejects junk', () => {
    expect(ACCEL_PATTERN.test('Control+Shift+K')).toBe(true)
    expect(ACCEL_PATTERN.test('Alt+F5')).toBe(true)
    expect(ACCEL_PATTERN.test('K')).toBe(false)
    expect(ACCEL_PATTERN.test('Control+')).toBe(false)
    expect(ACCEL_PATTERN.test('Control+Alt+Enter; rm -rf')).toBe(false)
  })
  it('prefers the override', () => {
    expect(effectiveAccel('toggle-play', {})).toBe('Control+Alt+P')
    expect(effectiveAccel('toggle-play', { 'toggle-play': 'Control+Shift+M' })).toBe('Control+Shift+M')
  })
})
