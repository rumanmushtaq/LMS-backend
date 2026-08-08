import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Query, HttpCode, HttpStatus } from '@nestjs/common';
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

  private userIdOf(req: Request & { user: any }): string {
    return req?.user?._id || req?.user?.userId;
  }

  /**
   * Read/moderate access to a conversation.
   *
   * Admins are moderators — they need to read and act on threads they are not
   * part of, which is what the flagged-message queue is for. Posting is *not*
   * covered by this: sending is still participants-only, so an admin cannot
   * appear inside someone else's private conversation.
   */
  private async assertCanModerate(
    req: Request & { user: any },
    conversationId: string,
  ): Promise<void> {
    if (req?.user?.role === UserRole.ADMIN) return;
    await this.chatService.assertParticipant(conversationId, this.userIdOf(req));
  }

  @ApiOperation({ summary: 'Get all conversations for the logged in user' })
  @Get('conversations')
  async getConversations(
    @Req() req: Request & { user: any },
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req?.user?._id || req?.user?.userId;

    return this.chatService.getConversations(
      userId,
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

  @ApiOperation({ summary: 'Initialize or find a conversation with another user' })
  @Post('conversations')
  async initConversation(@Req() req: Request & { user: any }, @Body() body: { targetUserId: string }) {
    const userId = req?.user?._id || req?.user?.userId;
    return this.chatService.findOrCreateConversation([userId, body.targetUserId]);
  }

  @ApiOperation({ summary: 'Get messages for a conversation' })
  @Get('conversations/:id/messages')
  async getMessages(
    @Req() req: Request & { user: any },
    @Param('id') conversationId: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertCanModerate(req, conversationId);

    return this.chatService.getMessages(
      conversationId,
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

  @ApiOperation({ summary: 'Mark every message from the other participants as read' })
  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  async markConversationRead(
    @Req() req: Request & { user: any },
    @Param('id') conversationId: string,
  ) {
    const userId = req?.user?._id || req?.user?.userId;
    await this.chatService.assertParticipant(conversationId, userId);

    return this.chatService.markConversationRead(conversationId, userId);
  }

  @ApiOperation({ summary: 'Flag a message' })
  @Post('messages/:id/flag')
  async flagMessage(
    @Req() req: Request & { user: any },
    @Param('id') messageId: string,
    @Body() body: { reason: string },
  ) {
    const userId = req?.user?._id || req?.user?.userId;
    await this.chatService.assertMessageParticipant(messageId, userId);

    return this.chatService.flagMessage(messageId, body.reason);
  }

  @ApiOperation({ summary: 'Block a conversation' })
  @Post('conversations/:id/block')
  async blockConversation(@Param('id') conversationId: string, @Req() req: Request & { user: any }) {
    const userId = this.userIdOf(req);
    await this.assertCanModerate(req, conversationId);

    return this.chatService.blockConversation(conversationId, userId);
  }

  @ApiOperation({ summary: 'Unblock a conversation' })
  @Post('conversations/:id/unblock')
  async unblockConversation(@Param('id') conversationId: string, @Req() req: Request & { user: any }) {
    const userId = this.userIdOf(req);
    await this.assertCanModerate(req, conversationId);

    return this.chatService.unblockConversation(conversationId, userId);
  }

  @ApiOperation({ summary: 'Delete a conversation' })
  @Delete('conversations/:id')
  async deleteConversation(@Param('id') conversationId: string, @Req() req: Request & { user: any }) {
    await this.assertCanModerate(req, conversationId);

    return this.chatService.deleteConversation(conversationId);
  }

  // --- Admin Endpoints ---


  @ApiOperation({ summary: 'Admin: Get every conversation in the system' })
  @Get('admin/conversations')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllConversationsForModeration(
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    return this.chatService.getAllConversationsForModeration(
      skip ? parseInt(skip) : 0,
      limit ? parseInt(limit) : 50,
    );
  }

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
