// An island on the water, 13 px: what an island's chip carries in front of its name.
export function IslandGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: '0 0 13px' }}>
      <path
        d="M4 15.5l2.5-6h11l2.5 6Z"
        fill="currentColor"
        fillOpacity="0.25"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M2 19.5c2 0 2-1.2 4-1.2s2 1.2 4 1.2s2-1.2 4-1.2s2 1.2 4 1.2s2-1.2 4-1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
