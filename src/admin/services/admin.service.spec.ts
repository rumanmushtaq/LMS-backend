import { AdminService } from './admin.service';
import { UserRole } from '../../users/schemas/user.schema';

/**
 * getGrowthAnalytics turns raw per-month signup counts into a cumulative
 * growth curve. These lock in the parts that are easy to get subtly wrong:
 * the running total sits on top of a baseline, the series never goes down,
 * the window is exactly N months ending with the current one, and the delta
 * reports only the most recent month.
 */

// A fixed "now" so the month labels and bucket keys are deterministic.
const NOW = new Date('2026-08-15T12:00:00.000Z');

interface RoleData {
  baseline: number;
  monthly: { _id: string; count: number }[];
}

function build(tutor: RoleData, student: RoleData) {
  const userModel: any = {
    // Baseline counts (createdAt < windowStart) — branch on the role filter so
    // the result does not depend on Promise.all ordering.
    countDocuments: jest.fn((filter: any) =>
      Promise.resolve(
        filter.role === UserRole.TUTOR ? tutor.baseline : student.baseline,
      ),
    ),
    // Per-month new signups within the window.
    aggregate: jest.fn((pipeline: any[]) =>
      Promise.resolve(
        pipeline[0].$match.role === UserRole.TUTOR
          ? tutor.monthly
          : student.monthly,
      ),
    ),
  };
  const configService: any = { get: jest.fn().mockReturnValue(10) };
  const emailService: any = {};
  return new AdminService(userModel, configService, emailService);
}

describe('AdminService.getGrowthAnalytics', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns exactly `months` buckets ending at the current month', async () => {
    const service = build(
      { baseline: 0, monthly: [] },
      { baseline: 0, monthly: [] },
    );
    const res = await service.getGrowthAnalytics(12);

    expect(res.categories).toHaveLength(12);
    // Window is Sep '25 → Aug '26 for a NOW of Aug 2026.
    expect(res.categories[0]).toBe("Sep '25");
    expect(res.categories[11]).toBe('Aug');
  });

  it('respects a custom month count', async () => {
    const service = build(
      { baseline: 0, monthly: [] },
      { baseline: 0, monthly: [] },
    );
    const res = await service.getGrowthAnalytics(6);
    expect(res.categories).toHaveLength(6);
  });

  it('adds each month on top of the baseline into a monotonic running total', async () => {
    const service = build(
      {
        baseline: 2,
        monthly: [
          { _id: '2026-06', count: 5 },
          { _id: '2026-08', count: 3 },
        ],
      },
      { baseline: 1, monthly: [{ _id: '2026-05', count: 4 }] },
    );

    const res = await service.getGrowthAnalytics(12);

    // teachers: 2 until Jun (+5 → 7), Jul 7, Aug (+3 → 10)
    expect(res.teachers).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 7, 7, 10]);
    // students: 1 until May (+4 → 5), then flat
    expect(res.students).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5]);

    // never decreases
    const nonDecreasing = (a: number[]) =>
      a.every((v, i) => i === 0 || v >= a[i - 1]);
    expect(nonDecreasing(res.teachers)).toBe(true);
    expect(nonDecreasing(res.students)).toBe(true);
  });

  it('reports the delta as only the most recent month’s new signups', async () => {
    const service = build(
      {
        baseline: 2,
        monthly: [
          { _id: '2026-06', count: 5 },
          { _id: '2026-08', count: 3 },
        ],
      },
      { baseline: 1, monthly: [{ _id: '2026-05', count: 4 }] },
    );

    const res = await service.getGrowthAnalytics(12);
    expect(res.teacherDelta).toBe(3); // Aug had 3 new teachers
    expect(res.studentDelta).toBe(0); // no new students in Aug
  });

  it('handles an empty platform with all-zero series and deltas', async () => {
    const service = build(
      { baseline: 0, monthly: [] },
      { baseline: 0, monthly: [] },
    );
    const res = await service.getGrowthAnalytics(12);

    expect(res.teachers).toEqual(new Array(12).fill(0));
    expect(res.students).toEqual(new Array(12).fill(0));
    expect(res.teacherDelta).toBe(0);
    expect(res.studentDelta).toBe(0);
  });

  it('carries a pre-window baseline through as the starting value', async () => {
    const service = build(
      { baseline: 8, monthly: [] },
      { baseline: 3, monthly: [] },
    );
    const res = await service.getGrowthAnalytics(12);

    // No new signups in the window → flat lines at the baseline.
    expect(res.teachers.every((v) => v === 8)).toBe(true);
    expect(res.students.every((v) => v === 3)).toBe(true);
  });
});
