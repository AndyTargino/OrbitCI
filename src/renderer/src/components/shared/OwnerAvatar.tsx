import { useState } from 'react'
import { cn } from '@/lib/utils'

interface OwnerAvatarProps {
  owner: string
  src?: string
  className?: string
  size?: number
}

export function OwnerAvatar({ owner, src, className, size = 64 }: OwnerAvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false)
  const url = !failed ? (src || `https://github.com/${owner}.png?size=${size}`) : null

  if (!url) {
    return (
      <span
        className={cn(
          'rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center font-bold text-primary shrink-0',
          className
        )}
      >
        {owner[0]?.toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt={owner}
      className={cn('rounded-full object-cover shrink-0', className)}
      onError={() => setFailed(true)}
    />
  )
}
