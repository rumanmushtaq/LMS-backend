import { UserDocument } from '@/users/schemas/user.schema';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreateW8BENFormDto,
  CreateW9FormDto,
  UpdateW8BENFormDto,
  UpdateW9FormDto,
} from './dto';
import { W8BENForm, W8BENFormDocument } from './schemas/w8ben-form.schema';
import { W9Form, W9FormDocument } from './schemas/w9-form.schema';

@Injectable()
export class TutorsService {
  constructor(
    @InjectModel(W9Form.name)
    private readonly w9FormModel: Model<W9FormDocument>,

    @InjectModel(W8BENForm.name)
    private readonly w8BENFormModel: Model<W8BENFormDocument>,
  ) {}
  async createW9Form(user: UserDocument, createW9FormDto: CreateW9FormDto) {
    const existingW9Form = await this.w9FormModel.findOne({
      user: user?._id,
    });

    if (existingW9Form)
      throw new ConflictException('User already filled W9 Form.');

    const existW8BENForm = await this.w8BENFormModel.findOne({
      user: user?._id,
    });

    if (existW8BENForm)
      throw new ConflictException('User already filled the W8BEN form.');

    await this.w9FormModel.create({
      ...createW9FormDto,
      user: user?._id,
    });

    return {
      message: 'W9 Form created successful.',
    };
  }

  async createW8BENForm(
    user: UserDocument,
    createW8BENFormDto: CreateW8BENFormDto,
  ) {
    const existingW9Form = await this.w9FormModel.findOne({
      user: user?._id,
    });

    if (existingW9Form)
      throw new ConflictException('User already filled W9 Form.');

    const existW8BENForm = await this.w8BENFormModel.findOne({
      user: user?._id,
    });

    if (existW8BENForm)
      throw new ConflictException('User already filled the W8BEN form.');

    await this.w8BENFormModel.create({
      ...createW8BENFormDto,
      user: user?._id,
    });

    return {
      message: 'W8BEN Form created successful.',
    };
  }

  async updateW9Form(
    formId: string,
    user: UserDocument,
    updateW9FormDto: UpdateW9FormDto,
  ) {
    const w9Form = await this.w9FormModel.findOneAndUpdate(
      {
        _id: formId,
        user: user?._id,
      },
      {
        ...updateW9FormDto,
      },
      { new: true },
    );

    if (!w9Form) throw new NotFoundException('W9 From does not exist.');

    return {
      message: 'W9 Form updated successful.',
    };
  }

  async updateW8BENForm(
    formId: string,
    user: UserDocument,
    updateW8BENFormDto: UpdateW8BENFormDto,
  ) {
    const w8BENForm = await this.w8BENFormModel.findOneAndUpdate(
      {
        _id: formId,
        user: user?._id,
      },
      {
        ...updateW8BENFormDto,
      },
      { new: true },
    );

    if (!w8BENForm) throw new NotFoundException('W8BEN From does not exist.');

    return {
      message: 'W8BEN Form updated successful.',
    };
  }
}
