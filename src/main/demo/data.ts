import type { Track } from '@shared/types'

/** All demo content is original placeholder text written for this project. */

function art(a: string, b: string, c: string, seed: number): string {
  const circles = Array.from({ length: 5 }, (_, i) => {
    const r = 90 + ((seed * 37 + i * 61) % 170)
    const x = (seed * 113 + i * 187) % 600
    const y = (seed * 71 + i * 149) % 600
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? c : b}" opacity="${0.22 + (i % 3) * 0.1}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="n"><feGaussianBlur stdDeviation="26"/></filter></defs><rect width="600" height="600" fill="url(#g)"/><g filter="url(#n)">${circles}</g><circle cx="300" cy="300" r="120" fill="none" stroke="${c}" stroke-opacity=".55" stroke-width="2"/><circle cx="300" cy="300" r="64" fill="${c}" fill-opacity=".8"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const base = { explicit: false, webUrl: null }

export const DEMO_TRACKS: Track[] = [
  {
    ...base,
    id: 'demo:1',
    uri: 'demo:track:1',
    title: 'Glass Hours',
    artists: ['Meridian Hall'],
    album: 'Night Transit',
    releaseYear: 2024,
    durationMs: 192_000,
    artworkUrl: art('#241b4a', '#b45a85', '#f2b987', 1)
  },
  {
    ...base,
    id: 'demo:2',
    uri: 'demo:track:2',
    title: 'Paper Lanterns',
    artists: ['Ora Vale'],
    album: 'Small Weather',
    releaseYear: 2023,
    durationMs: 168_000,
    artworkUrl: art('#0e3a3b', '#2e8b7a', '#e9c46a', 2)
  },
  {
    ...base,
    id: 'demo:3',
    uri: 'demo:track:3',
    title: 'Low Tide Letters',
    artists: ['The Quiet Fields'],
    album: 'Salt & Static',
    releaseYear: 2021,
    durationMs: 210_000,
    artworkUrl: art('#1b2742', '#5b6f9a', '#e0956f', 3)
  },
  {
    ...base,
    id: 'demo:4',
    uri: 'demo:track:4',
    title: 'Interlude (Aurora)',
    artists: ['Meridian Hall'],
    album: 'Night Transit',
    releaseYear: 2024,
    durationMs: 110_000,
    artworkUrl: art('#0a1c26', '#2a6f77', '#9fe0c8', 4)
  }
]

export const DEMO_LYRICS: Record<string, string[]> = {
  'demo:1': [
    'Streetlights hum a quiet tune',
    'Over rooftops, under the moon',
    'I count the hours in the glass',
    'Watching every moment pass',
    '',
    'Hold the evening, hold it slow',
    'Let the city lights go low',
    'Nothing here is meant to last',
    'But we are fast and the night is vast',
    '',
    'Carry me through the turning tide',
    'Where the silver rivers hide',
    'Every window, every door',
    'Opens up a little more',
    '',
    'So I stay till the morning comes',
    'Counting stars like silent drums',
    'Glass hours, glass hours, let them ring',
    'Softly, softly, everything'
  ],
  'demo:2': [
    'Paper lanterns on the lake',
    'Drifting where the soft winds wake',
    'Every wish a tiny flame',
    'None of them will look the same',
    '',
    'Fold the evening, fold it small',
    'Tuck a secret in the wall',
    'Light the string and let it go',
    'Watch the quiet river glow',
    '',
    'Small weather, small weather',
    'Gather up the night together',
    'Rain on the roof like a lullaby',
    'And the lanterns learn to fly'
  ],
  'demo:3': [
    'I wrote you letters in the sand',
    'Pressed them with a careful hand',
    'The tide came in and took them whole',
    'Carried every word and soul',
    '',
    'There is static on the shore',
    'Voices from the days before',
    'Salt on the wind and salt on my skin',
    'Telling me where to begin',
    '',
    'So I write again at the edge of the sea',
    'Letting the water answer me'
  ]
}

export const DEMO_PLAIN_ONLY = new Set(['demo:3'])
export const DEMO_INSTRUMENTAL = new Set(['demo:4'])
export const DEMO_WORD_SYNCED = new Set(['demo:1'])
