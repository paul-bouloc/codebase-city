// Stroke icons drawn on a 24 × 24 grid with a 2 unit padding.
const CIRCLE = 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z'
const LENS = 'M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0Z M16 16l5 5'
const SLIDERS = 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4'

export const ICON_PATHS = {
  // Navigation
  search: LENS,
  close: 'M6 6l12 12 M18 6L6 18',
  'arrow-left': 'M19 12H5 M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14 M13 6l6 6-6 6',
  play: 'M8 5.5v13l10.5-6.5Z',
  pause: 'M8 5v14 M16 5v14',
  recenter: 'M18 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0Z M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 12h.01',
  'top-view': 'M4 4h16v16H4Z M9 9h6v6H9Z M4 4l5 5 M20 4l-5 5 M4 20l5-5 M20 20l-5-5',
  'zoom-in': `${LENS} M11 8v6 M8 11h6`,
  'zoom-out': `${LENS} M8 11h6`,
  'chevron-down': 'M6 9l6 6 6-6',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',

  // Actions
  share: 'M12 3v12 M7 8l5-5 5 5 M5 14v5h14v-5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  settings: SLIDERS,
  admin: 'M12 3l7 3v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6Z M9 12l2 2 4-4',
  'sign-out': 'M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3 M14 8l4 4-4 4 M18 12H8',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  user: 'M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9Z',
  commit: 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z M3 12h6 M15 12h6',
  refresh: 'M21 12a9 9 0 1 1-9-9 M21 4v5h-5',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5Z',
  buildings: 'M3 20h18 M5 20V10l4-3v13 M9 20V5l6 3v12 M15 20v-8l4-2v10',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',

  // Feedback
  info: `${CIRCLE} M12 11v5 M12 8h.01`,
  warning: 'M12 3.5l9.5 16.5h-19Z M12 10v4 M12 17h.01',
  error: `${CIRCLE} M9 9l6 6 M15 9l-6 6`,
  success: `${CIRCLE} M8 12.5l3 3 5-6`,
  check: 'M5 12.5l4.5 4.5L19 7',
  clock: `${CIRCLE} M12 7v5l3 2`,
  'alert-circle': `${CIRCLE} M12 7.5v5.5 M12 16.5h.01`,
  minus: 'M6 12h12',
  'minus-circle': `${CIRCLE} M8 12h8`,

  // The city
  layers: 'M12 3l9 5-9 5-9-5Z M3 12.5l9 5 9-5 M3 17l9 5 9-5',
  cycle: 'M20 12a8 8 0 0 1-14 5.3 M4 12a8 8 0 0 1 14-5.3 M18 3v4h-4 M6 21v-4h4',
  'entry-point': 'M10 21l1-12h2l1 12 M8 21h8 M9.5 9h5 M10.5 6h3v3h-3Z M12 3v3 M4 7l3 1 M20 7l-3 1',
  foundation: 'M3 20h18 M5 20v-4h14v4 M8 16v-4h8v4 M11 12V8h2v4',
  conductor:
    'M14.5 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0Z M12 9.5V4 M12 14.5V20 M9.5 12H4 M14.5 12H20',
  facade: 'M4 20V7l8-4 8 4v13 M3 20h18 M8 10v7 M12 9v8 M16 10v7',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z M14 3v4h4',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',
  test: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3 M7.5 14h9',
  generated:
    'M14.5 5.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0Z M10.5 8l-.5 4 M13.5 8l.5 4 M5 12h14v4H5Z M5 20h3 M10.5 20h3 M16 20h3',
  config: SLIDERS,
  'mode-simplified': 'M12 3l8 4.5v9L12 21l-8-4.5v-9Z M4 7.5l8 4.5 8-4.5 M12 12v9',
  'mode-realistic': 'M4 20V10l8-6 8 6v10Z M9 20v-5h6v5 M8 11h2 M14 11h2',
  symbol: 'M8 6l-5 6 5 6 M16 6l5 6-5 6',
  'scale-height': 'M7 20V12h4v8 M13 20V5h4v15 M4 20h16',
  'scale-footprint': 'M4 16l8 4 8-4-8-4Z M4 16v-2l8-4 8 4v2',
  canal: 'M3 18c3-2 5-2 9 0s6 2 9 0 M3 13c3-2 5-2 9 0s6 2 9 0',

  // Administration and privacy
  dashboard: 'M4 13h6V4H4Z M14 20h6v-9h-6Z M4 20h6v-3H4Z M14 7h6V4h-6Z',
  users:
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M13.5 7.5a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z M21 19v-1a4 4 0 0 0-3-3.9 M16 3.6a4 4 0 0 1 0 7.8',
  analyses:
    'M12 3v4 M12 17v4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M3 12h4 M17 12h4 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  cities: 'M3 21h18 M5 21V9l5-3v15 M10 21V4l6 3v14 M16 21v-9l3-1.5V21',
  audit:
    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2Z M9 12h6 M9 16h4',
  cookie:
    'M12 3a9 9 0 1 0 9 9a4 4 0 0 1-5-5a4 4 0 0 1-4-4Z M8.5 12.5h.01 M12 16h.01 M15.5 14.5h.01 M9 8.5h.01',
  server: 'M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01',
} as const

// GitHub's official mark, a filled shape on the same 24 grid.
// From Primer Octicons, MIT License, Copyright (c) GitHub Inc.
export const GITHUB_MARK_PATH =
  'M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943'

export type IconName = keyof typeof ICON_PATHS | 'github'

export const ICON_NAMES = [
  ...(Object.keys(ICON_PATHS) as (keyof typeof ICON_PATHS)[]),
  'github',
] as const
