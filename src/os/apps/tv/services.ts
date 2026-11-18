/** A streaming service that can be installed onto the TV. */
export interface Service {
  id: string
  name: string
  url: string
  domain: string
  color: string
  category: 'Video' | 'Music' | 'Live'
  blurb: string
  tvUi?: boolean
  /** Search URL; {q} is replaced. */
  search?: string
  /** Microsoft Store product id of the official Windows app, when one exists. */
  store?: string
}

export const CATALOG: Service[] = [
  { id: 'netflix', store: '9WZDNCRFJ3TJ', name: 'Netflix', url: 'https://www.netflix.com', domain: 'netflix.com', color: '#b20710', category: 'Video', blurb: 'Series, films and anime', search: 'https://www.netflix.com/search?q={q}' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', domain: 'youtube.com', color: '#ff0000', category: 'Video', blurb: 'Videos, creators and live', search: 'https://www.youtube.com/results?search_query={q}' },
  { id: 'disney', store: '9NXQXXLFST89', name: 'Disney+', url: 'https://www.disneyplus.com', domain: 'disneyplus.com', color: '#0e47a1', category: 'Video', blurb: 'Disney, Pixar, Marvel, Star Wars', search: 'https://www.disneyplus.com/search?q={q}' },
  { id: 'appletv', store: '9NM4T8B9JQZ1', name: 'Apple TV', url: 'https://tv.apple.com', domain: 'tv.apple.com', color: '#1c1c1e', category: 'Video', blurb: 'Apple TV+ originals and films', search: 'https://tv.apple.com/search?term={q}' },
  { id: 'iplayer', name: 'BBC iPlayer', url: 'https://www.bbc.co.uk/iplayer', domain: 'bbc.co.uk', color: '#e0187a', category: 'Video', blurb: 'BBC shows, live channels and catch-up', search: 'https://www.bbc.co.uk/iplayer/search?q={q}' },
  { id: 'prime', store: '9P6RC76MSMMJ', name: 'Prime Video', url: 'https://www.primevideo.com', domain: 'primevideo.com', color: '#00a8e1', category: 'Video', blurb: 'Amazon originals and films', search: 'https://www.primevideo.com/search?phrase={q}' },
  { id: 'showmax', name: 'Showmax', url: 'https://www.showmax.com', domain: 'showmax.com', color: '#e8114b', category: 'Video', blurb: 'African originals and HBO' },
  { id: 'crunchyroll', name: 'Crunchyroll', url: 'https://www.crunchyroll.com', domain: 'crunchyroll.com', color: '#f47521', category: 'Video', blurb: 'Anime, simulcast from Japan', search: 'https://www.crunchyroll.com/search?q={q}' },
  { id: 'plex', name: 'Plex', url: 'https://app.plex.tv', domain: 'plex.tv', color: '#e5a00d', category: 'Video', blurb: 'Your media, plus free movies' },
  { id: 'ted', name: 'TED', url: 'https://www.ted.com/talks', domain: 'ted.com', color: '#e62b1e', category: 'Video', blurb: 'Ideas worth spreading' },
  { id: 'dstv', name: 'DStv', url: 'https://now.dstv.com', domain: 'dstv.com', color: '#0a6bcc', category: 'Live', blurb: 'Live TV channels and catch-up' },
  { id: 'sabcplus', name: 'SABC+', url: 'https://www.sabc-plus.com', domain: 'sabc-plus.com', color: '#0072bc', category: 'Live', blurb: 'SABC channels, live and on demand' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', domain: 'twitch.tv', color: '#9146ff', category: 'Live', blurb: 'Live streams and gaming' },
  { id: 'ytmusic', name: 'YouTube Music', url: 'https://music.youtube.com', domain: 'music.youtube.com', color: '#e10000', category: 'Music', blurb: 'Songs, albums and mixes', search: 'https://music.youtube.com/search?q={q}' },
  { id: 'spotify', store: '9NCBCSZSJRSB', name: 'Spotify', url: 'https://open.spotify.com', domain: 'spotify.com', color: '#1db954', category: 'Music', blurb: 'Music and podcasts', search: 'https://open.spotify.com/search/{q}' },
  { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com', domain: 'deezer.com', color: '#a238ff', category: 'Music', blurb: 'Music streaming' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com', domain: 'soundcloud.com', color: '#ff5500', category: 'Music', blurb: 'Independent artists and mixes' },
]

/** Netflix first: it is the one most people open. */
export const DEFAULT_INSTALLED = ['netflix', 'youtube', 'disney', 'appletv', 'ytmusic', 'iplayer']

export const serviceById = (id?: string) => CATALOG.find((s) => s.id === id)
export const logo = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
export const searchUrl = (s: Service, q: string) => (s.search ?? s.url).replace('{q}', encodeURIComponent(q))
