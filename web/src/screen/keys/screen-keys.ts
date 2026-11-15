// The keys the city screen listens to, wherever the focus is, unless one is typing.

/** A key pressed in a field types; it moves nothing. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
  )
}

/** `/` outside a field, or ⌘K (Ctrl+K) anywhere: go to the search field. */
export function isSearchKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>,
): boolean {
  if (event.altKey) {
    return false
  }
  if (event.key === 'k' || event.key === 'K') {
    return (event.metaKey || event.ctrlKey) && !event.shiftKey
  }
  return event.key === '/' && !event.metaKey && !event.ctrlKey && !isTyping(event.target)
}

/**
 * The tour's arrows come from the page, the city or the guide only: elsewhere (a code view, a
 * toolbar) they scroll or move what has the focus.
 */
export function isTourKeyTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return true
  }
  return (
    target === document.body ||
    target instanceof HTMLCanvasElement ||
    target.closest('[data-guide]') !== null
  )
}

/**
 * Space is the tour's, unless it presses a control with the focus (a button, a link): the guide's
 * pill alone, `data-tour-space`, takes it to start the tour.
 */
export function isTourSpaceTarget(target: EventTarget | null): boolean {
  if (!isTourKeyTarget(target)) {
    return false
  }
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return true
  }
  const control = target.closest('button, a[href], [role="button"]')
  return control === null || control.hasAttribute('data-tour-space')
}
