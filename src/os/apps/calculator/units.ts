/** Unit conversion. Every linear unit is a factor to its category's base unit; temperature is affine. */

export interface Unit {
  id: string
  name: string
  symbol: string
  /** How many base units one of this unit is. */
  factor: number
}

export interface Category {
  id: string
  name: string
  units: Unit[]
  /** Default pair shown when the category is opened. */
  pair: [string, string]
}

const u = (id: string, name: string, symbol: string, factor: number): Unit => ({
  id,
  name,
  symbol,
  factor,
})

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    name: 'Length',
    pair: ['m', 'ft'],
    units: [
      u('nm', 'Nanometres', 'nm', 1e-9),
      u('um', 'Micrometres', 'µm', 1e-6),
      u('mm', 'Millimetres', 'mm', 1e-3),
      u('cm', 'Centimetres', 'cm', 1e-2),
      u('m', 'Metres', 'm', 1),
      u('km', 'Kilometres', 'km', 1e3),
      u('in', 'Inches', 'in', 0.0254),
      u('ft', 'Feet', 'ft', 0.3048),
      u('yd', 'Yards', 'yd', 0.9144),
      u('mi', 'Miles', 'mi', 1609.344),
      u('nmi', 'Nautical miles', 'nmi', 1852),
    ],
  },
  {
    id: 'mass',
    name: 'Mass',
    pair: ['kg', 'lb'],
    units: [
      u('mg', 'Milligrams', 'mg', 1e-6),
      u('g', 'Grams', 'g', 1e-3),
      u('kg', 'Kilograms', 'kg', 1),
      u('t', 'Tonnes', 't', 1000),
      u('oz', 'Ounces', 'oz', 0.028349523125),
      u('lb', 'Pounds', 'lb', 0.45359237),
      u('st', 'Stone', 'st', 6.35029318),
      u('ton', 'US tons', 'ton', 907.18474),
      u('ct', 'Carats', 'ct', 0.0002),
    ],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    pair: ['c', 'f'],
    units: [
      u('c', 'Celsius', '°C', 1),
      u('f', 'Fahrenheit', '°F', 1),
      u('k', 'Kelvin', 'K', 1),
    ],
  },
  {
    id: 'volume',
    name: 'Volume',
    pair: ['l', 'galus'],
    units: [
      u('ml', 'Millilitres', 'mL', 1e-3),
      u('l', 'Litres', 'L', 1),
      u('m3', 'Cubic metres', 'm³', 1000),
      u('tsp', 'Teaspoons (US)', 'tsp', 0.00492892159375),
      u('tbsp', 'Tablespoons (US)', 'tbsp', 0.01478676478125),
      u('floz', 'Fluid ounces (US)', 'fl oz', 0.0295735295625),
      u('cup', 'Cups (US)', 'cup', 0.2365882365),
      u('pt', 'Pints (US)', 'pt', 0.473176473),
      u('qt', 'Quarts (US)', 'qt', 0.946352946),
      u('galus', 'Gallons (US)', 'gal', 3.785411784),
      u('galuk', 'Gallons (UK)', 'gal UK', 4.54609),
      u('ft3', 'Cubic feet', 'ft³', 28.316846592),
    ],
  },
  {
    id: 'area',
    name: 'Area',
    pair: ['m2', 'ft2'],
    units: [
      u('mm2', 'Square millimetres', 'mm²', 1e-6),
      u('cm2', 'Square centimetres', 'cm²', 1e-4),
      u('m2', 'Square metres', 'm²', 1),
      u('ha', 'Hectares', 'ha', 1e4),
      u('km2', 'Square kilometres', 'km²', 1e6),
      u('in2', 'Square inches', 'in²', 0.00064516),
      u('ft2', 'Square feet', 'ft²', 0.09290304),
      u('yd2', 'Square yards', 'yd²', 0.83612736),
      u('ac', 'Acres', 'ac', 4046.8564224),
      u('mi2', 'Square miles', 'mi²', 2589988.110336),
    ],
  },
  {
    id: 'speed',
    name: 'Speed',
    pair: ['kmh', 'mph'],
    units: [
      u('ms', 'Metres per second', 'm/s', 1),
      u('kmh', 'Kilometres per hour', 'km/h', 1 / 3.6),
      u('mph', 'Miles per hour', 'mph', 0.44704),
      u('fts', 'Feet per second', 'ft/s', 0.3048),
      u('kn', 'Knots', 'kn', 1852 / 3600),
      u('mach', 'Mach (sea level)', 'Ma', 340.29),
    ],
  },
  {
    id: 'time',
    name: 'Time',
    pair: ['h', 'min'],
    units: [
      u('ms', 'Milliseconds', 'ms', 1e-3),
      u('s', 'Seconds', 's', 1),
      u('min', 'Minutes', 'min', 60),
      u('h', 'Hours', 'h', 3600),
      u('d', 'Days', 'd', 86400),
      u('wk', 'Weeks', 'wk', 604800),
      u('mo', 'Months (avg)', 'mo', 2629746),
      u('yr', 'Years (avg)', 'yr', 31556952),
    ],
  },
  {
    id: 'data',
    name: 'Data',
    pair: ['GB', 'MiB'],
    units: [
      u('bit', 'Bits', 'bit', 1 / 8),
      u('B', 'Bytes', 'B', 1),
      u('kB', 'Kilobytes', 'kB', 1e3),
      u('KiB', 'Kibibytes', 'KiB', 1024),
      u('MB', 'Megabytes', 'MB', 1e6),
      u('MiB', 'Mebibytes', 'MiB', 1024 ** 2),
      u('GB', 'Gigabytes', 'GB', 1e9),
      u('GiB', 'Gibibytes', 'GiB', 1024 ** 3),
      u('TB', 'Terabytes', 'TB', 1e12),
      u('TiB', 'Tebibytes', 'TiB', 1024 ** 4),
      u('PB', 'Petabytes', 'PB', 1e15),
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    pair: ['kcal', 'kJ'],
    units: [
      u('J', 'Joules', 'J', 1),
      u('kJ', 'Kilojoules', 'kJ', 1e3),
      u('cal', 'Calories', 'cal', 4.184),
      u('kcal', 'Kilocalories', 'kcal', 4184),
      u('Wh', 'Watt-hours', 'Wh', 3600),
      u('kWh', 'Kilowatt-hours', 'kWh', 3.6e6),
      u('eV', 'Electronvolts', 'eV', 1.602176634e-19),
      u('BTU', 'BTU', 'BTU', 1055.05585262),
    ],
  },
  {
    id: 'pressure',
    name: 'Pressure',
    pair: ['bar', 'psi'],
    units: [
      u('Pa', 'Pascals', 'Pa', 1),
      u('kPa', 'Kilopascals', 'kPa', 1e3),
      u('bar', 'Bar', 'bar', 1e5),
      u('atm', 'Atmospheres', 'atm', 101325),
      u('psi', 'Pounds per square inch', 'psi', 6894.757293168),
      u('mmHg', 'Millimetres of mercury', 'mmHg', 133.322387415),
      u('inHg', 'Inches of mercury', 'inHg', 3386.389),
    ],
  },
  {
    id: 'angle',
    name: 'Angle',
    pair: ['deg', 'rad'],
    units: [
      u('deg', 'Degrees', '°', Math.PI / 180),
      u('rad', 'Radians', 'rad', 1),
      u('grad', 'Gradians', 'grad', Math.PI / 200),
      u('arcmin', 'Arcminutes', '′', Math.PI / 10800),
      u('arcsec', 'Arcseconds', '″', Math.PI / 648000),
      u('turn', 'Turns', 'turn', 2 * Math.PI),
    ],
  },
]

export const categoryById = (id: string) =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]

function toCelsius(v: number, from: string): number {
  if (from === 'f') return ((v - 32) * 5) / 9
  if (from === 'k') return v - 273.15
  return v
}
function fromCelsius(c: number, to: string): number {
  if (to === 'f') return (c * 9) / 5 + 32
  if (to === 'k') return c + 273.15
  return c
}

export function convert(
  categoryId: string,
  from: string,
  to: string,
  value: number,
): number {
  if (!Number.isFinite(value)) return NaN
  if (from === to) return value
  if (categoryId === 'temperature')
    return Number(fromCelsius(toCelsius(value, from), to).toPrecision(12))
  const cat = categoryById(categoryId)
  const a = cat.units.find((x) => x.id === from)
  const b = cat.units.find((x) => x.id === to)
  if (!a || !b) return NaN
  return Number(((value * a.factor) / b.factor).toPrecision(12))
}
