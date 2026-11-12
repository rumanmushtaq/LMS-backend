import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { MaterialFulfilment } from './material.fulfilment';

/**
 * Access is handed out by the payment, never by the student: this handler is
 * the only writer of a paid purchase row, and it runs when money has settled.
 */

const MATERIAL_ID = '6a553eed9b1c63e770ebb2a2';
const STUDENT = '6a2858ecf0e15b96bfa4ad08';

function makeHandler() {
  const registry: any = { register: jest.fn() };
  const materials: any = {
    grantPurchase: jest.fn().mockResolvedValue(undefined),
    revokePurchase: jest.fn().mockResolvedValue(undefined),
  };
  const handler = new MaterialFulfilment(registry, materials);
  return { handler, registry, materials };
}

const paymentFor = (buyerId: string): any => ({
  _id: { toString: () => 'pay-1' },
  buyerId: { toString: () => buyerId },
  grossMinor: 1999,
  area: RevenueArea.MATERIALS,
});

describe('material fulfilment', () => {
  it('claims the materials revenue area on startup', () => {
    const { handler, registry } = makeHandler();

    handler.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(
      RevenueArea.MATERIALS,
      handler,
    );
  });

  it('grants access to the buyer once their payment settles', async () => {
    const { handler, materials } = makeHandler();

    await handler.onPaid(MATERIAL_ID, paymentFor(STUDENT));

    expect(materials.grantPurchase).toHaveBeenCalledWith({
      studentId: STUDENT,
      materialId: MATERIAL_ID,
      amountPaidMinor: 1999,
      paymentId: 'pay-1',
    });
  });

  it('revokes access when the payment is refunded', async () => {
    const { handler, materials } = makeHandler();

    await handler.onRefunded(MATERIAL_ID, paymentFor(STUDENT));

    expect(materials.revokePurchase).toHaveBeenCalledWith(STUDENT, MATERIAL_ID);
  });
});
