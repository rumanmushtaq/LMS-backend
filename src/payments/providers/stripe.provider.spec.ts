import { StripeProvider } from './stripe.provider';
import { ConfigService } from '@nestjs/config';

describe('StripeProvider.refund', () => {
  function makeProvider(refundsCreate: jest.Mock) {
    const config = {
      get: (k: string) => (k === 'stripe.secretKey' ? 'sk_test_x' : undefined),
    } as unknown as ConfigService;
    const provider = new StripeProvider(config);
    // Replace the real client with a stub.
    (provider as any).stripe = { refunds: { create: refundsCreate } };
    return provider;
  }

  it('refunds the whole payment intent when no amount is given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_1' });
    const provider = makeProvider(create);
    await provider.refund('pi_123');
    expect(create).toHaveBeenCalledWith({ payment_intent: 'pi_123' });
  });

  it('refunds a partial amount in minor units when given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_2' });
    const provider = makeProvider(create);
    await provider.refund('pi_123', 500);
    expect(create).toHaveBeenCalledWith({
      payment_intent: 'pi_123',
      amount: 500,
    });
  });

  it('passes the idempotency key so a retried refund is not issued twice', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_3' });
    const provider = makeProvider(create);
    await provider.refund('pi_123', undefined, 'refund_p1');
    expect(create).toHaveBeenCalledWith(
      { payment_intent: 'pi_123' },
      { idempotencyKey: 'refund_p1' },
    );
  });
});

describe('StripeProvider.parseWebhook — dashboard refunds', () => {
  function providerWithEvent(event: any) {
    const config = {
      get: (k: string) =>
        k === 'stripe.secretKey'
          ? 'sk_test_x'
          : k === 'stripe.webhookSecret'
            ? 'whsec_x'
            : undefined,
    } as unknown as ConfigService;
    const provider = new StripeProvider(config);
    (provider as any).stripe = {
      webhooks: { constructEvent: jest.fn().mockReturnValue(event) },
    };
    (provider as any).webhookSecret = 'whsec_x';
    return provider;
  }

  it('maps a full charge.refunded to a REFUNDED state for its intent', async () => {
    const provider = providerWithEvent({
      type: 'charge.refunded',
      data: {
        object: { payment_intent: 'pi_9', refunded: true, amount: 700, currency: 'usd' },
      },
    });
    const state = await provider.parseWebhook('{}', { 'stripe-signature': 's' });
    expect(state).toEqual(
      expect.objectContaining({ providerRef: 'pi_9', status: 'refunded' }),
    );
  });

  it('ignores a partial refund rather than voiding the whole sale', async () => {
    const provider = providerWithEvent({
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_9', refunded: false, amount: 700 } },
    });
    expect(await provider.parseWebhook('{}', { 'stripe-signature': 's' })).toBeNull();
  });
});
