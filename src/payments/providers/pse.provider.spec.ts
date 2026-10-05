import { PseProvider } from './pse.provider';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '../schemas/payment.schema';
import { createHash } from 'crypto';

const CFG: Record<string, string> = {
  'pse.provider': 'wompi',
  'pse.apiKey': 'pub_test_abc',
  'pse.apiSecret': 'prv_test_abc',
  'pse.webhookSecret': 'events_secret',
  'pse.integritySecret': 'integrity_secret',
  'pse.baseUrl': 'https://sandbox.wompi.co/v1',
  'app.frontendUrl': 'https://app.test',
};

function provider() {
  const config = { get: (k: string) => CFG[k] } as unknown as ConfigService;
  return new PseProvider(config);
}

describe('PseProvider (Wompi)', () => {
  it('is configured only when all Wompi creds are present', () => {
    expect(provider().isConfigured()).toBe(true);
    const partial = new PseProvider({
      get: (k: string) => (k === 'pse.provider' ? 'wompi' : undefined),
    } as unknown as ConfigService);
    expect(partial.isConfigured()).toBe(false);
  });

  it('creates a redirect instruction with a deterministic reference and integrity signature', async () => {
    const res = await provider().createPayment({
      amountMinor: 50000,
      currency: 'COP',
      paymentId: 'pay_1',
      description: 'Order',
      returnUrl: 'https://app.test/cart/confirm',
    });
    expect(res.providerRef).toBe('pay_1');
    expect(res.instruction.kind).toBe('redirect');
    const url = (res.instruction as { kind: 'redirect'; redirectUrl: string })
      .redirectUrl;
    expect(url).toContain('reference=pay_1');
    expect(url).toContain('amount-in-cents=50000');
    expect(url).toContain('currency=COP');
    const expectedSig = createHash('sha256')
      .update('pay_150000COPintegrity_secret')
      .digest('hex');
    expect(url).toContain(`signature%3Aintegrity=${expectedSig}`);
  });

  it('accepts a webhook with a valid checksum and maps APPROVED to PAID', async () => {
    const timestamp = 1700000000;
    const transaction = {
      id: 'wtx_9',
      reference: 'pay_1',
      status: 'APPROVED',
      amount_in_cents: 50000,
      currency: 'COP',
    };
    // Wompi concatenates the values named in signature.properties, then the timestamp, then the events secret.
    const checksum = createHash('sha256')
      .update(
        `${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}events_secret`,
      )
      .digest('hex');
    const body = JSON.stringify({
      event: 'transaction.updated',
      data: { transaction },
      timestamp,
      signature: {
        properties: [
          'transaction.id',
          'transaction.status',
          'transaction.amount_in_cents',
        ],
        checksum,
      },
    });
    const state = await provider().parseWebhook(body, {});
    expect(state).toMatchObject({
      providerRef: 'pay_1',
      status: PaymentStatus.PAID,
      amountMinor: 50000,
    });
  });

  it('rejects a webhook whose checksum does not match', async () => {
    const body = JSON.stringify({
      data: {
        transaction: {
          id: 'wtx_9',
          reference: 'pay_1',
          status: 'APPROVED',
          amount_in_cents: 50000,
        },
      },
      timestamp: 1700000000,
      signature: { properties: ['transaction.id'], checksum: 'deadbeef' },
    });
    await expect(provider().parseWebhook(body, {})).rejects.toThrow();
  });
});
