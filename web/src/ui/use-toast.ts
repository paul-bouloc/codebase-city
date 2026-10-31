import { useContext } from 'react'
import { type ToastApi, ToastContext } from './toast-context'

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) {
    throw new Error('useToast must be used inside a ToastProvider')
  }
  return api
}
