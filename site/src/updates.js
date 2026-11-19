import { useEffect, useState } from 'react'
import latest from '../public/latest.json'

/* The release feed. ONE file, public/latest.json, drives both this site and the app's own update check:
   {
     version, date,
     installers: { "10": { url, size, sha256 }, "11": { url, size, sha256 } },   // url null = not available yet
     updates: [ { date, kind: 'release' | 'fix' | 'news', version?, title, body?, notes? } ]   // newest first
   }
   To publish an update: upload the installers to a GitHub Release, then edit latest.json (version, urls, sha256, a
   new entry at the top of `updates`). The bundled copy below is the fallback if the live file cannot be fetched. */
export const RELEASE_URL = 'https://raw.githubusercontent.com/GeneralGunfire/Udaan/master/site/public/latest.json'

export function useRelease() {
  const [rel, setRel] = useState(latest)
  useEffect(() => {
    let live = true
    fetch('/latest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && j?.version && setRel(j))
      .catch(() => {})
    return () => { live = false }
  }, [])
  return rel
}
