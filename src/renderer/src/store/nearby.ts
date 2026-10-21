import { create } from 'zustand'

/**
 * Jam nearby (host side): when "Stream sound" is on, devices on the same Wi-Fi that open the TV-mode link can
 * press "Listen" and receive this PC's sound over a direct WebRTC link. Only the PC's own audio is captured
 * (system loopback); no video, nothing is sent outside the local network.
 */
interface NearbyStore {
  listeners: number
  error: string | null
  init(): () => void
}

let stream: MediaStream | null = null
const peers = new Set<RTCPeerConnection>()

async function getAudio(): Promise<MediaStream> {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream
  // the main process answers this request with the system's sound ("loopback"); the video part is thrown away
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints })
  s.getVideoTracks().forEach((t) => {
    t.stop()
    s.removeTrack(t)
  })
  if (s.getAudioTracks().length === 0) throw new Error('This PC did not provide system sound.')
  stream = s
  return s
}

function releaseIfIdle(): void {
  if (peers.size === 0 && stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
}

/** Lower the latency a little and keep stereo music quality. */
function tuneOpus(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) => {
    if (!/useinbandfec|minptime/.test(params)) return line
    const extra = ['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=192000', 'usedtx=0'].filter((p) => !params.includes(p.split('=')[0]!))
    return `a=fmtp:${pt} ${params};${extra.join(';')}`
  })
}

export const useNearby = create<NearbyStore>((set) => ({
  listeners: 0,
  error: null,
  init() {
    return window.lyra.lan.onOffer(({ id, offer }) => {
      void (async () => {
        try {
          const audio = await getAudio()
          const pc = new RTCPeerConnection({ iceServers: [] }) // same network: no STUN/TURN needed
          peers.add(pc)
          const done = (): void => {
            if (peers.delete(pc)) {
              pc.close()
              set({ listeners: peers.size })
              releaseIfIdle()
            }
          }
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') set({ listeners: peers.size, error: null })
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') done()
          }
          await pc.setRemoteDescription(offer)
          for (const t of audio.getAudioTracks()) pc.addTrack(t, audio)
          // music, not speech: ask the encoder for stereo at a high bitrate
          for (const tr of pc.getTransceivers()) tr.direction = 'sendonly'
          const answer = await pc.createAnswer()
          answer.sdp = tuneOpus(answer.sdp ?? '')
          await pc.setLocalDescription(answer)
          // no trickle: wait until the candidates are in the description (a LAN needs only a moment)
          await new Promise<void>((res) => {
            if (pc.iceGatheringState === 'complete') return res()
            const t = setTimeout(res, 2000)
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') {
                clearTimeout(t)
                res()
              }
            })
          })
          const d = pc.localDescription! // plain object: the description class itself can't cross the IPC boundary
          await window.lyra.lan.answer(id, { type: d.type, sdp: d.sdp })
          setTimeout(() => pc.connectionState === 'new' || pc.connectionState === 'connecting' ? done() : undefined, 15_000)
        } catch (e) {
          set({ error: (e as Error).message })
          await window.lyra.lan.answer(id, null)
        }
      })()
    })
  }
}))
