import { IpBlockService } from './ip-block.service';

/** Builds the .find().select().lean() chain the refresh path uses. */
const findChain = (docs: any[]) => ({
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) }),
  }),
});

describe('IpBlockService.findBlock', () => {
  let service: IpBlockService;

  beforeEach(async () => {
    const blockedIpModel = findChain([
      { _id: 'b-exact', key: '203.0.113.7' },
      { _id: 'b-range', key: '10.0.0.0/8' },
      { _id: 'b-v6', key: '2001:db8:aa:bb::/64' },
      { _id: 'b-wl', key: '198.51.100.4' }, // blocked AND whitelisted
    ]);
    const whitelistModel = findChain([
      { key: '198.51.100.4' },
      { key: '192.168.0.0/16' },
    ]);
    service = new IpBlockService(
      blockedIpModel as any,
      whitelistModel as any,
      { create: jest.fn() } as any,
    );
    await service.refresh();
  });

  it('matches an exact IPv4 block, including the v4-mapped form', () => {
    expect(service.findBlock('203.0.113.7')?.blockId).toBe('b-exact');
    expect(service.findBlock('::ffff:203.0.113.7')?.blockId).toBe('b-exact');
  });

  it('matches CIDR ranges', () => {
    expect(service.findBlock('10.44.55.66')?.blockId).toBe('b-range');
    expect(service.findBlock('11.0.0.1')).toBeNull();
  });

  it('matches any host inside a blocked IPv6 /64', () => {
    expect(service.findBlock('2001:db8:aa:bb:1234::1')?.blockId).toBe('b-v6');
    expect(service.findBlock('2001:db8:aa:bc::1')).toBeNull();
  });

  it('whitelist always wins over a block', () => {
    expect(service.findBlock('198.51.100.4')).toBeNull();
    expect(service.findBlock('192.168.9.9')).toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(service.findBlock('not-an-ip')).toBeNull();
    expect(service.findBlock('')).toBeNull();
  });

  it('fails open: a refresh error keeps serving the previous cache', async () => {
    const failing = {
      find: jest.fn(() => {
        throw new Error('mongo down');
      }),
    };
    (service as any).blockedIpModel = failing;
    (service as any).whitelistModel = failing;
    await service.refresh(); // must not throw
    expect(service.findBlock('203.0.113.7')?.blockId).toBe('b-exact');
  });

  it('isWhitelisted matches exact and CIDR entries, rejects garbage', () => {
    expect(service.isWhitelisted('198.51.100.4')).toBe(true); // exact
    expect(service.isWhitelisted('192.168.5.5')).toBe(true); // /16 range
    expect(service.isWhitelisted('8.8.8.8')).toBe(false);
    expect(service.isWhitelisted('garbage')).toBe(false);
  });
});

describe('IpBlockService.block / unblock', () => {
  it('blocks an IPv6 address under its /64 key and writes an audit entry', async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 'x', key: '2001:db8:aa:bb::/64' });
    const create = jest.fn().mockResolvedValue({});
    const blockedIpModel = {
      findOneAndUpdate,
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    };
    const whitelistModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    };
    const service = new IpBlockService(
      blockedIpModel as any,
      whitelistModel as any,
      { create } as any,
    );
    await service.block({
      ipOrCidr: '2001:db8:aa:bb:1:2:3:4',
      reason: 'test',
      type: 'manual' as any,
      actor: 'admin-1',
      actorName: 'Admin',
      expiresAt: null,
    });
    // Stored under the /64 key, not the literal address.
    expect(findOneAndUpdate.mock.calls[0][1].key).toBe('2001:db8:aa:bb::/64');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects an unparseable block target', async () => {
    const service = new IpBlockService(
      { findOneAndUpdate: jest.fn() } as any,
      {} as any,
      { create: jest.fn() } as any,
    );
    await expect(
      service.block({
        ipOrCidr: 'not-an-ip',
        reason: 'x',
        type: 'manual' as any,
        actor: 'a',
        actorName: 'A',
        expiresAt: null,
      }),
    ).rejects.toThrow();
  });

  it('unblock returns false when nothing was blocked under that key', async () => {
    const service = new IpBlockService(
      { findOneAndDelete: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      { create: jest.fn() } as any,
    );
    const removed = await service.unblock({
      key: '1.2.3.4',
      actor: 'a',
      actorName: 'A',
      reason: 'r',
    });
    expect(removed).toBe(false);
  });
});
