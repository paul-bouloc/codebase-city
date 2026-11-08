import type { CityCards } from '../../city/interaction/city-cards'
import type { CityHover } from '../../city/interaction/city-items'
import { AreaTooltip } from './AreaTooltip'
import { BundleTooltip } from './BundleTooltip'
import { FileTooltip } from './FileTooltip'
import { PortTooltip } from './PortTooltip'
import type { Rect } from './tooltip-placement'

interface CityHoverCardProps {
  hover: CityHover
  cards: CityCards
  /** Open panels the card keeps out of. */
  obstacles?: readonly Rect[]
}

/** The card of what the pointer rests on, read from the result. */
export function CityHoverCard({ hover, cards, obstacles }: CityHoverCardProps) {
  const { pointer } = hover
  if (hover.bundle) {
    return (
      <BundleTooltip path={hover.path} {...hover.bundle} pointer={pointer} obstacles={obstacles} />
    )
  }
  if (hover.port) {
    return (
      <PortTooltip
        path={hover.path}
        links={hover.port.links}
        pointer={pointer}
        obstacles={obstacles}
      />
    )
  }
  if (hover.target.kind === 'building') {
    const card = cards.file(hover.path)
    return card ? <FileTooltip {...card} pointer={pointer} obstacles={obstacles} /> : null
  }
  const card = cards.folder(hover.path)
  return card ? <AreaTooltip {...card} pointer={pointer} obstacles={obstacles} /> : null
}
