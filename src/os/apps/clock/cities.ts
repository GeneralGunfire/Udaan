/** Built-in list of major cities and their IANA time zones. Times come from Intl; nothing is fetched. */

export interface City {
  name: string
  country: string
  zone: string
}

const RAW = `
Abu Dhabi|United Arab Emirates|Asia/Dubai
Abuja|Nigeria|Africa/Lagos
Accra|Ghana|Africa/Accra
Adelaide|Australia|Australia/Adelaide
Addis Ababa|Ethiopia|Africa/Addis_Ababa
Ahmedabad|India|Asia/Kolkata
Algiers|Algeria|Africa/Algiers
Almaty|Kazakhstan|Asia/Almaty
Amman|Jordan|Asia/Amman
Amsterdam|Netherlands|Europe/Amsterdam
Anchorage|United States|America/Anchorage
Ankara|Turkey|Europe/Istanbul
Athens|Greece|Europe/Athens
Atlanta|United States|America/New_York
Auckland|New Zealand|Pacific/Auckland
Austin|United States|America/Chicago
Baghdad|Iraq|Asia/Baghdad
Baku|Azerbaijan|Asia/Baku
Bangalore|India|Asia/Kolkata
Bangkok|Thailand|Asia/Bangkok
Barcelona|Spain|Europe/Madrid
Beijing|China|Asia/Shanghai
Beirut|Lebanon|Asia/Beirut
Belgrade|Serbia|Europe/Belgrade
Berlin|Germany|Europe/Berlin
Bern|Switzerland|Europe/Zurich
Bogota|Colombia|America/Bogota
Boston|United States|America/New_York
Brasilia|Brazil|America/Sao_Paulo
Bratislava|Slovakia|Europe/Bratislava
Brisbane|Australia|Australia/Brisbane
Brussels|Belgium|Europe/Brussels
Bucharest|Romania|Europe/Bucharest
Budapest|Hungary|Europe/Budapest
Buenos Aires|Argentina|America/Argentina/Buenos_Aires
Cairo|Egypt|Africa/Cairo
Calgary|Canada|America/Edmonton
Cape Town|South Africa|Africa/Johannesburg
Caracas|Venezuela|America/Caracas
Casablanca|Morocco|Africa/Casablanca
Chennai|India|Asia/Kolkata
Chicago|United States|America/Chicago
Chittagong|Bangladesh|Asia/Dhaka
Colombo|Sri Lanka|Asia/Colombo
Copenhagen|Denmark|Europe/Copenhagen
Dakar|Senegal|Africa/Dakar
Dallas|United States|America/Chicago
Dar es Salaam|Tanzania|Africa/Dar_es_Salaam
Darwin|Australia|Australia/Darwin
Delhi|India|Asia/Kolkata
Denver|United States|America/Denver
Detroit|United States|America/Detroit
Dhaka|Bangladesh|Asia/Dhaka
Doha|Qatar|Asia/Qatar
Dubai|United Arab Emirates|Asia/Dubai
Dublin|Ireland|Europe/Dublin
Edinburgh|United Kingdom|Europe/London
Edmonton|Canada|America/Edmonton
Frankfurt|Germany|Europe/Berlin
Geneva|Switzerland|Europe/Zurich
Guangzhou|China|Asia/Shanghai
Guatemala City|Guatemala|America/Guatemala
Halifax|Canada|America/Halifax
Hamburg|Germany|Europe/Berlin
Hanoi|Vietnam|Asia/Bangkok
Harare|Zimbabwe|Africa/Harare
Havana|Cuba|America/Havana
Helsinki|Finland|Europe/Helsinki
Ho Chi Minh City|Vietnam|Asia/Ho_Chi_Minh
Hong Kong|China|Asia/Hong_Kong
Honolulu|United States|Pacific/Honolulu
Houston|United States|America/Chicago
Hyderabad|India|Asia/Kolkata
Islamabad|Pakistan|Asia/Karachi
Istanbul|Turkey|Europe/Istanbul
Jakarta|Indonesia|Asia/Jakarta
Jeddah|Saudi Arabia|Asia/Riyadh
Jerusalem|Israel|Asia/Jerusalem
Johannesburg|South Africa|Africa/Johannesburg
Kabul|Afghanistan|Asia/Kabul
Kampala|Uganda|Africa/Kampala
Karachi|Pakistan|Asia/Karachi
Kathmandu|Nepal|Asia/Kathmandu
Khartoum|Sudan|Africa/Khartoum
Kyiv|Ukraine|Europe/Kyiv
Kinshasa|DR Congo|Africa/Kinshasa
Kolkata|India|Asia/Kolkata
Kuala Lumpur|Malaysia|Asia/Kuala_Lumpur
Kuwait City|Kuwait|Asia/Kuwait
Lagos|Nigeria|Africa/Lagos
Lahore|Pakistan|Asia/Karachi
Las Vegas|United States|America/Los_Angeles
Lima|Peru|America/Lima
Lisbon|Portugal|Europe/Lisbon
Ljubljana|Slovenia|Europe/Ljubljana
London|United Kingdom|Europe/London
Los Angeles|United States|America/Los_Angeles
Luanda|Angola|Africa/Luanda
Luxembourg|Luxembourg|Europe/Luxembourg
Lyon|France|Europe/Paris
Madrid|Spain|Europe/Madrid
Male|Maldives|Indian/Maldives
Manchester|United Kingdom|Europe/London
Manila|Philippines|Asia/Manila
Marrakesh|Morocco|Africa/Casablanca
Mecca|Saudi Arabia|Asia/Riyadh
Medellin|Colombia|America/Bogota
Melbourne|Australia|Australia/Melbourne
Mexico City|Mexico|America/Mexico_City
Miami|United States|America/New_York
Milan|Italy|Europe/Rome
Minneapolis|United States|America/Chicago
Minsk|Belarus|Europe/Minsk
Monaco|Monaco|Europe/Monaco
Monterrey|Mexico|America/Monterrey
Montevideo|Uruguay|America/Montevideo
Montreal|Canada|America/Toronto
Moscow|Russia|Europe/Moscow
Mumbai|India|Asia/Kolkata
Munich|Germany|Europe/Berlin
Muscat|Oman|Asia/Muscat
Nairobi|Kenya|Africa/Nairobi
Naples|Italy|Europe/Rome
New Orleans|United States|America/Chicago
New York|United States|America/New_York
Nice|France|Europe/Paris
Novosibirsk|Russia|Asia/Novosibirsk
Osaka|Japan|Asia/Tokyo
Oslo|Norway|Europe/Oslo
Ottawa|Canada|America/Toronto
Panama City|Panama|America/Panama
Paris|France|Europe/Paris
Perth|Australia|Australia/Perth
Philadelphia|United States|America/New_York
Phoenix|United States|America/Phoenix
Phnom Penh|Cambodia|Asia/Phnom_Penh
Port Louis|Mauritius|Indian/Mauritius
Portland|United States|America/Los_Angeles
Porto|Portugal|Europe/Lisbon
Prague|Czechia|Europe/Prague
Pune|India|Asia/Kolkata
Quito|Ecuador|America/Guayaquil
Reykjavik|Iceland|Atlantic/Reykjavik
Riga|Latvia|Europe/Riga
Rio de Janeiro|Brazil|America/Sao_Paulo
Riyadh|Saudi Arabia|Asia/Riyadh
Rome|Italy|Europe/Rome
Saint Petersburg|Russia|Europe/Moscow
Salt Lake City|United States|America/Denver
San Diego|United States|America/Los_Angeles
San Francisco|United States|America/Los_Angeles
San Jose|Costa Rica|America/Costa_Rica
San Juan|Puerto Rico|America/Puerto_Rico
Santiago|Chile|America/Santiago
Santo Domingo|Dominican Republic|America/Santo_Domingo
Sao Paulo|Brazil|America/Sao_Paulo
Sarajevo|Bosnia and Herzegovina|Europe/Sarajevo
Seattle|United States|America/Los_Angeles
Seoul|South Korea|Asia/Seoul
Shanghai|China|Asia/Shanghai
Shenzhen|China|Asia/Shanghai
Singapore|Singapore|Asia/Singapore
Sofia|Bulgaria|Europe/Sofia
Stockholm|Sweden|Europe/Stockholm
Suva|Fiji|Pacific/Fiji
Sydney|Australia|Australia/Sydney
Taipei|Taiwan|Asia/Taipei
Tallinn|Estonia|Europe/Tallinn
Tashkent|Uzbekistan|Asia/Tashkent
Tbilisi|Georgia|Asia/Tbilisi
Tehran|Iran|Asia/Tehran
Tel Aviv|Israel|Asia/Jerusalem
Thimphu|Bhutan|Asia/Thimphu
Tokyo|Japan|Asia/Tokyo
Toronto|Canada|America/Toronto
Tunis|Tunisia|Africa/Tunis
Ulaanbaatar|Mongolia|Asia/Ulaanbaatar
Vancouver|Canada|America/Vancouver
Vienna|Austria|Europe/Vienna
Vilnius|Lithuania|Europe/Vilnius
Vladivostok|Russia|Asia/Vladivostok
Warsaw|Poland|Europe/Warsaw
Washington|United States|America/New_York
Wellington|New Zealand|Pacific/Auckland
Winnipeg|Canada|America/Winnipeg
Yangon|Myanmar|Asia/Yangon
Yekaterinburg|Russia|Asia/Yekaterinburg
Yerevan|Armenia|Asia/Yerevan
Zagreb|Croatia|Europe/Zagreb
Zurich|Switzerland|Europe/Zurich
`

export const CITIES: City[] = RAW.trim()
  .split('\n')
  .map((l) => {
    const [name, country, zone] = l.split('|')
    return { name, country, zone }
  })

export const cityByName = (name: string) => CITIES.find((c) => c.name === name)

/** Minutes ahead of UTC in a zone at a moment. */
export function zoneOffsetMin(zone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(at)
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    const asUtc = Date.UTC(
      g('year'),
      g('month') - 1,
      g('day'),
      g('hour') % 24,
      g('minute'),
    )
    return Math.round(
      (asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000,
    )
  } catch {
    return -at.getTimezoneOffset()
  }
}

/** The wall-clock time in a zone, as a local Date with the same fields (for display and day comparison only). */
export function wallTime(zone: string, at: Date): Date {
  return new Date(
    at.getTime() + (zoneOffsetMin(zone, at) + at.getTimezoneOffset()) * 60_000,
  )
}

export function dayRelation(
  zone: string,
  at: Date,
): 'Today' | 'Tomorrow' | 'Yesterday' {
  const w = wallTime(zone, at)
  const a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const b = new Date(w.getFullYear(), w.getMonth(), w.getDate()).getTime()
  return b > a ? 'Tomorrow' : b < a ? 'Yesterday' : 'Today'
}

export function offsetLabel(zone: string, at: Date): string {
  const diff = zoneOffsetMin(zone, at) + at.getTimezoneOffset()
  if (diff === 0) return 'Same time'
  const h = Math.floor(Math.abs(diff) / 60)
  const m = Math.abs(diff) % 60
  const amount = `${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''}`
  return `${amount} ${diff > 0 ? 'ahead' : 'behind'}`
}
