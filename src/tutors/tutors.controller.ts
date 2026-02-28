import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser, ParseObjectIdPipe } from '@/common';
import { UserDocument } from '@/users/schemas/user.schema';
import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateW8BENFormDto,
  CreateW9FormDto,
  UpdateW8BENFormDto,
  UpdateW9FormDto,
} from './dto';
import { TutorsService } from './tutors.service';

@ApiTags('Tutors Management')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('tutors')
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}
  @Post('W9-form')
  @ApiOperation({ summary: 'Create a W9 form for tutor' })
  async createW9Form(
    @CurrentUser() user: UserDocument,
    @Body() createW9FormDto: CreateW9FormDto,
  ) {
    return this.tutorsService.createW9Form(user, createW9FormDto);
  }

  @Post('W8BEN-form')
  @ApiOperation({ summary: 'Create a W8BEN form' })
  async createW8BENForm(
    @CurrentUser() user: UserDocument,
    @Body() createW8BENFormDto: CreateW8BENFormDto,
  ) {
    return this.tutorsService.createW8BENForm(user, createW8BENFormDto);
  }

  @Put('W9-form/:formId')
  @ApiOperation({ summary: 'Update the W9 form' })
  async updateW9Form(
    @Param('formId', ParseObjectIdPipe) formId: string,
    @CurrentUser() user: UserDocument,
    @Body() updateW9FormDto: UpdateW9FormDto,
  ) {
    return this.tutorsService.updateW9Form(formId, user, updateW9FormDto);
  }

  @Put('W8BEN-form/:formId')
  @ApiOperation({ summary: 'Update the W8BEN form' })
  async updateW8BENForm(
    @Param('formId', ParseObjectIdPipe) formId: string,
    @CurrentUser() user: UserDocument,
    @Body() updateW8BENFormDto: UpdateW8BENFormDto,
  ) {
    return this.tutorsService.updateW8BENForm(formId, user, updateW8BENFormDto);
  }
}
