/**
 * Money is represented everywhere in the core as an integer number of minor units
 * (1/100 of the currency unit). Never use floating point for stored amounts.
 */
export const MINOR = 100;

export function toMinor(major: number): number {
  return Math.round(major * MINOR);
}

export function toMajor(minor: number): number {
  return minor / MINOR;
}

export function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Gross margin as a percentage with 2 decimals (profit / selling price). */
export function marginPct(profit: number, sellingPrice: number): number {
  if (!sellingPrice) return 0;
  return Math.round((profit / sellingPrice) * 10000) / 100;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
