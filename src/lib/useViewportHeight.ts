import { useEffect } from 'react'

/**
 * Keeps `--viewport-height` equal to the part of the screen that is actually visible.
 *
 * On iOS the on-screen keyboard does not shrink the layout viewport, so `100dvh` stays the
 * height of the whole phone while the keyboard covers the bottom third of it. A composer
 * pinned to the bottom of that ends up behind the keyboard, and the reply above it scrolls out
 * of sight. `visualViewport` is the only thing that reports what is genuinely on screen.
 *
 * The scroll listener matters as much as the resize one: iOS also slides the page up to keep
 * the focused field visible, which moves a fixed-height layout out from under itself. Putting
 * it back is what stops the header drifting off the top.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined

    const apply = () => {
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${String(viewport.height)}px`,
      )

      /*
       * While the keyboard is up it covers the home indicator, so the space normally reserved
       * for that is just a gap above the keys.
       */
      const keyboardOpen = window.innerHeight - viewport.height > 120
      if (keyboardOpen) {
        document.documentElement.style.setProperty('--safe-bottom', '0px')
      } else {
        document.documentElement.style.removeProperty('--safe-bottom')
      }

      // The page itself should never be scrolled; only the transcript inside it.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }

    apply()
    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)

    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--viewport-height')
      document.documentElement.style.removeProperty('--safe-bottom')
    }
  }, [])
}
