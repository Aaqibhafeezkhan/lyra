import { AnimatePresence, motion } from 'framer-motion'
import { useArtwork } from '@/hooks/useArtwork'
import { usePlayer } from '@/store/player'

/**
 * Artwork-derived atmosphere: a blurred copy of the cover plus two slow colour fields
 * from the palette (set as CSS variables on :root). A dark shade keeps text readable.
 */
export function Backdrop({ rich = false }: { rich?: boolean }) {
  const url = usePlayer((s) => s.snapshot?.track?.artworkUrl ?? null)
  const src = useArtwork(url)
  return (
    <div className={`backdrop ${rich ? 'backdrop--rich' : ''}`} aria-hidden="true">
      <div className="backdrop__field" />
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            className="backdrop__img"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            draggable={false}
          />
        )}
      </AnimatePresence>
      {rich && (
        <>
          <i className="backdrop__blob backdrop__blob--a" />
          <i className="backdrop__blob backdrop__blob--b" />
        </>
      )}
      <div className="backdrop__shade" />
    </div>
  )
}
