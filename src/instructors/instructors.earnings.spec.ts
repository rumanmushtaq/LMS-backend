import { InstructorsService } from './instructors.service';

/**
 * getMyEarnings aggregates the tutor's orders into the dashboard shape:
 * total revenue, per-month chart buckets, distinct students this month, and a
 * paginated recent-orders list.
 */
function chain(data: any) {
  const c: any = {};
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  c.populate = () => c;
  c.lean = () => ({ exec: () => Promise.resolve(data) });
  return c;
}

function build(allOrders: any[], pagedOrders: any[]) {
  const orderModel: any = {
    find: jest
      .fn()
      .mockReturnValueOnce(chain(allOrders)) // find({instructorId}).lean().exec()
      .mockReturnValueOnce(chain(pagedOrders)), // paged query
    countDocuments: jest.fn(() => ({
      exec: () => Promise.resolve(pagedOrders.length),
    })),
  };
  const service = new InstructorsService({} as any, orderModel, {} as any);
  return { service };
}

describe('getMyEarnings', () => {
  it('empty ledger → zeros across the board', async () => {
    const { service } = build([], []);
    const res = await service.getMyEarnings('tutor-1');
    expect(res.totalRevenue).toBe(0);
    expect(res.earningsByMonth).toHaveLength(12);
    expect(res.earningsByMonth.every((v: number) => v === 0)).toBe(true);
    expect(res.recentOrders).toEqual([]);
    expect(res.studentsThisMonth).toBe(0);
  });

  it('sums revenue, buckets the chart month, counts distinct students this month', async () => {
    const now = new Date();
    const orders = [
      { amountPaid: 100, orderDate: now, studentId: 's1' },
      { amountPaid: 50, orderDate: now, studentId: 's2' },
      { amountPaid: 25, orderDate: now, studentId: 's1' }, // same student again
    ];
    const { service } = build(orders, orders);
    const res = await service.getMyEarnings('tutor-1');

    expect(res.totalRevenue).toBe(175);
    expect(res.earningsByMonth[now.getMonth()]).toBe(175); // chartYear defaults to now
    expect(res.studentsThisMonth).toBe(2); // s1 counted once
  });

  it('does not bucket orders from a different chart year', async () => {
    const orders = [
      { amountPaid: 100, orderDate: new Date('2020-03-10'), studentId: 's1' },
    ];
    const { service } = build(orders, orders);
    const res = await service.getMyEarnings(
      'tutor-1',
      new Date().getFullYear(),
    );
    // total still counts it, but the current-year chart does not
    expect(res.totalRevenue).toBe(100);
    expect(res.earningsByMonth.every((v: number) => v === 0)).toBe(true);
  });

  it('maps recent orders with a short id and the course title', async () => {
    const orders = [
      {
        _id: 'abcdef123456',
        amountPaid: 30,
        orderDate: new Date(),
        studentId: 's1',
        courseId: { title: 'Algebra' },
      },
    ];
    const { service } = build(orders, orders);
    const res = await service.getMyEarnings('tutor-1');
    expect(res.recentOrders[0].courseName).toBe('Algebra');
    expect(res.recentOrders[0].amount).toBe(30);
  });

  it('falls back to "Unknown Course" when the course is missing', async () => {
    const orders = [
      {
        _id: 'x1',
        amountPaid: 10,
        orderDate: new Date(),
        studentId: 's1',
        courseId: null,
      },
    ];
    const { service } = build(orders, orders);
    const res = await service.getMyEarnings('tutor-1');
    expect(res.recentOrders[0].courseName).toBe('Unknown Course');
  });
});
