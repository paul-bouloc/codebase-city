// The item a key moves to in a group with one tab stop: Left and Right in a horizontal group
// (tabs), Up and Down in a vertical one (menus), step over disabled items and wrap around; Home
// and End go to the first and last enabled item. Null when the key is not a navigation key or
// no item is enabled. The other arrows are left to page scrolling.
export function rovingIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
  orientation: 'horizontal' | 'vertical' = 'horizontal',
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

  const [next, previous] =
    orientation === 'horizontal' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']

  switch (key) {
    case next:
      return step(1)
    case previous:
      return step(-1)
    case 'Home':
      return found(disabled.indexOf(false))
    case 'End':
      return found(disabled.lastIndexOf(false))
    default:
      return null
  }
}
