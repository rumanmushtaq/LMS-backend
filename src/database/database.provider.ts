// ** Nest js
import { W8BENForm, W8BENFormSchema } from '@/tutors/schemas/w8ben-form.schema';
import { W9Form, W9FormSchema } from '@/tutors/schemas/w9-form.schema';
import { User, UserSchema } from '@/users/schemas/user.schema';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

export const DatabaseProvider = [
  MongooseModule.forRootAsync({
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService) => ({
      uri: configService.get<string>('database.uri'),
      autoIndex: true,
      autoCreate: true,
    }),
    inject: [ConfigService],
  }),
  MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: W9Form.name, schema: W9FormSchema },
    { name: W8BENForm.name, schema: W8BENFormSchema },
  ]),
];
