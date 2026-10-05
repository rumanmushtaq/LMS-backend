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
});
