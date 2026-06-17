import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Request() req: { user: { userId: string } }, @Query() query: GetNotificationsDto) {
    return this.notificationsService.findAllForUser(req.user.userId, query);
  }

  @Patch('read-all')
  markAllAsRead(@Request() req: { user: { userId: string } }) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  @Patch(':id/read')
  markAsRead(@Request() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, req.user.userId);
  }

  // Internal route to test creating notifications (can be restricted to Admin or internal services)
  @Post()
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto);
  }
}
