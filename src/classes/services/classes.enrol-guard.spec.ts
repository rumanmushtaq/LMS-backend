import { BadRequestException } from '@nestjs/common';
import { ClassesService } from './classes.service';

/**
 * `POST /classes/:id/enroll` predates group classes: it adds the caller to the
 * roster with no payment involved. That is still right for a private
 * one-to-one class, but on a group class it would hand out a paid seat for
 * free, so it must refuse them — seats there come only from settled payments,
 * through GroupClassFulfilment.
 */

const CLASS_ID = '6a987be9584429420c0b223c';
const STUDENT = '6a987be9584429420c0b2299';

function makeService(cls: any) {
  const classSessionModel: any = {};
  const service = new ClassesService(
    classSessionModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue(cls);
  return service;
}

describe('enrollStudent', () => {
  it('refuses to seat anyone in a group class for free', async () => {
    const service = makeService({
      _id: CLASS_ID,
      visibility: 'group',
      students: [],
      save: jest.fn(),
    });

    await expect(service.enrollStudent(CLASS_ID, STUDENT)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('still enrols into a private one-to-one class', async () => {
    const save = jest.fn().mockResolvedValue({});
    const students: any[] = [];
    const service = makeService({
      _id: CLASS_ID,
      visibility: 'private',
      students,
      save,
    });

    await service.enrollStudent(CLASS_ID, STUDENT);

    expect(students).toHaveLength(1);
    expect(save).toHaveBeenCalled();
  });
});
