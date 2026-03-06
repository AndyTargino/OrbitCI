import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  consequences?: string[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'warning' | 'default'
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  cancelLabel,
  variant = 'destructive',
  onConfirm
}: ConfirmDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
      onOpenChange(false)
    }
  }

  const iconColor = variant === 'destructive'
    ? 'text-red-400 bg-red-500/10'
    : variant === 'warning'
      ? 'text-yellow-400 bg-yellow-500/10'
      : 'text-blue-400 bg-blue-500/10'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn('rounded-full p-2 shrink-0', iconColor)}>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="space-y-1.5">
              <DialogTitle className="text-[15px]">{title}</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {consequences && consequences.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-1">
            {consequences.map((c, i) => (
              <p key={i} className="text-[12px] text-muted-foreground flex items-start gap-2">
                <span className="text-muted-foreground/60 mt-0.5">•</span>
                {c}
              </p>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-[13px]"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            size="sm"
            className="text-[13px]"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? t('common.wait', 'Please wait...') : (confirmLabel ?? t('common.confirm', 'Confirm'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
