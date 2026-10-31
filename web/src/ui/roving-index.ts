// The item a key moves to in a horizontal group with one tab stop (tabs): Left and Right step
// over disabled items and wrap around, Home and End go to the first and last enabled item.
// Null when the key is not a navigation key or no item is enabled. Up and Down are left to
// page scrolling.
export function rovingIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
): number | null {
  const count = disabled.length

  const step = (direction: 1 | -1): number | null => {
    for (let offset = 1; offset <= count; offset++) {
      const index = (((current + direction * offset) % count) + count) % count
      if (disabled[index] === false) {
        return index
      }
    }
    return null
  }

  const found = (index: number): number | null => (index === -1 ? null : index)

  switch (key) {
    case 'ArrowRight':
      return step(1)
    case 'ArrowLeft':
      return step(-1)
    case 'Home':
      return found(disabled.indexOf(false))
    case 'End':
      return found(disabled.lastIndexOf(false))
    default:
      return null
  }
}
