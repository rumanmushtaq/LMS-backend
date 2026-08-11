import { AutoBlockService } from './auto-block.service';

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('AutoBlockService', () => {
  let service: AutoBlockService;
  let ipBlockService: any;

  const configService = {
    // threshold 3, window 10 min, base block 15 min
    get: jest.fn((key: string, fallback: any) =>
      key === 'security.failedLoginThreshold' ? 3 : fallback,
    ),
  };

  beforeEach(() => {
    ipBlockService = {
      isWhitelisted: jest.fn().mockReturnValue(false),
      countRecentAutoBlocks: jest.fn().mockResolvedValue(0),
      block: jest.fn().mockResolvedValue({ _id: 'blk' }),
    };
    const userModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    };
    service = new AutoBlockService(
      configService as any,
      ipBlockService,
      { recordFailedLogin: jest.fn() } as any,
      { create: jest.fn() } as any,
      userModel as any,
    );
  });

  it('does NOT block when one account fails repeatedly (that is per-account lockout territory)', async () => {
    for (let i = 0; i < 10; i++) {
      service.recordFailedLogin('203.0.113.7', 'same@student.com');
    }
    await flushAsync();
    expect(ipBlockService.block).not.toHaveBeenCalled();
  });

  it('blocks when distinct accounts from one IP reach the threshold (credential stuffing)', async () => {
    service.recordFailedLogin('203.0.113.7', 'a@x.com');
    service.recordFailedLogin('203.0.113.7', 'b@x.com');
    service.recordFailedLogin('203.0.113.7', 'c@x.com');
    await flushAsync();
    expect(ipBlockService.block).toHaveBeenCalledTimes(1);
    const arg = ipBlockService.block.mock.calls[0][0];
    expect(arg.type).toBe('auto');
    expect(arg.actor).toBe('system');
    // first offense → base duration (15 min)
    const minutes = (arg.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThan(16);
  });

  it('counts the same email case-insensitively as one account', async () => {
    service.recordFailedLogin('203.0.113.7', 'A@X.com');
    service.recordFailedLogin('203.0.113.7', 'a@x.com');
    service.recordFailedLogin('203.0.113.7', 'a@X.COM');
    await flushAsync();
    expect(ipBlockService.block).not.toHaveBeenCalled();
  });

  it('tracks IPs independently', async () => {
    service.recordFailedLogin('203.0.113.7', 'a@x.com');
    service.recordFailedLogin('203.0.113.8', 'b@x.com');
    service.recordFailedLogin('203.0.113.9', 'c@x.com');
    await flushAsync();
    expect(ipBlockService.block).not.toHaveBeenCalled();
  });

  it('groups an IPv6 attacker by /64 across rotated addresses', async () => {
    service.recordFailedLogin('2001:db8:aa:bb::1', 'a@x.com');
    service.recordFailedLogin('2001:db8:aa:bb::2', 'b@x.com');
    service.recordFailedLogin('2001:db8:aa:bb:ffff::9', 'c@x.com');
    await flushAsync();
    expect(ipBlockService.block).toHaveBeenCalledTimes(1);
  });

  it('never blocks a whitelisted IP', async () => {
    ipBlockService.isWhitelisted.mockReturnValue(true);
    service.recordFailedLogin('203.0.113.7', 'a@x.com');
    service.recordFailedLogin('203.0.113.7', 'b@x.com');
    service.recordFailedLogin('203.0.113.7', 'c@x.com');
    await flushAsync();
    expect(ipBlockService.block).not.toHaveBeenCalled();
  });

  it('escalates repeat offenders: 2 prior auto-blocks this week → 24× base (6h)', async () => {
    ipBlockService.countRecentAutoBlocks.mockResolvedValue(2);
    service.recordFailedLogin('203.0.113.7', 'a@x.com');
    service.recordFailedLogin('203.0.113.7', 'b@x.com');
    service.recordFailedLogin('203.0.113.7', 'c@x.com');
    await flushAsync();
    const arg = ipBlockService.block.mock.calls[0][0];
    const minutes = (arg.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(355);
    expect(minutes).toBeLessThan(365);
  });

  it('ignores failures with no resolvable IP and never throws', async () => {
    expect(() => service.recordFailedLogin(undefined, 'a@x.com')).not.toThrow();
    expect(() => service.recordFailedLogin('garbage', 'b@x.com')).not.toThrow();
    await flushAsync();
    expect(ipBlockService.block).not.toHaveBeenCalled();
  });
});
