import { ConflictException, NotFoundException } from '@nestjs/common';
import { TutorsService } from './tutors.service';

/**
 * Tax forms (W9 / W8-BEN) hold the most sensitive tutor data. These verify the
 * one-form-per-user rule and that updates are scoped to the owner — a tutor can
 * never touch another tutor's form.
 */
const USER = { _id: 'tutor-1' } as any;

function build(opts: { w9?: any; w8?: any; updated?: any } = {}) {
  const w9FormModel: any = {
    findOne: jest.fn().mockResolvedValue(opts.w9 ?? null),
    create: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn().mockResolvedValue(opts.updated ?? null),
  };
  const w8BENFormModel: any = {
    findOne: jest.fn().mockResolvedValue(opts.w8 ?? null),
    create: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn().mockResolvedValue(opts.updated ?? null),
  };
  return {
    service: new TutorsService(w9FormModel, w8BENFormModel),
    w9FormModel,
  };
}

describe('W9 form', () => {
  it('creates a W9 bound to the user when none exists', async () => {
    const { service, w9FormModel } = build();
    await service.createW9Form(USER, { tinNumber: '123' } as any);
    expect(w9FormModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'tutor-1' }),
    );
  });

  it('rejects a second W9 for the same user (409)', async () => {
    const { service } = build({ w9: { _id: 'existing' } });
    await expect(service.createW9Form(USER, {} as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a W9 when the user already filed a W8-BEN (one form only)', async () => {
    const { service } = build({ w8: { _id: 'existing-w8' } });
    await expect(service.createW9Form(USER, {} as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('update is scoped to the owner — filters by _id AND user', async () => {
    const { service, w9FormModel } = build({ updated: { _id: 'f1' } });
    await service.updateW9Form('f1', USER, { tinNumber: 'x' } as any);
    expect(w9FormModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: 'f1',
      user: 'tutor-1',
    });
  });

  it('update 404s when the form is not the caller’s (or missing)', async () => {
    const { service } = build({ updated: null });
    await expect(
      service.updateW9Form('someone-elses', USER, {} as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('W8-BEN form', () => {
  it('rejects a W8-BEN when a W9 already exists', async () => {
    const { service } = build({ w9: { _id: 'existing-w9' } });
    await expect(
      service.createW8BENForm(USER, {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a W8-BEN bound to the user when none exists', async () => {
    const w9FormModel: any = { findOne: jest.fn().mockResolvedValue(null) };
    const w8BENFormModel: any = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    const service = new TutorsService(w9FormModel, w8BENFormModel);
    await service.createW8BENForm(USER, { tinNumber: '9' } as any);
    expect(w8BENFormModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'tutor-1' }),
    );
  });
});
