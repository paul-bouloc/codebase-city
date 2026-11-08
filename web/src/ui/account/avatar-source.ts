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
