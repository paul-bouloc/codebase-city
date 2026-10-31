// Every decision point is marked with what it adds; the file starts at 1.

type Kind<T> = T extends string ? 'text' : 'other' // a type, not a decision

export function route(path: string, user?: User): string {
  if (!user) { // +1
    return 'login'
  } else if (user.admin && path.startsWith('/admin')) { // +1 +1
    return 'admin'
  }
  for (const part of path.split('/')) { // +1
    while (part.length > 10) { // +1
      break
    }
  }
  for (let i = 0; i < 3; i++) {} // +1
  do {} while (false) // +1
  switch (path) {
    case '/': // +1
      return 'home'
    case '/about': // +1
      return 'about'
    default:
      return user.name ?? 'anonymous' // +1
  }
}

export const safe = (f: () => void, ok: boolean) => {
  try {
    f()
  } catch { // +1
    return false
  }
  return ok || !ok ? 'yes' : 'no' // +1 +1
}
