const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export function formatMoney(paise: number, currency = 'INR', compact = false): string {
  const sign = paise < 0 ? '-' : ''
  const value = BigInt(Math.abs(paise))
  const units = value / 100n
  const fraction = value % 100n
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `

  if (compact && currency === 'INR') {
    const numericUnits = Number(units)
    if (numericUnits >= 10_000_000) return `${sign}${symbol}${trimDecimal(numericUnits / 10_000_000)}Cr`
    if (numericUnits >= 100_000) return `${sign}${symbol}${trimDecimal(numericUnits / 100_000)}L`
  }

  const grouped = currency === 'INR' ? groupIndian(units.toString()) : groupWestern(units.toString())
  const paiseSuffix = fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`
  return `${sign}${symbol}${grouped}${paiseSuffix}`
}

export function formatDateDisplay(value: string): string {
  const date = value.split(' ')[0]
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function paiseToInput(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const value = BigInt(Math.abs(paise))
  const units = value / 100n
  const fraction = value % 100n
  return fraction === 0n
    ? `${sign}${units.toString()}`
    : `${sign}${units.toString()}.${fraction.toString().padStart(2, '0')}`
}

export function parseMoneyInput(value: string): number {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) {
    throw new Error('Use a non-negative amount with up to 2 decimal places')
  }

  const [units, fraction = ''] = cleaned.split('.')
  const paise = BigInt(units || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  if (paise > max) throw new Error('Amount is too large')
  return Number(paise)
}

function groupIndian(value: string): string {
  if (value.length <= 3) return value
  const lastThree = value.slice(-3)
  const rest = value.slice(0, -3)
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`
}

function groupWestern(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
