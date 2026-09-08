import { RevenueArea } from '../../payments/schemas/platform-settings.schema';
import { GroupClassFulfilment } from './group-class.fulfilment';

/**
 * Seats are handed out by the payment, never by the student: this handler is
 * the only thing that calls `join`, and it runs when money has settled.
 */

const CLASS_ID = '6a987be9584429420c0b223c';
const STUDENT = '6a987be9584429420c0b2299';

function makeHandler() {
  const registry: any = { register: jest.fn() };
  const groupClasses: any = { join: jest.fn().mockResolvedValue({}) };
  const handler = new GroupClassFulfilment(registry, groupClasses);
  return { handler, registry, groupClasses };
}

const paymentFor = (buyerId: string): any => ({
  _id: 'pay-1',
  buyerId: { toString: () => buyerId },
  area: RevenueArea.CLASSES,
});

describe('group class fulfilment', () => {
  it('claims the classes revenue area on startup', () => {
    const { handler, registry } = makeHandler();

    handler.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(
      RevenueArea.CLASSES,
      handler,
    );
  });

  it('seats the buyer once their payment settles', async () => {
    const { handler, groupClasses } = makeHandler();

    await handler.onPaid(CLASS_ID, paymentFor(STUDENT));

    expect(groupClasses.join).toHaveBeenCalledWith(CLASS_ID, STUDENT);
  });

  /**
   * The seat may be gone by the time the money lands — two students can both
   * reach checkout for one remaining seat. The failure must surface rather
   * than vanish, because someone has paid for a class they are not in and a
   * human has to refund them.
   */
  it('lets a failed seating surface instead of swallowing it', async () => {
    const { handler, groupClasses } = makeHandler();
    groupClasses.join.mockRejectedValue(new Error('This class is full'));

    await expect(
      handler.onPaid(CLASS_ID, paymentFor(STUDENT)),
    ).rejects.toThrow(/full/i);
  });
});
