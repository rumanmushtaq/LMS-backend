import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

const cfg = { get: () => 'fake-key' } as any;

function build(model: any) {
  return new CategoriesService(model, cfg);
}

describe('CategoriesService CRUD', () => {
  it('creates a category (default active, no image without a file)', async () => {
    const save = jest.fn().mockResolvedValue({ _id: 'c1' });
    const model: any = function (doc: any) {
      expect(doc.isActive).toBe(true); // default when unspecified
      expect(doc.image).toBe('');
      return { save };
    };
    const service = build(model);
    await service.create({ title: 'Art' } as any);
    expect(save).toHaveBeenCalled();
  });

  it('coerces the isActive string to a boolean on create', async () => {
    let captured: any;
    const model: any = function (doc: any) {
      captured = doc;
      return { save: jest.fn().mockResolvedValue({}) };
    };
    const service = build(model);
    await service.create({ title: 'Art', isActive: 'false' } as any);
    expect(captured.isActive).toBe(false);
  });

  it('findOne 404s for a missing category', async () => {
    const model: any = { findById: () => ({ exec: () => Promise.resolve(null) }) };
    const service = build(model);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update 404s when the category is missing', async () => {
    const model: any = { findById: jest.fn().mockResolvedValue(null) };
    const service = build(model);
    await expect(service.update('nope', {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove 404s when nothing was deleted', async () => {
    const model: any = {
      findByIdAndDelete: () => ({ exec: () => Promise.resolve(null) }),
    };
    const service = build(model);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove returns a success message when deleted', async () => {
    const model: any = {
      findByIdAndDelete: () => ({ exec: () => Promise.resolve({ _id: 'c1' }) }),
    };
    const service = build(model);
    await expect(service.remove('c1')).resolves.toEqual({
      message: 'Category deleted successfully',
    });
  });
});
