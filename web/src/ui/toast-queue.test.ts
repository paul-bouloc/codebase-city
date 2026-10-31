import { describe, expect, it } from 'vitest'
import {
  leaveToast,
  pushToast,
  removeToast,
  type ToastData,
  type ToastTone,
  toastDwell,
} from './toast-queue'

const toast = (id: number, tone: ToastTone = 'info'): ToastData => ({ id, tone, title: `#${id}` })
const ids = (queue: ToastData[]) => queue.map((item) => item.id)
// The toasts still on screen for good, without those fading out.
const shown = (queue: ToastData[]) => ids(queue.filter((item) => !item.leaving))

describe('pushToast', () => {
  it('puts the newest toast last', () => {
    expect(ids(pushToast([toast(1)], toast(2)))).toEqual([1, 2])
  })

  it('keeps three toasts at most, dropping the oldest', () => {
    const queue = [toast(1), toast(2), toast(3)]
    expect(shown(pushToast(queue, toast(4)))).toEqual([2, 3, 4])
  })

  it('lets the dropped toast leave instead of removing it', () => {
    const queue = pushToast([toast(1), toast(2), toast(3)], toast(4))
    expect(ids(queue)).toEqual([1, 2, 3, 4])
    expect(queue[0]?.leaving).toBe('pushed')
  })

  it('does not count leaving toasts', () => {
    const queue = pushToast([toast(1), toast(2), toast(3)], toast(4))
    expect(shown(pushToast(queue, toast(5)))).toEqual([3, 4, 5])
  })

  it('does not count a toast closed by hand while it fades out', () => {
    const queue = leaveToast([toast(1), toast(2), toast(3)], 2)
    expect(shown(pushToast(queue, toast(4)))).toEqual([1, 3, 4])
  })

  it('drops an older success or info before an error', () => {
    const queue = [toast(1, 'error'), toast(2, 'success'), toast(3)]
    expect(shown(pushToast(queue, toast(4)))).toEqual([1, 3, 4])
  })

  it('drops the oldest error when only errors are left', () => {
    const queue = [toast(1, 'error'), toast(2, 'error'), toast(3, 'error')]
    expect(shown(pushToast(queue, toast(4, 'error')))).toEqual([2, 3, 4])
  })

  it('does not change the queue it was given', () => {
    const queue = [toast(1)]
    pushToast(queue, toast(2))
    expect(ids(queue)).toEqual([1])
  })
})

describe('leaveToast', () => {
  it('marks one toast as closed and keeps it in the queue', () => {
    const queue = leaveToast([toast(1), toast(2)], 1)
    expect(ids(queue)).toEqual([1, 2])
    expect(queue.map((item) => item.leaving)).toEqual(['closed', undefined])
  })

  it('keeps a toast pushed out as pushed', () => {
    const queue = pushToast([toast(1), toast(2), toast(3)], toast(4))
    expect(leaveToast(queue, 1)[0]?.leaving).toBe('pushed')
  })
})

describe('removeToast', () => {
  it('removes one toast by id', () => {
    expect(ids(removeToast([toast(1), toast(2)], 1))).toEqual([2])
  })
})

describe('toastDwell', () => {
  it('lets success and info go after 5 s and keeps errors', () => {
    expect(toastDwell('success')).toBe(5000)
    expect(toastDwell('info')).toBe(5000)
    expect(toastDwell('error')).toBeNull()
  })
})
