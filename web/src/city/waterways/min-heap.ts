/** A binary heap of cells by priority. */
export class MinHeap {
  private readonly cells: number[] = []
  private readonly priorities: number[] = []

  get size(): number {
    return this.cells.length
  }

  push(cell: number, priority: number): void {
    const { cells, priorities } = this
    let at = cells.length
    cells.push(cell)
    priorities.push(priority)
    while (at > 0) {
      const parent = (at - 1) >> 1
      if ((priorities[parent] ?? 0) <= priority) {
        break
      }
      cells[at] = cells[parent] ?? 0
      priorities[at] = priorities[parent] ?? 0
      at = parent
    }
    cells[at] = cell
    priorities[at] = priority
  }

  pop(): number {
    const { cells, priorities } = this
    const top = cells[0] ?? -1
    const lastCell = cells.pop() ?? 0
    const lastPriority = priorities.pop() ?? 0
    const size = cells.length
    if (size === 0) {
      return top
    }
    let at = 0
    for (;;) {
      const left = 2 * at + 1
      if (left >= size) {
        break
      }
      const right = left + 1
      const child =
        right < size && (priorities[right] ?? 0) < (priorities[left] ?? 0) ? right : left
      if ((priorities[child] ?? 0) >= lastPriority) {
        break
      }
      cells[at] = cells[child] ?? 0
      priorities[at] = priorities[child] ?? 0
      at = child
    }
    cells[at] = lastCell
    priorities[at] = lastPriority
    return top
  }
}
