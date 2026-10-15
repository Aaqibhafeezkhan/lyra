import { AnimatePresence, motion } from 'framer-motion'
import { useArtwork } from '@/hooks/useArtwork'
import { useReducedMotion } from '@/hooks/useMotion'
import { Icon } from './Icon'

interface Props {
  url: string | null
  size?: number | string
  radius?: number
  className?: string
  /** layoutId for shared-element transitions between widget sizes */
  layoutId?: string
}

/** Album art with a soft crossfade between tracks and a graceful empty state. */
export function Artwork({ url, size, radius = 10, className = '', layoutId }: Props) {
  const src = useArtwork(url)
  const reduced = useReducedMotion()
  return (
    <motion.div
      layoutId={layoutId}
      className={`artwork ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
      transition={{ type: 'spring', stiffness: 360, damping: 38 }}
    >
      <AnimatePresence initial={false}>
        {src ? (
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className="artwork__img"
            initial={reduced ? false : { opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : (
          <div key="empty" className="artwork__empty">
            <Icon name="note" size={typeof size === 'number' ? Math.round(size * 0.35) : 28} />
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
