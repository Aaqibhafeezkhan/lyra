/**
 * The page other devices open for TV / party mode: big synced lyrics for whatever Lyra is playing.
 * A single self-contained HTML file (no build step, no external requests) served by the local server.
 */
export const VIEWER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#050505" />
<title>Lyra</title>
<style>
  :root { --a: #ff7a59; --b: #c64cff; --c: #3fd0ff; --ease: cubic-bezier(0.22, 1, 0.36, 1); }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #050505; color: #f5f5f7; font-family: Inter, 'Segoe UI', system-ui, sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
  .bg { position: fixed; inset: -10%; background-size: cover; background-position: center; filter: blur(60px) saturate(1.5) brightness(0.55); transform: scale(1.1); transition: opacity 1s; }
  .bg.plain { background: radial-gradient(60% 60% at 25% 30%, var(--a), transparent 70%), radial-gradient(60% 60% at 80% 70%, var(--b), transparent 70%), radial-gradient(50% 50% at 60% 10%, var(--c), transparent 70%); filter: blur(30px); opacity: 0.6; }
  .shade { position: fixed; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,.35), rgba(0,0,0,.05) 60%, rgba(0,0,0,.3)); }
  main { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(220px, 30vw) 1fr; gap: 4vw; padding: 5vh 5vw; align-items: center; }
  .meta { display: flex; flex-direction: column; gap: 2.2vh; align-self: end; padding-bottom: 4vh; }
  .art { width: 100%; max-width: 380px; aspect-ratio: 1; border-radius: 28px; background: linear-gradient(135deg, var(--a), var(--b)); background-size: cover; background-position: center; box-shadow: 0 40px 100px -30px rgba(0,0,0,.9); }
  .t { font-size: clamp(22px, 2.6vw, 44px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
  .ar { font-size: clamp(15px, 1.5vw, 26px); color: rgba(245,245,247,.65); }
  .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.18); overflow: hidden; max-width: 380px; }
  .bar b { display: block; height: 100%; width: 100%; background: #fff; transform-origin: left; transform: scaleX(0); }
  .lyrics { position: relative; height: 90vh; overflow: hidden; -webkit-mask-image: linear-gradient(180deg, transparent, #000 16%, #000 80%, transparent); mask-image: linear-gradient(180deg, transparent, #000 16%, #000 80%, transparent); }
  .col { transition: transform .85s var(--ease); will-change: transform; }
  .ln { margin: 0 0 2.6vh; font-weight: 800; font-size: clamp(26px, 4vw, 72px); line-height: 1.12; letter-spacing: -0.035em; opacity: .28; transform: scale(.88); transform-origin: left center; transition: opacity .7s, transform .85s var(--ease); }
  .ln.on { opacity: 1; transform: scale(1); }
  .wd { background: linear-gradient(90deg, #fff 0, #fff calc(var(--p, 0) * 114% - 14%), rgba(255,255,255,.34) calc(var(--p, 0) * 114%)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ln:not(.on) .wd { background: none; color: inherit; }
  .msg { position: fixed; left: 0; right: 0; top: 45%; text-align: center; font-size: clamp(20px, 3vw, 44px); font-weight: 700; color: rgba(245,245,247,.7); padding: 0 8vw; }
  .listen { position: fixed; left: 50%; bottom: 3vh; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; z-index: 5; }
  .listen button { font: inherit; font-size: 15px; font-weight: 700; color: #0a0a0a; background: #f5f5f7; border: 0; border-radius: 999px; padding: 12px 22px; cursor: pointer; }
  .listen button:disabled { opacity: .6; }
  #sync { display: none; align-items: center; gap: 6px; color: rgba(245,245,247,.75); font-size: 13px; background: rgba(15,15,18,.6); border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 4px 6px 4px 12px; }
  #sync button { padding: 6px 11px; font-size: 14px; background: rgba(255,255,255,.14); color: #f5f5f7; }
  .dot { position: fixed; right: 18px; top: 14px; width: 10px; height: 10px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 12px #4ade80; opacity: .9; }
  .dot.off { background: #f87171; box-shadow: 0 0 12px #f87171; }
  @media (max-aspect-ratio: 1/1) { main { grid-template-columns: 1fr; grid-template-rows: auto 1fr; padding: 3vh 6vw; } .art { display: none; } .meta { align-self: start; padding: 0; } .lyrics { height: 72vh; } .ln { font-size: clamp(26px, 7.4vw, 56px); } }
</style>
</head>
<body>
<div class="bg plain" id="bg"></div><div class="shade"></div>
<main>
  <div class="meta"><div class="art" id="art"></div><div><div class="t" id="t"></div><div class="ar" id="ar"></div></div><div class="bar"><b id="bar"></b></div></div>
  <div class="lyrics" id="box"><div class="col" id="col"></div></div>
</main>
<div class="msg" id="msg">Waiting for Lyra…</div>
<div class="dot off" id="dot" title="connection"></div>
<audio id="aud" autoplay playsinline></audio>
<div class="listen"><button id="listen" type="button">Listen</button><span id="sync">Lyrics timing <button id="nm" type="button">−</button><b id="nv">0 ms</b><button id="np" type="button">+</button></span></div>
<script>
(() => {
  const K = new URLSearchParams(location.search).get('k') || ''
  const $ = (id) => document.getElementById(id)
  let st = null, lines = [], idx = -1, offset = 0, trackId = '', words = []
  const msg = (t) => { $('msg').textContent = t || ''; $('msg').style.display = t ? '' : 'none' }

  // ---- lyrics (word timing is estimated, like the app does for line-synced lyrics)
  function estimate(ls, dur) {
    return ls.map((l, i) => {
      const end = Math.min((ls[i + 1] ? ls[i + 1].timeMs : (dur || l.timeMs + 4000)) - 120, l.timeMs + 7000)
      const ws = (l.text || '').split(/\s+/).filter(Boolean)
      const total = ws.reduce((n, w) => n + w.length + 1.5, 0) || 1
      let at = l.timeMs
      return { start: l.timeMs, text: l.text, words: ws.map((w) => { const from = at; at += ((w.length + 1.5) / total) * Math.max(300, end - l.timeMs); return { w, from, to: at } }) }
    })
  }
  function render() {
    const col = $('col')
    col.innerHTML = ''
    lines.forEach((l) => {
      const p = document.createElement('p'); p.className = 'ln'
      if (l.words.length) l.words.forEach((w, i) => { const s = document.createElement('span'); s.className = 'wd'; s.textContent = w.w; p.appendChild(s); if (i < l.words.length - 1) p.appendChild(document.createTextNode(' ')) })
      else p.textContent = '♪'
      col.appendChild(p)
    })
    idx = -2
  }
  async function loadLyrics() {
    lines = []; render(); msg('')
    try {
      const r = await (await fetch('/lyrics?k=' + K)).json()
      if (r.status === 'synced' && r.lines.length) { lines = estimate(r.lines, st && st.durationMs); render() }
      else if (r.status === 'instrumental') msg('Instrumental ♪')
      else msg(r.status === 'error' ? 'Lyrics couldn’t load' : 'No synced lyrics for this song')
    } catch { msg('Lyrics couldn’t load') }
  }

  // ---- clock
  let skew = 0 // server clock minus this device's clock
  const pos = () => { if (!st) return 0; const now = Date.now() + skew; return Math.max(0, st.positionMs + (st.playing ? now - st.sampledAt : 0) + offset - (listening ? lag : 0) + nudge) }

  // ---- connection
  function connect() {
    const es = new EventSource('/events?k=' + K)
    es.onopen = () => $('dot').classList.remove('off')
    es.onerror = () => { $('dot').classList.add('off'); es.close(); setTimeout(connect, 2000) }
    es.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.now) skew = m.now - Date.now()
      if (m.type !== 'state') return
      const changed = !st || st.trackId !== m.trackId
      st = m
      if (!m.trackId) { $('t').textContent = ''; $('ar').textContent = ''; lines = []; render(); msg('Play a song in Spotify'); trackId = ''; return }
      if (changed) {
        trackId = m.trackId
        $('t').textContent = m.title; $('ar').textContent = m.artists
        $('art').style.backgroundImage = m.hasArt ? 'url(/art?k=' + K + '&t=' + encodeURIComponent(m.trackId) + ')' : ''
        const bg = $('bg'); if (m.hasArt) { bg.classList.remove('plain'); bg.style.backgroundImage = $('art').style.backgroundImage } else { bg.classList.add('plain'); bg.style.backgroundImage = '' }
        loadLyrics()
      }
    }
  }

  // ---- Jam nearby: listen to the PC's sound over the local network (WebRTC, no internet)
  let listening = false, lag = 0
  let nudge = Number(localStorage.getItem('lyra.nudge') || 0)
  const setNudge = (v) => { nudge = Math.max(-1500, Math.min(1500, v)); localStorage.setItem('lyra.nudge', String(nudge)); $('nv').textContent = (nudge > 0 ? '+' : '') + nudge + ' ms' }
  async function listen() {
    const btn = $('listen')
    if (listening) { location.reload(); return }
    btn.textContent = 'Connecting…'; btn.disabled = true
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.addTransceiver('audio', { direction: 'recvonly' })
      const audio = $('aud')
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}) }
      await pc.setLocalDescription(await pc.createOffer())
      await new Promise((res) => {
        if (pc.iceGatheringState === 'complete') return res()
        const t = setTimeout(res, 2000)
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res() } }
      })
      const r = await fetch('/rtc/offer?k=' + K, { method: 'POST', body: JSON.stringify(pc.localDescription) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not start the sound.')
      await pc.setRemoteDescription(j)
      pc.getReceivers().forEach((rc) => { try { rc.playoutDelayHint = 0 } catch (e) {} })
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { btn.disabled = false; btn.textContent = 'Sound lost. Tap to retry'; listening = false; lag = 0; $('sync').style.display = 'none' } }
      listening = true; btn.disabled = false; btn.textContent = 'Sound on'
      $('sync').style.display = 'flex'; setNudge(nudge)
      // measure the delay between the PC and this speaker so the lyrics can wait for the sound
      let last = null
      setInterval(async () => {
        const stats = await pc.getStats()
        let jb = 0, rtt = 0
        stats.forEach((s) => {
          if (s.type === 'inbound-rtp' && s.kind === 'audio' && s.jitterBufferEmittedCount) { if (last) { const dn = s.jitterBufferEmittedCount - last.n; if (dn > 0) jb = (s.jitterBufferDelay - last.d) / dn * 1000 } last = { n: s.jitterBufferEmittedCount, d: s.jitterBufferDelay } }
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime) rtt = s.currentRoundTripTime * 1000
        })
        if (jb) lag = lag ? lag * 0.7 + (jb + rtt / 2 + 30) * 0.3 : jb + rtt / 2 + 30
      }, 2000)
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Listen'
      msg((e && e.message) || 'Could not start the sound.')
      setTimeout(() => { if (!st || !st.trackId) return; msg('') }, 5000)
    }
  }
  $('listen').addEventListener('click', listen)
  $('nm').addEventListener('click', () => setNudge(nudge - 50))
  $('np').addEventListener('click', () => setNudge(nudge + 50))

  // ---- frame loop
  function frame() {
    if (st && st.trackId) {
      const p = pos()
      let i = -1
      for (let k = 0; k < lines.length; k++) if (p >= lines[k].start) i = k
      const els = $('col').children
      if (i !== idx) {
        idx = i
        for (let k = 0; k < els.length; k++) els[k].classList.toggle('on', k === i)
        const cur = els[Math.max(0, i)]
        if (cur) $('col').style.transform = 'translateY(' + -(cur.offsetTop - $('box').clientHeight * 0.32) + 'px)'
      }
      const l = lines[i]
      if (l && els[i]) { const sp = els[i].children; for (let k = 0; k < sp.length && l.words[k]; k++) { const w = l.words[k]; sp[k].style.setProperty('--p', Math.min(1, Math.max(0, (p - w.from) / Math.max(1, w.to - w.from))).toFixed(2)) } }
      $('bar').style.transform = 'scaleX(' + (st.durationMs ? Math.min(1, p / st.durationMs) : 0) + ')'
    }
    requestAnimationFrame(frame)
  }
  addEventListener('resize', () => { idx = -2 })
  connect(); frame()
  // keep the screen awake on TVs / phones
  try { navigator.wakeLock && navigator.wakeLock.request('screen') } catch {}
})()
</script>
</body>
</html>`
