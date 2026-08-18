/**
 * Money handling for the payments module.
 *
 * Everything here is in **minor units as integers** (cents for USD, pesos for
 * COP). Floats are never used for money: `0.1 + 0.2 !== 0.3`, and a commission
 * split computed in floats will not add back up to the amount the customer was
 * charged. The existing shop code stores prices as float dollars and multiplies
 * by 100 at checkout — new code should read `amountMinor` instead.
 */

/**
 * Currencies with no minor unit, where "1" means one whole unit.
 *
 * Colombian pesos are quoted and charged as whole pesos in practice, and the
 * PSE rails work in whole pesos. Treating COP as 1/100 would charge 100x.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'COP',
  'CLP',
  'JPY',
  'KRW',
  'VND',
  'PYG',
  'XAF',
  'XOF',
]);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

/** How many minor units make one major unit (100 for USD, 1 for COP). */
export function minorUnitsPerMajor(currency: string): number {
  return isZeroDecimal(currency) ? 1 : 100;
}

/**
 * Converts a major-unit amount (what a price field holds today) to minor units.
 *
 * Rounds rather than truncates: 19.99 * 100 is 1998.9999... in binary floating
 * point, and truncation would silently undercharge by a cent.
 */
export function toMinorUnits(major: number, currency: string): number {
  if (!Number.isFinite(major)) {
    throw new Error(`Cannot convert non-finite amount: ${major}`);
  }
  return Math.round(major * minorUnitsPerMajor(currency));
}

/** Minor units back to a major-unit number, for display only. */
export function toMajorUnits(minor: number, currency: string): number {
  return minor / minorUnitsPerMajor(currency);
}

export interface CommissionSplit {
  /** What the customer is charged. */
  grossMinor: number;
  /** What the platform keeps. */
  commissionMinor: number;
  /** What the seller (tutor) is owed. */
  netMinor: number;
  /** The rate actually applied, for the audit trail. */
  commissionPercent: number;
}

/**
 * Splits a gross amount into platform commission and seller net.
 *
 * The commission is rounded and the net is the **remainder**, never rounded
 * independently. Rounding both separately lets them disagree with the gross by
 * a minor unit, which over thousands of orders becomes real money that belongs
 * to nobody and never reconciles.
 */
export function splitCommission(
  grossMinor: number,
  commissionPercent: number,
): CommissionSplit {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error(
      `Gross amount must be a non-negative integer: ${grossMinor}`,
    );
  }
  if (
    !Number.isFinite(commissionPercent) ||
    commissionPercent < 0 ||
    commissionPercent > 100
  ) {
    throw new Error(
      `Commission percent must be between 0 and 100: ${commissionPercent}`,
    );
  }

  const commissionMinor = Math.round((grossMinor * commissionPercent) / 100);
  // Guard against a rate of 100 plus rounding pushing commission past gross.
  const clamped = Math.min(commissionMinor, grossMinor);

  return {
    grossMinor,
    commissionMinor: clamped,
    netMinor: grossMinor - clamped,
    commissionPercent,
  };
}

/** Human-readable amount for emails and receipts. */
export function formatMoney(minor: number, currency: string): string {
  const major = toMajorUnits(minor, currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: isZeroDecimal(currency) ? 0 : 2,
  }).format(major);
}
