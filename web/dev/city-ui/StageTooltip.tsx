import { AreaTooltip } from '../../src/screen/tooltips/AreaTooltip'
import { FileTooltip } from '../../src/screen/tooltips/FileTooltip'
import type { Point, Rect } from '../../src/screen/tooltips/tooltip-placement'
import { FILE, ISLAND, LONG_FILE, PARCEL } from './city-ui-samples'
import type { Hover } from './stage-states'

interface StageTooltipProps {
  hover: Exclude<Hover, 'off'>
  pointer: Point
  obstacles: Rect[]
}

export function StageTooltip({ hover, pointer, obstacles }: StageTooltipProps) {
  switch (hover) {
    case 'file':
      return <FileTooltip {...FILE} pointer={pointer} obstacles={obstacles} />
    case 'long':
      return <FileTooltip {...LONG_FILE} pointer={pointer} obstacles={obstacles} />
    case 'parcel':
      return <AreaTooltip {...PARCEL} pointer={pointer} obstacles={obstacles} />
    case 'island':
      return <AreaTooltip {...ISLAND} pointer={pointer} obstacles={obstacles} />
  }
}
