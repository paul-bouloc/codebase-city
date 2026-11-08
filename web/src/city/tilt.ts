import { MathUtils } from 'three'

/** Close up, the camera stays 10° above the horizon: lower, buildings hide the street. */
export const NEAR_TILT = MathUtils.degToRad(80)
/** From afar, it may come down to 4° above it, to see the city stand out against the sea. */
export const FAR_TILT = MathUtils.degToRad(86)
/** The near tilt holds up to this share of the distance that frames the whole city. */
const NEAR_SHARE = 0.25

/**
 * How far the camera may tilt from the vertical, `distance` u from its target: from the near tilt
 * close up to the far one once the whole city is in view, eased on the logarithm of the distance
 * as a zoom is felt.
 */
export function maxTilt(distance: number, framing: number): number {
  const near = framing * NEAR_SHARE
  if (distance <= near || framing <= 0) {
    return NEAR_TILT
  }
  if (distance >= framing) {
    return FAR_TILT
  }
  const t = Math.log(distance / near) / Math.log(framing / near)
  return NEAR_TILT + (FAR_TILT - NEAR_TILT) * MathUtils.smoothstep(t, 0, 1)
}
