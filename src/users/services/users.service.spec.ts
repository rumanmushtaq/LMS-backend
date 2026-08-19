import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Profile update + student administration. Focus: kycData is merged (not
 * clobbered), the tutor passthrough fields persist, price is written to both
 * keys the two views read, and student-status changes are role-scoped.
 */
function build(user: any = null) {
  const userModel: any = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(user) })),
    findOneAndUpdate: jest.fn(() => ({ exec: () => Promise.resolve(user) })),
    findOne: jest.fn(() => ({ exec: () => Promise.resolve(user) })),
  };
  const service = new UsersService(userModel);
  return { service, userModel };
}

const makeUser = (over: any = {}) => ({
  _id: 'u1',
  firstName: 'Old',
  lastName: 'Name',
  role: 'tutor',
  kycData: { phone: '111', existing: 'keep-me' },
  markModified: jest.fn(),
  save: jest.fn().mockResolvedValue(true),
  ...over,
});

describe('updateProfile', () => {
  it('404s when the user does not exist', async () => {
    const { service } = build(null);
    await expect(
      service.updateProfile('missing', { firstName: 'X' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates top-level names and merges kycData without dropping existing keys', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', {
      firstName: 'New',
      phone: '999',
    } as any);
    expect(user.firstName).toBe('New');
    expect(user.kycData.phone).toBe('999');
    expect(user.kycData.existing).toBe('keep-me'); // not clobbered
    expect(user.markModified).toHaveBeenCalledWith('kycData');
    expect(user.save).toHaveBeenCalled();
  });

  it('stores dob verbatim (no timezone mangling on the server)', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', { dob: '1990-05-15' } as any);
    expect(user.kycData.dob).toBe('1990-05-15');
  });

  it('writes pricePerHour to BOTH pricePerHour and hourlyRate (the two views agree)', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', { pricePerHour: 42 } as any);
    expect(user.kycData.pricePerHour).toBe(42);
    expect(user.kycData.hourlyRate).toBe(42);
  });

  it('persists tutor passthrough fields (specialties, availability, social…)', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', {
      specialties: ['Algebra'],
      availability: [{ day: 'Monday', startTime: '09:00', endTime: '17:00' }],
      social: { linkedin: 'x' },
    } as any);
    expect(user.kycData.specialties).toEqual(['Algebra']);
    expect(user.kycData.availability).toHaveLength(1);
    expect(user.kycData.social.linkedin).toBe('x');
  });

  it('bio is mirrored to aboutMe (the instructor page reads aboutMe)', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', { bio: 'Hello' } as any);
    expect(user.kycData.bio).toBe('Hello');
    expect(user.kycData.aboutMe).toBe('Hello');
  });

  it('does not touch kycData when only names change', async () => {
    const user = makeUser();
    const { service } = build(user);
    await service.updateProfile('u1', { firstName: 'Z' } as any);
    expect(user.markModified).not.toHaveBeenCalled();
  });
});

describe('student administration (role-scoped)', () => {
  it('suspendStudent flips status to suspended, scoped to role student', async () => {
    const student = makeUser({
      role: 'student',
      email: 's@x.com',
      status: 'active',
    });
    const { service, userModel } = build(student);
    await service.suspendStudent('s1');
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 's1', role: 'student' },
      { status: 'suspended' },
      { new: true },
    );
  });

  it('activateStudent flips status to active', async () => {
    const student = makeUser({ role: 'student', email: 's@x.com' });
    const { service, userModel } = build(student);
    await service.activateStudent('s1');
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 's1', role: 'student' },
      { status: 'active' },
      { new: true },
    );
  });

  it('404s when the target is not a student', async () => {
    const { service } = build(null); // findOneAndUpdate → null (role mismatch)
    await expect(
      service.updateStudentStatus('x', 'active'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteAccount soft-deletes rather than hard-removing', async () => {
    const user = makeUser({ isDeleted: false });
    const { service } = build(user);
    await service.deleteAccount(user as any);
    expect(user.isDeleted).toBe(true);
    expect(user.save).toHaveBeenCalled();
  });
});
