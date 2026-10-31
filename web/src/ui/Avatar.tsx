import { useState } from 'react'
import styles from './Avatar.module.css'

export type AvatarSize = 32 | 40 | 72

// "lena-okafor" gives "LO", "torvalds" gives "TO".
export function initials(login: string): string {
  const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const letters =
    parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : (parts[0] ?? '').slice(0, 2)
  return letters.toUpperCase()
}

// GitHub serves the avatar at the size asked for: twice the displayed size, for sharp pixels.
export function avatarSource(src: string, size: AvatarSize): string {
  try {
    const url = new URL(src)
    url.searchParams.set('s', String(size * 2))
    return url.toString()
  } catch {
    return src
  }
}

interface AvatarProps {
  login: string
  // The GitHub avatar URL. Missing or broken, the initials stand in.
  src?: string
  size?: AvatarSize
}

// Decorative: the login is always written next to it.
export function Avatar({ login, src, size = 32 }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>()
  const classes = `${styles.avatar} ${styles[`size${size}`]}`

  if (!src || failedSrc === src) {
    return (
      <span className={`${classes} ${styles.fallback}`} aria-hidden="true">
        {initials(login)}
      </span>
    )
  }

  return (
    <img
      className={classes}
      src={avatarSource(src, size)}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
    />
  )
}
