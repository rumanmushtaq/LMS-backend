import { Controller, Get, Post, Body, Param, UseGuards, Req, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({ summary: 'Get all conversations for the logged in user' })
  @Get('conversations')
  async getConversations(
    @Req() req: Request & { user: any },
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req?.user?._id || req?.user?.userId;
    console.log("userId",userId);
    
    return this.chatService.getConversations(
      userId,
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

  @ApiOperation({ summary: 'Initialize or find a conversation with another user' })
  @Post('conversations')
  async initConversation(@Req() req: Request & { user: any }, @Body() body: { targetUserId: string }) {
    const userId = req?.user?._id;
    return this.chatService.findOrCreateConversation([userId, body.targetUserId]);
  }

  @ApiOperation({ summary: 'Get messages for a conversation' })
  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.getMessages(
      conversationId,
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

  @ApiOperation({ summary: 'Flag a message' })
  @Post('messages/:id/flag')
  async flagMessage(@Param('id') messageId: string, @Body() body: { reason: string }) {
    return this.chatService.flagMessage(messageId, body.reason);
  }

  @ApiOperation({ summary: 'Block a conversation' })
  @Post('conversations/:id/block')
  async blockConversation(@Param('id') conversationId: string, @Req() req: Request & { user: any }) {
    const userId = req?.user?._id || req?.user?.userId;
    return this.chatService.blockConversation(conversationId, userId);
  }

  // --- Admin Endpoints ---


  @ApiOperation({ summary: 'Admin: Get all flagged messages' })
  @Get('admin/messages/flagged')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getFlaggedMessages(
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.getFlaggedMessages(
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

  @ApiOperation({ summary: 'Admin: Resolve a flagged message' })
  @Post('admin/messages/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async resolveFlaggedMessage(@Param('id') messageId: string) {
    return this.chatService.resolveFlagMessage(messageId);
  }
}
