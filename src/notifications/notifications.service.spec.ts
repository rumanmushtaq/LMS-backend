import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const UID = '5aaaaaaaaaaaaaaaaaaaaaa1';
const NID = '5bbbbbbbbbbbbbbbbbbbbbb2';

const chain = (data: any) => {
  const c: any = {};
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  c.exec = () => Promise.resolve(data);
  return c;
};

describe('NotificationsService', () => {
  it('create persists with userId cast to ObjectId', async () => {
    const save = jest.fn().mockResolvedValue({ _id: NID });
    const model: any = function (doc: any) {
      // userId must have been converted to an ObjectId, not left a string
      expect(typeof doc.userId).not.toBe('string');
      return { save };
    };
    const service = new NotificationsService(model);
    await service.create({ userId: UID, type: 'class', title: 't', content: 'c' } as any);
    expect(save).toHaveBeenCalled();
  });

  it('findAllForUser returns paginated data + meta with unread count', async () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    const model: any = {
      find: jest.fn().mockReturnValue(chain(items)),
      // total, then unreadCount
      countDocuments: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(3),
    };
    const service = new NotificationsService(model);
    const res = await service.findAllForUser(UID, { page: 1, limit: 10 } as any);
    expect(res.data).toHaveLength(2);
    expect(res.meta.total).toBe(7);
    expect(res.meta.totalPages).toBe(1);
    expect(res.meta.unreadCount).toBe(3);
  });

  it('findAllForUser applies the isRead filter', async () => {
    const model: any = {
      find: jest.fn().mockReturnValue(chain([])),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const service = new NotificationsService(model);
    await service.findAllForUser(UID, { isRead: 'true' } as any);
    expect(model.find.mock.calls[0][0].read).toBe(true);
  });

  it('markAsRead returns the updated notification', async () => {
    const model: any = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: NID, read: true }),
    };
    const service = new NotificationsService(model);
    const res = await service.markAsRead(NID, UID);
    expect(res.read).toBe(true);
    // scoped to the owner
    const filter = model.findOneAndUpdate.mock.calls[0][0];
    expect(filter._id).toBeDefined();
    expect(filter.userId).toBeDefined();
  });

  it('markAsRead 404s when nothing matches (wrong owner or missing)', async () => {
    const model: any = { findOneAndUpdate: jest.fn().mockResolvedValue(null) };
    const service = new NotificationsService(model);
    await expect(service.markAsRead(NID, UID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markAllAsRead only touches unread and returns the count', async () => {
    const model: any = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 5 }),
    };
    const service = new NotificationsService(model);
    const res = await service.markAllAsRead(UID);
    expect(res.modifiedCount).toBe(5);
    expect(model.updateMany.mock.calls[0][0].read).toBe(false); // filter: unread only
    expect(model.updateMany.mock.calls[0][1]).toEqual({ read: true });
  });
});
