import type { Holding } from '../types/investment'

export interface DonutSegment {
  label: string
  value: number
  color: string
}

export const TYPE_LABELS: Record<string, string> = {
  equity: 'Equity',
  mf: 'Mutual Fund',
  etf: 'ETF',
  bond: 'Bond',
  gold: 'Gold',
  crypto: 'Crypto',
  other: 'Other',
}

export const TYPE_COLORS: Record<string, string> = {
  equity: 'var(--blue)',
  mf: 'var(--purple)',
  etf: '#00B8D4',
  bond: 'var(--accent)',
  gold: '#FFD700',
  crypto: 'var(--green)',
  other: 'var(--text3)',
}

export const ALLOCATION_PALETTE = [
  'var(--blue)',
  'var(--green)',
  'var(--purple)',
  'var(--accent)',
  '#00B8D4',
  '#FFD700',
  'var(--red)',
  'var(--text3)',
]

export function allocationValue(holding: Holding): number {
  return holding.current_value_inr_paise ?? holding.invested_value_inr_paise ?? 0
}

export function allocationLabel(value: string | null | undefined): string {
  const label = value?.trim()
  return label ? label : 'Unknown'
}

export function allocationSegmentsFor(
  holdings: Holding[],
  getLabel: (holding: Holding) => string | null | undefined,
): DonutSegment[] {
  const totals = new Map<string, number>()
  for (const holding of holdings) {
    const label = allocationLabel(getLabel(holding))
    totals.set(label, (totals.get(label) ?? 0) + allocationValue(holding))
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value], index) => ({
      label,
      value,
      color: ALLOCATION_PALETTE[index % ALLOCATION_PALETTE.length],
    }))
}
