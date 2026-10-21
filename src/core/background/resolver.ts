import type { BackgroundMedia, BackgroundResolution, BackgroundSpec, Settings, Track, VideoCrop, YoutubeVideo } from '@shared/types'
import { itunes } from './itunes'
import { youtube } from './youtube'

/** What the user has pinned for one song. */
export interface SongBg {
  media?: BackgroundMedia
  youtube?: YoutubeVideo
}

/** The few things that differ per platform (where files live, how clip URLs are served, how thumbnails are decoded). */
export interface ResolverHost {
  settings(): Pick<Settings, 'backgroundStyle' | 'customBackground'>
  songs(): Record<string, SongBg>
  /** A playable spec for a file the user imported, or null if the file is gone. */
  mediaSpec(m: BackgroundMedia, scope: 'song' | 'global'): BackgroundSpec | null
  /** URL the player should use for an Apple preview clip (Electron proxies it so frames can be read). */
  clipUrl(url: string): string
  crop(videoId: string): Promise<VideoCrop | null>
}

/**
 * Decides what plays behind the lyrics. Order in Auto:
 * your file for this song, then your file for all songs, then a free Apple clip (YouTube instead when the clip is
 * only 640p and a key exists), then YouTube (only with a key), then animated cover art.
 */
export function createBackgroundResolver(host: ResolverHost): (track: Track) => Promise<BackgroundResolution> {
  return async (track) => {
    const s = host.settings()
    const song = host.songs()[track.id]
    const songSpec = song?.media ? host.mediaSpec(song.media, 'song') : null
    const globalSpec = s.customBackground ? host.mediaSpec(s.customBackground, 'global') : null
    const base = { hasSongMedia: !!songSpec, hasGlobalMedia: !!globalSpec }
    const living: BackgroundSpec = { kind: 'living' }
    const ytSpec = async (v: YoutubeVideo, scope: 'song' | 'auto'): Promise<BackgroundSpec> => ({
      kind: 'youtube',
      videoId: v.videoId,
      title: v.title,
      channel: v.channel,
      durationSec: v.durationSec,
      crop: await host.crop(v.videoId),
      scope
    })

    /** the next best videos of the song (about the right length), in case the first one is blocked from playing in an app */
    const alternates = async (best: YoutubeVideo, list: YoutubeVideo[]): Promise<{ alternates?: BackgroundSpec[] }> => {
      const want = track.durationMs / 1000
      const near = list.filter((v) => v.videoId !== best.videoId && (!v.durationSec || !want || Math.abs(v.durationSec - want) <= 25)).slice(0, 2)
      return near.length ? { alternates: await Promise.all(near.map((v) => ytSpec(v, 'auto'))) } : {}
    }

    if (s.backgroundStyle === 'still') return { ...base, spec: { kind: 'still' }, youtube: 'off' }
    if (s.backgroundStyle === 'living') return { ...base, spec: living, youtube: 'off' }
    if (s.backgroundStyle === 'custom') return { ...base, spec: songSpec ?? globalSpec ?? living, youtube: 'off' }

    // pinned choices first: the user's own file for this song (auto), or the video they picked for it
    if (s.backgroundStyle === 'auto' && songSpec) return { ...base, spec: songSpec, youtube: song?.youtube ? 'pinned' : 'off' }
    if (song?.youtube) return { ...base, spec: await ytSpec(song.youtube, 'song'), youtube: 'pinned' }

    const asClip = async (): Promise<Extract<BackgroundSpec, { kind: 'preview' }> | null> => {
      const clip = await itunes.find(track)
      return clip ? { kind: 'preview', url: host.clipUrl(clip.url), title: clip.title, width: clip.width } : null
    }
    const yt = (): ReturnType<typeof youtube.find> => youtube.find(track)
    const report = (r: Awaited<ReturnType<typeof youtube.find>>): Pick<BackgroundResolution, 'youtube' | 'youtubeMessage'> =>
      r.state === 'error' ? { youtube: 'error', youtubeMessage: r.message } : { youtube: r.state === 'found' ? 'found' : r.state }

    if (s.backgroundStyle === 'youtube') {
      // "Video": YouTube first, then Apple's clip, then your file, then living artwork
      const r = await yt()
      const clip = await asClip()
      if (r.state === 'found') return { ...base, spec: await ytSpec(r.video, 'auto'), youtube: 'found', ...(clip ? { fallback: clip } : {}), ...(await alternates(r.video, r.list)) }
      return { ...base, spec: clip ?? globalSpec ?? living, ...report(r) }
    }

    // Auto
    if (globalSpec) return { ...base, spec: globalSpec, youtube: youtube.hasKey() ? 'off' : 'no-key' }
    const clip = await asClip()
    // a 640p clip looks soft on a big screen: prefer a 1080p YouTube video when the user has a key
    if (clip && clip.width < 1280 && youtube.hasKey()) {
      const hd = await yt()
      if (hd.state === 'found') return { ...base, spec: await ytSpec(hd.video, 'auto'), youtube: 'found', fallback: clip, ...(await alternates(hd.video, hd.list)) }
    }
    if (clip) return { ...base, spec: clip, youtube: youtube.hasKey() ? 'off' : 'no-key' }
    const r = await yt()
    if (r.state === 'found') return { ...base, spec: await ytSpec(r.video, 'auto'), youtube: 'found', ...(await alternates(r.video, r.list)) }
    return { ...base, spec: living, ...report(r) }
  }
}
