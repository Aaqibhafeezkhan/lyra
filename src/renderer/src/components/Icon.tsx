import type { CSSProperties } from 'react'

type Def = { d: string; fill?: boolean; flip?: boolean; extra?: string }

const ICONS = {
  play: { d: 'M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z', fill: true },
  pause: { d: 'M7 5.5h3.4v13H7zM13.6 5.5H17v13h-3.4z', fill: true },
  next: { d: 'M5 6.3v11.4a.8.8 0 0 0 1.25.66l8.5-5.7a.8.8 0 0 0 0-1.32l-8.5-5.7A.8.8 0 0 0 5 6.3zM17.5 5.5h2v13h-2z', fill: true },
  prev: { d: 'M5 6.3v11.4a.8.8 0 0 0 1.25.66l8.5-5.7a.8.8 0 0 0 0-1.32l-8.5-5.7A.8.8 0 0 0 5 6.3zM17.5 5.5h2v13h-2z', fill: true, flip: true },
  shuffle: { d: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5' },
  repeat: { d: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3' },
  repeatOne: { d: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M11 10l1.5-1v6' },
  heart: { d: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z' },
  expand: { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
  collapse: { d: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' },
  fullscreen: { d: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' },
  exitFullscreen: { d: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' },
  queue: { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  settings: { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  close: { d: 'M18 6 6 18M6 6l12 12' },
  minus: { d: 'M5 12h14' },
  external: { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3' },
  film: { d: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4' },
  share: { d: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14' },
  bookmark: { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
  volume: { d: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14' },
  volumeLow: { d: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7' },
  volumeMute: { d: 'M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6' },
  mic: { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8' },
  note: { d: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  chevronDown: { d: 'm6 9 6 6 6-6' },
  chevronLeft: { d: 'm15 18-6-6 6-6' },
  refresh: { d: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15' },
  type: { d: 'M4 7V4h16v3M9 20h6M12 4v16' },
  check: { d: 'M20 6 9 17l-5-5' },
  copy: { d: 'M9 9h11v11H9zM5 15H4V4h11v1' },
  alert: { d: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  wifiOff: { d: 'M1 1l22 22M16.7 11.1A11 11 0 0 1 21.6 14M5 12.9A11 11 0 0 1 8.5 11M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.7-2.9M8.5 16.1a6 6 0 0 1 7 0M12 20h.01' },
  link: { d: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' },
  trash: { d: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6' }
} satisfies Record<string, Def>

export type IconName = keyof typeof ICONS

interface Props {
  name: IconName
  size?: number
  filled?: boolean
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 18, filled, className, style }: Props) {
  const def: Def = ICONS[name]
  const solid = filled ?? def.fill
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={def.fill ? 'currentColor' : 'currentColor'}
      strokeWidth={def.fill ? 0.6 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ transform: def.flip ? 'scaleX(-1)' : undefined, flexShrink: 0, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={def.d} />
    </svg>
  )
}
