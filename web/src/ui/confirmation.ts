// Case-sensitive; spaces around the value are forgiven.
export function confirmationMatches(value: string, expected: string): boolean {
  return value.trim() === expected
}
