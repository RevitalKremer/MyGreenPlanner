import { useState, useCallback } from 'react'

export type ConfirmVariant = 'default' | 'warning' | 'danger'

export type ConfirmOpts = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}

type Pending = ConfirmOpts & { resolver: (v: boolean) => void }

// Promise-based in-app replacement for window.confirm — call ask(...) and
// await the user's choice. Render the returned <ConfirmDialog/> once at
// the root using the exposed state + handlers.
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>(resolve => setPending({ ...opts, resolver: resolve }))
  }, [])

  const handleConfirm = useCallback(() => {
    setPending(prev => { prev?.resolver(true); return null })
  }, [])

  const handleCancel = useCallback(() => {
    setPending(prev => { prev?.resolver(false); return null })
  }, [])

  return { ask, pending, handleConfirm, handleCancel }
}
