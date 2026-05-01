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
import { Public } from '../../common/decorators';
import { UserRole } from '../../users/schemas/user.schema';

import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('admin/hero-banner')
@Controller('admin/hero-banner')
export class HeroBannerController {
  constructor(private readonly heroBannerService: HeroBannerService) {}

  @Public()
  @Get('active')
  @ApiOperation({ summary: 'Get active hero banners for homepage' })
  findActive() {
    return this.heroBannerService.findActive();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new hero banner' })
  @ApiResponse({ status: 201, description: 'Hero banner created' })
  create(@Body() createHeroBannerDto: CreateHeroBannerDto) {
    return this.heroBannerService.create(createHeroBannerDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all hero banners' })
  findAll() {
    return this.heroBannerService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get a hero banner by id' })
  findOne(@Param('id') id: string) {
    return this.heroBannerService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a hero banner' })
  update(
    @Param('id') id: string,
    @Body() updateHeroBannerDto: UpdateHeroBannerDto,
  ) {
    return this.heroBannerService.update(id, updateHeroBannerDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a hero banner' })
  remove(@Param('id') id: string) {
    return this.heroBannerService.remove(id);
  }
}
