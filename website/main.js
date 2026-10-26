/* Lyra website: live demo engine, release links, reveal + tilt effects. No dependencies. */
const REPO = 'DhruvHarani1/lyra'
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- demo songs (made up, original lyrics) ---------- */
const SONGS = [
  {
    title: 'Glass Hours', artist: 'Meridian Hall', dur: 62, pal: ['#ff7a59', '#c64cff', '#3fd0ff'],
    lines: [
      [1, 'Streetlights hum a quiet tune'], [5.5, 'while the city folds into blue'], [10, 'I keep your name behind my teeth'],
      [14.5, 'like a coin I cannot spend'], [19, 'Play it slow, let the glass hours drip'], [24, 'every second a small bright thing'],
      [29, 'we were never really lost'], [33.5, 'just early for the morning'], [38, 'Hold the light a little longer'],
      [43, 'let the engines fade to rain'], [48, 'Say it once and say it softly'], [53, 'we will find the way again'], [58, 'glass hours, glass hours']
    ]
  },
  {
    title: 'Neon Rain', artist: 'Kairo', dur: 60, pal: ['#3fd0ff', '#6b5cff', '#ff4fa3'],
    lines: [
      [1, 'Neon rain on the window pane'], [5, 'every colour running down'], [9.5, 'I am a ghost in a taxi light'],
      [14, 'headed for the edge of town'], [18.5, 'Turn the radio up, turn the world down'], [23.5, 'we are all just signal and noise'],
      [28.5, 'but you sing it like it matters'], [33, 'and for a minute it does'], [38, 'Neon rain, wash me clean'],
      [43, 'leave the shine and take the doubt'], [48, 'Neon rain, I am still here'], [53, 'when the last light flickers out']
    ]
  },
  {
    title: 'Slow Orbit', artist: 'Vela', dur: 64, pal: ['#ffd84a', '#ff7a59', '#9a5cff'],
    lines: [
      [1, 'We drift in a slow orbit'], [5.5, 'around a sun we cannot name'], [10, 'Every night the same horizon'],
      [14.5, 'every night a different flame'], [19.5, 'Hold my hand across the dark'], [24.5, 'gravity will do the rest'],
      [29.5, 'I was never good at leaving'], [34, 'you were never good at less'], [39, 'So we circle, so we shine'],
      [44, 'two small lights in endless space'], [49.5, 'If the universe is listening'], [54.5, 'let it hum this one more phase'], [59.5, 'slow orbit']
    ]
  }
]
for (const s of SONGS) {
  s.lines = s.lines.map(([t, text], i, a) => {
    const start = t * 1000
    const end = (a[i + 1] ? a[i + 1][0] : s.dur) * 1000 - 250
    const words = text.split(' ')
    const total = words.reduce((n, w) => n + w.length + 1.5, 0)
    let at = start
    const ws = words.map((w) => {
      const from = at
      at += ((w.length + 1.5) / total) * (end - start)
      return { w, from, to: at }
    })
    return { start, end, text, words: ws }
  })
}

const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
}

/* ---------- engine ---------- */
const S = { i: 0, t: 0, playing: true, idx: -1 }
const views = []

const lineHTML = (l) => `<p class="ln">${l.words.map((w) => `<span class="wd">${w.w}</span>`).join(' ')}</p>`
const ctl = () => `<div class="ctl"><button data-act="prev" aria-label="Previous">${ICON.prev}</button><button class="pp" data-act="pp" aria-label="Play or pause">${ICON.pause}</button><button data-act="next" aria-label="Next">${ICON.next}</button></div>`

const TEMPLATES = {
  mini: () => `<div class="w-head"><div class="cover"></div><div><div class="t-title"></div><div class="t-artist"></div></div></div>
    <div class="w-lyrics"><div class="col"></div></div><div class="progress"><b></b></div>${ctl()}`,
  full: () => `<div class="fs"><div class="fs__bg"></div><div class="fs__shade"></div><div class="fs__lyrics"><div class="col"></div></div>
    <div class="fs__bar"><div class="cover"></div><div class="meta2"><div class="t-title"></div><div class="t-artist"></div><div class="progress"><b></b></div></div>${ctl()}</div></div>`,
  phone: () => `<div class="p-screen"><span class="p-notch"></span><div class="p-clock"></div><div class="p-date"></div>
    <div class="p-lyrics"><div class="col"></div></div>
    <div class="p-foot"><div class="cover"></div><div><div class="t-title"></div><div class="t-artist"></div></div></div><div class="p-bar"><b></b></div></div>`
}
TEMPLATES.phone2 = TEMPLATES.phone

function mount(el) {
  const kind = el.dataset.bind
  el.innerHTML = TEMPLATES[kind]()
  const v = {
    el, kind,
    col: el.querySelector('.col'),
    box: el.querySelector('.col').parentElement,
    title: el.querySelectorAll('.t-title'),
    artist: el.querySelectorAll('.t-artist'),
    bar: el.querySelector('.progress b, .p-bar b'),
    pp: el.querySelector('.pp'),
    clock: el.querySelector('.p-clock'),
    date: el.querySelector('.p-date'),
    lns: []
  }
  views.push(v)
}

function fillSong() {
  const s = SONGS[S.i]
  const r = document.documentElement.style
  r.setProperty('--c1', s.pal[0]); r.setProperty('--c2', s.pal[1]); r.setProperty('--c3', s.pal[2])
  for (const v of views) {
    v.col.innerHTML = s.lines.map(lineHTML).join('')
    v.lns = [...v.col.children]
    v.title.forEach((n) => (n.textContent = s.title))
    v.artist.forEach((n) => (n.textContent = s.artist))
    v.lns.forEach((p, i) => p.addEventListener('click', () => seek(s.lines[i].start)))
  }
  document.querySelectorAll('#songs button').forEach((b, i) => b.classList.toggle('is-on', i === S.i))
  S.idx = -1
  place(true)
}

function place(force) {
  const s = SONGS[S.i]
  let idx = -1
  for (let i = 0; i < s.lines.length; i++) if (S.t >= s.lines[i].start) idx = i
  if (idx === S.idx && !force) return
  S.idx = idx
  for (const v of views) {
    v.lns.forEach((p, i) => {
      p.classList.toggle('on', i === idx)
      p.classList.toggle('past', i < idx)
    })
    const cur = v.lns[Math.max(0, idx)]
    if (cur) v.col.style.transform = `translateY(${-(cur.offsetTop - v.box.clientHeight * 0.34)}px)`
  }
}

function words(now) {
  const s = SONGS[S.i]
  const l = s.lines[S.idx]
  if (!l) return
  for (const v of views) {
    const p = v.lns[S.idx]
    if (!p) continue
    const spans = p.children
    for (let k = 0; k < spans.length; k++) {
      const w = l.words[k]
      spans[k].style.setProperty('--p', Math.min(1, Math.max(0, (now - w.from) / Math.max(1, w.to - w.from))).toFixed(2))
    }
  }
}

function seek(ms) {
  S.t = ms
  place(true)
}
function go(d) {
  S.i = (S.i + d + SONGS.length) % SONGS.length
  S.t = 0
  fillSong()
}
function setPlaying(p) {
  S.playing = p
  for (const v of views) if (v.pp) v.pp.innerHTML = p ? ICON.pause : ICON.play
}

let last = performance.now()
function frame(ts) {
  const dt = ts - last
  last = ts
  if (S.playing) {
    S.t += Math.min(dt, 100)
    if (S.t > SONGS[S.i].dur * 1000) go(1)
  }
  place(false)
  words(S.t)
  const frac = S.t / (SONGS[S.i].dur * 1000)
  for (const v of views) if (v.bar) v.bar.style.transform = `scaleX(${frac.toFixed(4)})`
  requestAnimationFrame(frame)
}

function clocks() {
  const d = new Date()
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const date = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  for (const v of views) {
    if (v.clock) v.clock.textContent = t
    if (v.date) v.date.textContent = date
  }
  const c = document.getElementById('amb-clock')
  if (c) c.textContent = t
}

/* ---------- boot ---------- */
document.querySelectorAll('[data-bind]').forEach(mount)

const songBox = document.getElementById('songs')
songBox.innerHTML = SONGS.map((s, i) => `<button data-i="${i}" style="--a:${s.pal[0]};--b:${s.pal[1]}"><i></i>${s.title}</button>`).join('')
songBox.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  S.i = Number(b.dataset.i)
  S.t = 0
  fillSong()
})

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')
  if (!a) return
  if (a.dataset.act === 'pp') setPlaying(!S.playing)
  if (a.dataset.act === 'next') go(1)
  if (a.dataset.act === 'prev') go(-1)
})

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('is-on', x === b))
  document.getElementById('demo-box').dataset.view = b.dataset.view
  requestAnimationFrame(() => place(true))
})

fillSong()
clocks()
setInterval(clocks, 15000)
requestAnimationFrame(frame)
addEventListener('resize', () => place(true))

/* ---------- scroll reveal ---------- */
const io = new IntersectionObserver(
  (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
  { threshold: 0.12 }
)
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 70}ms`
  io.observe(el)
})

/* ---------- 3D tilt on the hero devices ---------- */
if (!reduce && matchMedia('(pointer: fine)').matches) {
  const stage = document.getElementById('hero-stage')
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    stage.querySelectorAll('.tilt').forEach((t, i) => {
      const k = i ? 1.4 : 1
      t.style.transform = `rotateY(${x * 14 * k}deg) rotateX(${-y * 10 * k}deg)`
    })
  })
  stage.addEventListener('pointerleave', () => stage.querySelectorAll('.tilt').forEach((t) => (t.style.transform = '')))
}

/* ---------- downloads: newest Windows and Android releases from GitHub ---------- */
const isAndroid = /android/i.test(navigator.userAgent)
if (isAndroid) {
  const w = document.getElementById('cta-win'), a = document.getElementById('cta-and')
  a.classList.remove('btn--ghost'); w.classList.add('btn--ghost')
  a.parentElement.prepend(a)
}
;(async () => {
  try {
    const rs = await (await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`)).json()
    const pick = (re, ext) => {
      const r = rs.find((x) => !x.draft && re.test(x.tag_name) && x.assets.some((a) => a.name.endsWith(ext)))
      return r && { v: r.tag_name.replace(/^\D+/, ''), url: r.assets.find((a) => a.name.endsWith(ext)).browser_download_url, size: r.assets.find((a) => a.name.endsWith(ext)).size }
    }
    const win = pick(/^v\d/, '.exe'), and = pick(/^android-v/, '.apk')
    const mb = (n) => `${(n / 1048576).toFixed(0)} MB`
    if (win) {
      document.getElementById('dl-win').href = win.url
      document.getElementById('cta-win').href = win.url
      document.getElementById('dl-win-v').textContent = `Version ${win.v} · ${mb(win.size)} · Windows 10 / 11`
      document.getElementById('v-win').textContent = `Windows ${win.v}`
    }
    if (and) {
      document.getElementById('dl-and').href = and.url
      document.getElementById('cta-and').href = and.url
      document.getElementById('dl-and-v').textContent = `Version ${and.v} · ${mb(and.size)} · Android 8+`
      document.getElementById('v-and').textContent = `Android ${and.v}`
    }
  } catch { /* offline or rate limited: the buttons keep pointing at the releases page */ }
})()

/* ---------- reel: recordings of the real app ---------- */
const reelVideo = document.getElementById('reel-video')
document.getElementById('reel-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  const k = b.dataset.clip
  document.querySelectorAll('#reel-tabs button').forEach((x) => x.classList.toggle('is-on', x === b))
  document.getElementById('reel-box').classList.toggle('is-tall', k === 'widget')
  b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  reelVideo.poster = `assets/poster-${k}.jpg`
  reelVideo.src = `assets/clip-${k}.mp4`
  reelVideo.play().catch(() => {})
})
// play only while visible (saves battery and bandwidth)
new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? reelVideo.play().catch(() => {}) : reelVideo.pause())), { threshold: 0.25 }).observe(reelVideo)

/* ---------- whole song: pause when scrolled away ---------- */
{
  const v = document.getElementById('song-video')
  new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting && !v.paused) v.pause() }), { threshold: 0.1 }).observe(v)
}

/* ---------- Vega: newest release links ---------- */
;(async () => {
  try {
    const rs = await (await fetch('https://api.github.com/repos/DhruvHarani1/vega/releases?per_page=10')).json()
    const r = rs.find((x) => !x.draft && x.assets.some((a) => a.name.endsWith('.exe')))
    if (!r) return
    const exe = r.assets.find((a) => a.name.endsWith('.exe')), apk = r.assets.find((a) => a.name.endsWith('.apk'))
    const mb = (n) => `${(n / 1048576).toFixed(0)} MB`
    const v = r.tag_name.replace(/^\D+/, '')
    document.getElementById('vega-win').href = exe.browser_download_url
    document.getElementById('vega-win').textContent = `Download for Windows · ${v}`
    if (apk) {
      document.getElementById('vega-and').href = apk.browser_download_url
      document.getElementById('vega-and').textContent = `Download for Android · ${v}`
    }
    document.getElementById('vega-meta').textContent = `Version ${v} · Windows ${mb(exe.size)}${apk ? ` · Android ${mb(apk.size)}` : ''} · free and open source`
  } catch { /* keep the releases page links */ }
})()

/* ---------- smooth scrolling (mouse wheel and in-page links) ---------- */
if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const root = document.documentElement
  root.classList.add('has-smooth')
  let target = scrollY, cur = scrollY, raf = 0
  const max = () => root.scrollHeight - innerHeight
  const clamp = (v) => Math.max(0, Math.min(max(), v))
  const tick = () => {
    const d = target - cur
    if (Math.abs(d) < 0.4) { cur = target; scrollTo(0, cur); raf = 0; return }
    cur += d * 0.11
    scrollTo(0, cur)
    raf = requestAnimationFrame(tick)
  }
  const go = (y) => { target = clamp(y); if (!raf) raf = requestAnimationFrame(tick) }
  addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    // leave nested scrollers (video controls, horizontally scrolling tabs) alone
    if (e.target.closest && e.target.closest('video, .tabs--scroll')) return
    e.preventDefault()
    const k = e.deltaMode === 1 ? 34 : e.deltaMode === 2 ? innerHeight : 1
    if (!raf) { cur = target = scrollY }
    go(target + e.deltaY * k * 0.9)
  }, { passive: false })
  // keyboard, scrollbar drag, find-in-page: follow the real position when we are not animating
  addEventListener('scroll', () => { if (!raf) cur = target = scrollY }, { passive: true })
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    const id = a.getAttribute('href').slice(1)
    const el = id ? document.getElementById(id) : document.body
    if (!el) return
    e.preventDefault()
    if (!raf) cur = scrollY
    go(id && id !== 'top' ? el.getBoundingClientRect().top + scrollY - 70 : 0)
    history.replaceState(null, '', id ? `#${id}` : location.pathname)
  })
}
