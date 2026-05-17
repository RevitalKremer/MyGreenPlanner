import { useState, useCallback } from 'react'

export type ConfirmVariant = 'default' | 'warning' | 'danger'

// When `discardLabel` is set the dialog renders a third button and the promise
// can resolve with the literal 'discard'. Callers that don't pass discardLabel
// still only see boolean (true=confirm, false=cancel).
export type ConfirmResult = boolean | 'discard'

export type ConfirmOpts = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  discardLabel?: string
  variant?: ConfirmVariant
}

type Pending = ConfirmOpts & { resolver: (v: ConfirmResult) => void }

// Promise-based in-app replacement for window.confirm — call ask(...) and
// await the user's choice. Render the returned <ConfirmDialog/> once at
// the root using the exposed state + handlers.
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = useCallback((opts: ConfirmOpts) => {
    return new Promise<ConfirmResult>(resolve => setPending({ ...opts, resolver: resolve }))
  }, [])

  const handleConfirm = useCallback(() => {
    setPending(prev => { prev?.resolver(true); return null })
  }, [])

  const handleCancel = useCallback(() => {
    setPending(prev => { prev?.resolver(false); return null })
  }, [])

  const handleDiscard = useCallback(() => {
    setPending(prev => { prev?.resolver('discard'); return null })
  }, [])

  return { ask, pending, handleConfirm, handleCancel, handleDiscard }
}
