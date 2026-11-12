import { PayoutSchema } from './payout.schema';

describe('PayoutSchema', () => {
  it('declares the payout ledger fields', () => {
    for (const p of [
      'tutorId',
      'amountMinor',
      'currency',
      'method',
      'note',
      'reference',
      'paymentIds',
      'createdBy',
    ]) {
      expect(PayoutSchema.path(p)).toBeDefined();
    }
  });

  it('requires a non-negative amountMinor', () => {
    const amount = PayoutSchema.path('amountMinor') as any;
    expect(amount.isRequired).toBe(true);
    expect(amount.options.min).toBe(0);
  });

  it('indexes tutorId with newest-first createdAt', () => {
    const idx = PayoutSchema.indexes().find(
      ([keys]: any) => keys.tutorId === 1 && keys.createdAt === -1,
    );
    expect(idx).toBeDefined();
  });
});
