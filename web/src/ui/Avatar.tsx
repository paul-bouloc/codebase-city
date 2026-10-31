import { useState } from 'react'
import styles from './Avatar.module.css'
import { type AvatarSize, avatarSource, initials } from './avatar-source'

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
