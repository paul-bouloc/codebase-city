import { describe, expect, it } from 'vitest'
import { pushToast, removeToast, type ToastData, type ToastTone, toastDwell } from './toast-queue'

const toast = (id: number, tone: ToastTone = 'info'): ToastData => ({ id, tone, title: `#${id}` })
const ids = (queue: ToastData[]) => queue.map((item) => item.id)

describe('pushToast', () => {
  it('puts the newest toast last', () => {
    expect(ids(pushToast([toast(1)], toast(2)))).toEqual([1, 2])
  })

  it('keeps three toasts at most, dropping the oldest', () => {
    const queue = [toast(1), toast(2), toast(3)]
    expect(ids(pushToast(queue, toast(4)))).toEqual([2, 3, 4])
  })

  it('drops an older success or info before an error', () => {
    const queue = [toast(1, 'error'), toast(2, 'success'), toast(3)]
    expect(ids(pushToast(queue, toast(4)))).toEqual([1, 3, 4])
  })

  it('drops the oldest error when only errors are left', () => {
    const queue = [toast(1, 'error'), toast(2, 'error'), toast(3, 'error')]
    expect(ids(pushToast(queue, toast(4, 'error')))).toEqual([2, 3, 4])
  })

  it('does not change the queue it was given', () => {
    const queue = [toast(1)]
    pushToast(queue, toast(2))
    expect(ids(queue)).toEqual([1])
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
