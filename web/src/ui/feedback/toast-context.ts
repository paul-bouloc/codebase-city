import { createContext } from 'react'
import type { ToastData } from './toast-queue'

export type ToastInput = Omit<ToastData, 'id' | 'leaving'>

export interface ToastApi {
  show: (toast: ToastInput) => void
}

export const ToastContext = createContext<ToastApi | null>(null)
