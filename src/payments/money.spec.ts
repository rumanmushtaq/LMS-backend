import {
  splitCommission,
  toMinorUnits,
  toMajorUnits,
  isZeroDecimal,
  minorUnitsPerMajor,
} from './money';

describe('money', () => {
  describe('currency minor units', () => {
    it('treats COP as zero-decimal so amounts are not charged 100x', () => {
      expect(isZeroDecimal('COP')).toBe(true);
      expect(minorUnitsPerMajor('COP')).toBe(1);
      // 50,000 COP is 50000 minor units, not 5,000,000.
      expect(toMinorUnits(50000, 'COP')).toBe(50000);
    });

    it('treats USD as two-decimal', () => {
      expect(minorUnitsPerMajor('USD')).toBe(100);
      expect(toMinorUnits(19.99, 'USD')).toBe(1999);
    });

    it('is case-insensitive about the currency code', () => {
      expect(isZeroDecimal('cop')).toBe(true);
    });

    it('rounds rather than truncating float artefacts', () => {
      // 19.99 * 100 === 1998.9999999999998 in IEEE-754; truncating would
      // silently undercharge by a cent.
      expect(toMinorUnits(19.99, 'USD')).toBe(1999);
      expect(toMinorUnits(0.29, 'USD')).toBe(29);
    });

    it('documents the exact-half float limitation', () => {
      // 1.005 * 100 is 100.49999999999999, so this rounds DOWN to 100 even
      // though decimal arithmetic says 101. Converting from a float cannot
      // fix this — the input has already lost the information.
      //
      // The error is at most one minor unit and only for exact half-units,
      // which real price lists rarely contain. The durable fix is to stop
      // storing prices as floats (Product.price is a float today) and hold
      // minor units directly; until then this is the known boundary.
      expect(toMinorUnits(1.005, 'USD')).toBe(100);
    });

    it('round-trips through major units', () => {
      expect(toMajorUnits(1999, 'USD')).toBe(19.99);
      expect(toMajorUnits(50000, 'COP')).toBe(50000);
    });

    it('rejects non-finite amounts instead of storing NaN', () => {
      expect(() => toMinorUnits(NaN, 'USD')).toThrow();
      expect(() => toMinorUnits(Infinity, 'USD')).toThrow();
    });
  });

  describe('splitCommission', () => {
    it('splits a clean amount', () => {
      const split = splitCommission(10000, 15);
      expect(split).toMatchObject({
        grossMinor: 10000,
        commissionMinor: 1500,
        netMinor: 8500,
        commissionPercent: 15,
      });
    });

    it('always reconciles: commission + net === gross', () => {
      // The property that matters. If these ever disagree, the platform's
      // books contain money belonging to nobody.
      for (let gross = 1; gross <= 2000; gross++) {
        for (const percent of [0, 3, 7.5, 15, 33.333, 50, 99, 100]) {
          const s = splitCommission(gross, percent);
          expect(s.commissionMinor + s.netMinor).toBe(gross);
          expect(s.commissionMinor).toBeGreaterThanOrEqual(0);
          expect(s.netMinor).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('gives the rounding remainder to the seller, never creating money', () => {
      // 333 at 15% is 49.95 — commission rounds to 50, seller gets the rest.
      const s = splitCommission(333, 15);
      expect(s.commissionMinor).toBe(50);
      expect(s.netMinor).toBe(283);
      expect(s.commissionMinor + s.netMinor).toBe(333);
    });

    it('handles the smallest chargeable amount', () => {
      const s = splitCommission(1, 15);
      expect(s.commissionMinor).toBe(0);
      expect(s.netMinor).toBe(1);
    });

    it('takes everything at 100% and leaves the seller nothing', () => {
      const s = splitCommission(10000, 100);
      expect(s.commissionMinor).toBe(10000);
      expect(s.netMinor).toBe(0);
    });

    it('takes nothing at 0%', () => {
      const s = splitCommission(10000, 0);
      expect(s.commissionMinor).toBe(0);
      expect(s.netMinor).toBe(10000);
    });

    it('never lets commission exceed gross', () => {
      const s = splitCommission(3, 99.999);
      expect(s.commissionMinor).toBeLessThanOrEqual(3);
      expect(s.netMinor).toBeGreaterThanOrEqual(0);
    });

    it('rejects a zero-amount gross being split as a float', () => {
      expect(() => splitCommission(10.5, 15)).toThrow();
    });

    it('rejects negative amounts', () => {
      // A negative line item was how the old checkout could be manipulated.
      expect(() => splitCommission(-100, 15)).toThrow();
    });

    it('rejects out-of-range commission rates', () => {
      expect(() => splitCommission(1000, -1)).toThrow();
      expect(() => splitCommission(1000, 101)).toThrow();
      expect(() => splitCommission(1000, NaN)).toThrow();
    });
  });
});
