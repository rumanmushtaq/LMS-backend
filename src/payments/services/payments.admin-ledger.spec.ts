import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import { PaymentsService } from './payments.service';
import {
  Payment,
  PaymentSchema,
  PaymentStatus,
} from '../schemas/payment.schema';
import { RevenueArea } from '../schemas/platform-settings.schema';

/**
 * The admin transactions view. Filtering and totalling money is a claim about
 * what the database returns, so these run against a real (in-memory) MongoDB
 * rather than a stubbed model that would just echo the query back.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let model: Model<any>;
let service: PaymentsService;

const BUYER = new Types.ObjectId();
const SELLER = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  model = mongoose.model(Payment.name, PaymentSchema as any);
  mongoose.model(
    'User',
    new mongoose.Schema({ firstName: String, lastName: String, email: String }),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  service = new PaymentsService(
    model as any,
    {} as any,
    {} as any,
    {} as any,
  );
});

async function record(over: Partial<Record<string, any>> = {}) {
  return model.create({
    buyerId: BUYER,
    sellerId: SELLER,
    area: RevenueArea.SHOP,
    referenceId: new Types.ObjectId(),
    provider: 'stripe',
    grossMinor: 10_000,
    commissionMinor: 1_500,
    netMinor: 8_500,
    commissionPercent: 15,
    currency: 'USD',
    status: PaymentStatus.PAID,
    ...over,
  });
}

describe('the admin transaction ledger', () => {
  it('lists newest first', async () => {
    await record({ grossMinor: 100 });
    await new Promise((r) => setTimeout(r, 10));
    const newest = await record({ grossMinor: 999 });

    const page = await service.listTransactions({});

    expect(page.data[0]._id.toString()).toBe(newest._id.toString());
    expect(page.totalCount).toBe(2);
  });

  it('narrows to one revenue area', async () => {
    await record({ area: RevenueArea.SHOP });
    await record({ area: RevenueArea.MATERIALS });

    const page = await service.listTransactions({ area: RevenueArea.MATERIALS });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].area).toBe(RevenueArea.MATERIALS);
  });

  it('narrows to one status', async () => {
    await record({ status: PaymentStatus.PAID });
    await record({ status: PaymentStatus.FAILED });

    const page = await service.listTransactions({ status: PaymentStatus.FAILED });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].status).toBe(PaymentStatus.FAILED);
  });

  /**
   * The totals are the reason an admin opens this screen: what came in, what
   * the platform kept, what is owed out. They must count settled money only —
   * a pending or failed payment has moved nothing.
   */
  it('totals only money that actually settled', async () => {
    await record({ grossMinor: 10_000, commissionMinor: 1_500, netMinor: 8_500 });
    await record({ grossMinor: 4_000, commissionMinor: 600, netMinor: 3_400 });
    await record({
      grossMinor: 99_999,
      commissionMinor: 9_999,
      netMinor: 90_000,
      status: PaymentStatus.PENDING,
    });

    const page = await service.listTransactions({});

    expect(page.totals).toEqual({
      grossMinor: 14_000,
      commissionMinor: 2_100,
      netMinor: 11_900,
      currency: 'USD',
    });
  });

  it('pages through a long ledger', async () => {
    for (let i = 0; i < 5; i++) await record({ grossMinor: i + 1 });

    const page = await service.listTransactions({ page: 2, limit: 2 });

    expect(page.data).toHaveLength(2);
    expect(page.totalCount).toBe(5);
    expect(page.totalPages).toBe(3);
    expect(page.currentPage).toBe(2);
  });
});
