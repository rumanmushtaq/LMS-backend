import { TutorEarningsService } from './tutor-earnings.service';

function make(aggRows: any[]) {
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: jest.fn().mockResolvedValue([]),
  };
  const paymentModel: any = {
    aggregate: jest.fn().mockResolvedValue(aggRows),
    find: jest.fn(() => chain),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  const resolver: any = { resolve: jest.fn().mockResolvedValue({ label: 'x' }) };
  const settings: any = { currency: jest.fn().mockResolvedValue('USD') };
  const service = new TutorEarningsService(paymentModel, resolver, settings);
  return { service, paymentModel };
}

const rows = [
  {
    _id: 'classes',
    grossMinor: 5000,
    commissionMinor: 750,
    netMinor: 4250,
    owedMinor: 2125,
    paidOutMinor: 2125,
    count: 2,
  },
  {
    _id: 'materials',
    grossMinor: 2000,
    commissionMinor: 300,
    netMinor: 1700,
    owedMinor: 1700,
    paidOutMinor: 0,
    count: 1,
  },
];

describe('TutorEarningsService.summary', () => {
  it('totals net, owed and paid-out across areas', async () => {
    const { service } = make(rows);
    const r = await service.summary('6a2858ecf0e15b96bfa4ad08');
    expect(r.totals.netMinor).toBe(5950);
    expect(r.totals.owedMinor).toBe(3825);
    expect(r.totals.paidOutMinor).toBe(2125);
    expect(r.totals.paymentCount).toBe(3);
    expect(r.currency).toBe('USD');
  });

  it('splits figures by area', async () => {
    const { service } = make(rows);
    const r = await service.summary('6a2858ecf0e15b96bfa4ad08');
    expect(r.byArea.classes.netMinor).toBe(4250);
    expect(r.byArea.materials.netMinor).toBe(1700);
    expect(r.byArea.materials.owedMinor).toBe(1700);
  });

  it('defaults empty areas to zero', async () => {
    const { service } = make([]);
    const r = await service.summary('6a2858ecf0e15b96bfa4ad08');
    expect(r.totals.netMinor).toBe(0);
    expect(r.byArea.classes.netMinor).toBe(0);
    expect(r.byArea.materials.paymentCount).toBe(0);
  });
});
