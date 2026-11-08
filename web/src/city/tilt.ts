import { MathUtils } from 'three'

/** As close as it gets, the camera stays 8° above the horizon: lower, buildings hide the street. */
export const NEAR_TILT = MathUtils.degToRad(82)
/** With the whole city in view, it may come down to 2° above it. */
export const FAR_TILT = MathUtils.degToRad(88)

/**
 * How far the camera may tilt from the vertical, `distance` u from its target: from the near tilt
 * at the closest distance to the far one once the whole city is in view (`framing`), steadily
 * along the logarithm of the distance, as a zoom is felt.
 */
export function maxTilt(distance: number, closest: number, framing: number): number {
  if (distance <= closest || framing <= closest) {
    return NEAR_TILT
  }
  if (distance >= framing) {
    return FAR_TILT
  }
  const t = Math.log(distance / closest) / Math.log(framing / closest)
  return NEAR_TILT + (FAR_TILT - NEAR_TILT) * t
}
