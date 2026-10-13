import { ReferenceResolverService } from './reference-resolver.service';
import { RevenueArea } from '../schemas/platform-settings.schema';

const one = (doc: any) => ({ lean: jest.fn().mockResolvedValue(doc) });
const many = (docs: any[]) => ({ lean: jest.fn().mockResolvedValue(docs) });

function make(opts: {
  order?: any;
  klass?: any;
  material?: any;
  products?: any[];
}) {
  const shopOrderModel: any = { findById: jest.fn(() => one(opts.order ?? null)) };
  const classModel: any = { findById: jest.fn(() => one(opts.klass ?? null)) };
  const materialModel: any = {
    findById: jest.fn(() => one(opts.material ?? null)),
  };
  const productModel: any = { find: jest.fn(() => many(opts.products ?? [])) };
  const service = new ReferenceResolverService(
    shopOrderModel,
    classModel,
    materialModel,
    productModel,
  );
  return { service };
}

describe('ReferenceResolverService', () => {
  it('resolves a class to its title', async () => {
    const { service } = make({ klass: { title: 'Algebra crash course' } });
    const r = await service.resolve(RevenueArea.CLASSES, 'c1');
    expect(r).toMatchObject({ label: 'Algebra crash course', available: true });
  });

  it('resolves a material to its title', async () => {
    const { service } = make({ material: { title: 'Physics notes' } });
    const r = await service.resolve(RevenueArea.MATERIALS, 'm1');
    expect(r).toMatchObject({ label: 'Physics notes', available: true });
  });

  it('summarises a shop order from its product names', async () => {
    const { service } = make({
      order: { items: [{ productId: 'p1', quantity: 2 }] },
      products: [{ _id: 'p1', title: 'Tee' }],
    });
    const r = await service.resolve(RevenueArea.SHOP, 'o1');
    expect(r.available).toBe(true);
    expect(r.label).toContain('Tee');
  });

  it('returns unavailable when the record is gone', async () => {
    const { service } = make({ klass: null });
    const r = await service.resolve(RevenueArea.CLASSES, 'missing');
    expect(r).toMatchObject({ available: false, label: 'Item unavailable' });
  });
});
