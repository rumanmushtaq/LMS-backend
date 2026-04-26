import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Certificate, CertificateDocument } from './schemas/certificate.schema';

@Injectable()
export class CertificatesService {
  constructor(
    @InjectModel(Certificate.name)
    private readonly certificateModel: Model<CertificateDocument>,
  ) {}

  async getMyCertificates(studentId: string): Promise<CertificateDocument[]> {
    return this.certificateModel.find({ studentId }).sort({ date: -1 }).exec();
  }
}
