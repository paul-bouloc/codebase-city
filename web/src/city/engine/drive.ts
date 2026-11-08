/** Where the keys held down drive the camera, each part from −1 to 1. */
export interface Drive {
  /** Along the ground, to the right of the view. */
  right: number
  /** Along the ground, ahead of the view. */
  forward: number
  /** Around the target, the view turning to the left. */
  turn: number
}

export const STILL: Drive = { right: 0, forward: 0, turn: 0 }

// Physical keys (`KeyboardEvent.code`): W A S D wherever a layout puts its letters, Z Q S D on
// AZERTY.
const KEYS: Record<string, Drive> = {
  KeyW: { right: 0, forward: 1, turn: 0 },
  KeyS: { right: 0, forward: -1, turn: 0 },
  KeyA: { right: -1, forward: 0, turn: 0 },
  KeyD: { right: 1, forward: 0, turn: 0 },
  KeyQ: { right: 0, forward: 0, turn: 1 },
  KeyE: { right: 0, forward: 0, turn: -1 },
}

export function isDriveKey(code: string): boolean {
  return code in KEYS
}

/** The drive of the keys held down; opposite keys cancel out. */
export function driveOf(codes: Iterable<string>): Drive {
  let right = 0
  let forward = 0
  let turn = 0
  for (const code of new Set(codes)) {
    const key = KEYS[code]
    if (key) {
      right += key.right
      forward += key.forward
      turn += key.turn
    }
  }
  return { right, forward, turn }
}
