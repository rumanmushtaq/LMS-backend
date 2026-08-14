import { IpActivityService } from './ip-activity.service';

/**
 * The activity service buffers per-request counters in memory and flushes
 * them as one bulkWrite. These cover the buffering/aggregation contract and
 * the guarantees that matter: bad IPs are dropped, and a flush failure never
 * throws into the request path.
 */
describe('IpActivityService', () => {
  let service: IpActivityService;
  let bulkWrite: jest.Mock;

  beforeEach(() => {
    bulkWrite = jest.fn().mockResolvedValue({});
    service = new IpActivityService({ bulkWrite } as any);
  });

  it('coalesces many requests from one IP in one hour into a single upsert', async () => {
    for (let i = 0; i < 5; i++) service.recordRequest('203.0.113.7');
    service.recordFailedLogin('203.0.113.7');
    service.recordUser('203.0.113.7', 'user-1');
    await service.flush();

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1); // one bucket, not seven writes
    const update = ops[0].updateOne.update;
    expect(update.$inc.requests).toBe(5);
    expect(update.$inc.failedLogins).toBe(1);
    expect(update.$addToSet.userIds.$each).toEqual(['user-1']);
    expect(ops[0].updateOne.upsert).toBe(true);
  });

  it('normalizes the IPv4-mapped form so ::ffff:x and x share one bucket', async () => {
    service.recordRequest('203.0.113.7');
    service.recordRequest('::ffff:203.0.113.7');
    await service.flush();
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$inc.requests).toBe(2);
  });

  it('drops unparseable IPs instead of recording them', async () => {
    service.recordRequest('garbage');
    service.recordRequest('');
    service.recordRequest(undefined as any);
    await service.flush();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('separates distinct IPs into distinct buckets', async () => {
    service.recordRequest('203.0.113.7');
    service.recordRequest('8.8.8.8');
    await service.flush();
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
  });

  it('flush with an empty buffer is a no-op', async () => {
    await service.flush();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('a flush failure is swallowed, never thrown into the request path', async () => {
    bulkWrite.mockRejectedValueOnce(new Error('mongo down'));
    service.recordRequest('203.0.113.7');
    await expect(service.flush()).resolves.not.toThrow();
  });

  it('clears the buffer after flushing so counts do not double', async () => {
    service.recordRequest('203.0.113.7');
    await service.flush();
    await service.flush(); // nothing new buffered
    expect(bulkWrite).toHaveBeenCalledTimes(1);
  });
});
