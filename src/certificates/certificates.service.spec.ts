import { CertificatesService } from './certificates.service';

describe('CertificatesService', () => {
  it('returns a student’s certificates, newest first, scoped to that student', async () => {
    const exec = jest.fn().mockResolvedValue([{ _id: 'cert-1' }]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = new CertificatesService({ find } as any);

    const res = await service.getMyCertificates('student-1');

    expect(find).toHaveBeenCalledWith({ studentId: 'student-1' }); // owner-scoped
    expect(sort).toHaveBeenCalledWith({ date: -1 }); // newest first
    expect(res).toHaveLength(1);
  });
});
