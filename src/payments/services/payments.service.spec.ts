import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PlatformSettingsService } from './platform-settings.service';
import { PaymentProviderRegistry } from '../providers/provider.registry';
import { FulfilmentRegistry } from './fulfilment.registry';
import {
  Payment,
  PaymentStatus,
  PayoutStatus,
} from '../schemas/payment.schema';
import { RevenueArea } from '../schemas/platform-settings.schema';

/** Minimal stand-in for a mongoose document with save(). */
function makeDoc(data: any) {
  return {
    ...data,
    _id: data._id ?? 'payment-1',
    save: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let model: any;
  let settings: any;
  let registry: any;
  let provider: any;
  let created: any;

  beforeEach(async () => {
    created = null;

    provider = {
      id: 'stripe',
      displayName: 'Card',
      supportedCurrencies: [],
      isConfigured: () => true,
      createPayment: jest.fn().mockResolvedValue({
        providerRef: 'pi_123',
        instruction: { kind: 'client_secret', clientSecret: 'pi_123_secret_x' },
      }),
      parseWebhook: jest.fn(),
      fetchPaymentState: jest.fn(),
    };

    model = {
      create: jest.fn(async (data: any) => {
        created = makeDoc(data);
        return created;
      }),
      findOne: jest.fn(),
      exists: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([]),
    };

    settings = {
      get: jest
        .fn()
        .mockResolvedValue({ enabledProviders: ['stripe'], currency: 'USD' }),
      currency: jest.fn().mockResolvedValue('USD'),
      commissionPercentFor: jest.fn().mockResolvedValue(15),
    };

    registry = {
      get: jest.fn().mockReturnValue(provider),
      getRaw: jest.fn().mockReturnValue(provider),
      availableFor: jest
        .fn()
        .mockReturnValue([{ id: 'stripe', displayName: 'Card' }]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: model },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: PaymentProviderRegistry, useValue: registry },
        {
          provide: FulfilmentRegistry,
          useValue: {
            register: jest.fn(),
            fulfil: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  const startInput = {
    buyerId: '507f1f77bcf86cd799439011',
    sellerId: '507f1f77bcf86cd799439012',
    area: RevenueArea.MATERIALS,
    referenceId: '507f1f77bcf86cd799439013',
    amountMinor: 10000,
    description: 'Study pack',
    providerId: 'stripe',
  };

  describe('startPayment', () => {
    it('records the commission split on the ledger row', async () => {
      const result = await service.startPayment(startInput);

      expect(result.grossMinor).toBe(10000);
      expect(result.commissionMinor).toBe(1500);
      expect(result.netMinor).toBe(8500);
      expect(created.commissionPercent).toBe(15);
      expect(created.payoutStatus).toBe(PayoutStatus.OWED);
    });

    it('writes the ledger row before calling the provider', async () => {
      // A payment that exists at the provider but not locally cannot be
      // reconciled — the webhook arrives with nothing to attach it to.
      const order: string[] = [];
      model.create.mockImplementation(async (data: any) => {
        order.push('ledger');
        created = makeDoc(data);
        return created;
      });
      provider.createPayment.mockImplementation(async () => {
        order.push('provider');
        return {
          providerRef: 'pi_123',
          instruction: { kind: 'client_secret', clientSecret: 's' },
        };
      });

      await service.startPayment(startInput);
      expect(order).toEqual(['ledger', 'provider']);
    });

    it('marks the row failed when the provider rejects it', async () => {
      provider.createPayment.mockRejectedValue(new Error('card network down'));

      await expect(service.startPayment(startInput)).rejects.toThrow(
        'card network down',
      );
      expect(created.status).toBe(PaymentStatus.FAILED);
      expect(created.failureReason).toContain('card network down');
    });

    it('rejects non-positive and non-integer amounts', async () => {
      await expect(
        service.startPayment({ ...startInput, amountMinor: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.startPayment({ ...startInput, amountMinor: -500 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.startPayment({ ...startInput, amountMinor: 10.5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a provider that cannot charge the configured currency', async () => {
      provider.supportedCurrencies = ['COP'];
      await expect(service.startPayment(startInput)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('applyProviderState', () => {
    it('settles a pending payment and stamps paidAt', async () => {
      const doc = makeDoc({
        status: PaymentStatus.PROCESSING,
        grossMinor: 10000,
        payoutStatus: PayoutStatus.OWED,
      });
      model.findOne.mockResolvedValue(doc);

      const settled = await service.applyProviderState({
        providerRef: 'pi_123',
        status: PaymentStatus.PAID,
        amountMinor: 10000,
      });

      expect(settled).toBe(doc);
      expect(doc.status).toBe(PaymentStatus.PAID);
      expect(doc.paidAt).toBeInstanceOf(Date);
    });

    it('ignores a redelivered success instead of settling twice', async () => {
      // Providers retry webhooks. Without this the platform counts the sale
      // twice and believes it owes the seller twice.
      const doc = makeDoc({ status: PaymentStatus.PAID, grossMinor: 10000 });
      model.findOne.mockResolvedValue(doc);

      const settled = await service.applyProviderState({
        providerRef: 'pi_123',
        status: PaymentStatus.PAID,
        amountMinor: 10000,
      });

      expect(settled).toBeNull();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('refuses to settle when the charged amount differs from the priced amount', async () => {
      const doc = makeDoc({
        status: PaymentStatus.PROCESSING,
        grossMinor: 10000,
      });
      model.findOne.mockResolvedValue(doc);

      const settled = await service.applyProviderState({
        providerRef: 'pi_123',
        status: PaymentStatus.PAID,
        amountMinor: 100, // buyer charged far less than we priced
      });

      expect(settled).toBeNull();
      expect(doc.status).toBe(PaymentStatus.FAILED);
      expect(doc.failureReason).toContain('Amount mismatch');
    });

    it('voids what is owed when a payment is refunded', async () => {
      const doc = makeDoc({
        status: PaymentStatus.PROCESSING,
        grossMinor: 10000,
        payoutStatus: PayoutStatus.OWED,
      });
      model.findOne.mockResolvedValue(doc);

      await service.applyProviderState({
        providerRef: 'pi_123',
        status: PaymentStatus.REFUNDED,
      });

      expect(doc.payoutStatus).toBe(PayoutStatus.VOID);
    });

    it('accepts a webhook for an unknown reference without throwing', async () => {
      // Throwing makes the provider retry forever.
      model.findOne.mockResolvedValue(null);

      await expect(
        service.applyProviderState({
          providerRef: 'pi_unknown',
          status: PaymentStatus.PAID,
        }),
      ).resolves.toBeNull();
    });

    it('does not treat a failure as a settlement', async () => {
      const doc = makeDoc({
        status: PaymentStatus.PROCESSING,
        grossMinor: 10000,
      });
      model.findOne.mockResolvedValue(doc);

      const settled = await service.applyProviderState({
        providerRef: 'pi_123',
        status: PaymentStatus.FAILED,
        failureReason: 'card declined',
      });

      expect(settled).toBeNull();
      expect(doc.status).toBe(PaymentStatus.FAILED);
      expect(doc.failureReason).toBe('card declined');
    });
  });
});
