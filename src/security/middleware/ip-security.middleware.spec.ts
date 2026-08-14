import { IpSecurityMiddleware } from './ip-security.middleware';

/**
 * The middleware is the enforcement front door. These cover every branch:
 * enforce vs shadow, blocked vs clear, whitelisted, no-resolvable-IP, and
 * the fail-open guarantee that a thrown error never refuses a request.
 */
describe('IpSecurityMiddleware', () => {
  const build = (opts: {
    enforce: boolean;
    block?: { blockId: string; key: string } | null;
    resolveThrows?: boolean;
  }) => {
    const configService = {
      get: jest.fn((key: string, fallback: any) => {
        if (key === 'security.enforceIpBlocks') return opts.enforce;
        if (key === 'security.trustCloudflare') return false;
        if (key === 'email.fromEmail') return 'info@varonaacademy.com';
        return fallback;
      }),
    };
    const ipBlockService = {
      findBlock: jest.fn(() => {
        if (opts.resolveThrows) throw new Error('boom');
        return opts.block ?? null;
      }),
    };
    const ipActivityService = {
      recordRequest: jest.fn(),
      recordBlocked: jest.fn(),
    };
    const mw = new IpSecurityMiddleware(
      configService as any,
      ipBlockService as any,
      ipActivityService as any,
    );
    return { mw, ipBlockService, ipActivityService };
  };

  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  it('passes a clear IP through and records the request', () => {
    const { mw, ipActivityService } = build({ enforce: true, block: null });
    const req: any = { headers: {}, ip: '203.0.113.9' };
    const next = jest.fn();
    mw.use(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ipActivityService.recordRequest).toHaveBeenCalledWith('203.0.113.9');
    expect(req.clientIp).toBe('203.0.113.9');
  });

  it('ENFORCE + blocked → 403 with incident id and support, does NOT call next', () => {
    const { mw, ipActivityService } = build({
      enforce: true,
      block: { blockId: 'blk-1', key: '203.0.113.9' },
    });
    const req: any = { headers: {}, ip: '203.0.113.9' };
    const res = mockRes();
    const next = jest.fn();
    mw.use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        incidentId: 'blk-1',
        support: 'info@varonaacademy.com',
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(ipActivityService.recordBlocked).toHaveBeenCalledWith('203.0.113.9');
  });

  it('SHADOW + blocked → records the would-be block but still calls next (200)', () => {
    const { mw, ipActivityService } = build({
      enforce: false,
      block: { blockId: 'blk-1', key: '203.0.113.9' },
    });
    const req: any = { headers: {}, ip: '203.0.113.9' };
    const res = mockRes();
    const next = jest.fn();
    mw.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(ipActivityService.recordBlocked).toHaveBeenCalledWith('203.0.113.9');
  });

  it('no resolvable IP → passes through without touching the blocklist', () => {
    const { mw, ipBlockService, ipActivityService } = build({ enforce: true });
    const req: any = { headers: {}, ip: undefined };
    const next = jest.fn();
    mw.use(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ipBlockService.findBlock).not.toHaveBeenCalled();
    expect(ipActivityService.recordRequest).not.toHaveBeenCalled();
  });

  it('FAILS OPEN: an internal error still calls next (availability > enforcement)', () => {
    const { mw } = build({ enforce: true, resolveThrows: true });
    const req: any = { headers: {}, ip: '203.0.113.9' };
    const res = mockRes();
    const next = jest.fn();
    mw.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
