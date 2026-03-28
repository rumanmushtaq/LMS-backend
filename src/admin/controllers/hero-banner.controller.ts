import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { HeroBannerService } from '../services/hero-banner.service';
import {
  CreateHeroBannerDto,
  UpdateHeroBannerDto,
} from '../dto/hero-banner.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../users/schemas/user.schema';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('admin/hero-banner')
@Controller('admin/hero-banner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class HeroBannerController {
  constructor(private readonly heroBannerService: HeroBannerService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new hero banner' })
  @ApiResponse({ status: 201, description: 'Hero banner created' })
  create(@Body() createHeroBannerDto: CreateHeroBannerDto) {
    return this.heroBannerService.create(createHeroBannerDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all hero banners' })
  findAll() {
    return this.heroBannerService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a hero banner by id' })
  findOne(@Param('id') id: string) {
    return this.heroBannerService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a hero banner' })
  update(
    @Param('id') id: string,
    @Body() updateHeroBannerDto: UpdateHeroBannerDto,
  ) {
    return this.heroBannerService.update(id, updateHeroBannerDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a hero banner' })
  remove(@Param('id') id: string) {
    return this.heroBannerService.remove(id);
  }
}
