import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Logger } from '@nestjs/common';
import { resolveClientIp } from '../common/utils';
import { IpBlockService } from '../security/services/ip-block.service';
import { IpActivityService } from '../security/services/ip-activity.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;
  
  private logger = new Logger('ChatGateway');

  // Keep track of connected users: Map<userId, socketId[]>
  private connectedUsers = new Map<string, string[]>();

  // Tail of the in-flight work chain per conversation. Saving a message is a
  // database round-trip, so without this two messages sent back-to-back race
  // and are broadcast in completion order rather than the order they were typed.
  private readonly sendQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly ipBlockService: IpBlockService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  /**
   * Authentication runs as a handshake middleware, not inside
   * handleConnection, for one specific reason: rejecting here delivers a
   * `connect_error` to the client carrying the reason string, which is the
   * only signal socket.io-client's `connect_error` handler can act on.
   *
   * The web client listens for `jwt expired` there and silently refreshes
   * its token, so an expired access token becomes a seamless reconnect
   * instead of a dead socket. Rejecting later (client.disconnect() inside
   * handleConnection) fires only a plain `disconnect`, which the client
   * cannot tell apart from a network drop — so the refresh never happened
   * and the connection just died.
   *
   * A 15-minute access token lapsing is routine, so it is logged at debug,
   * not error — that ERROR-level noise was the reported symptom.
   */
  afterInit(server: Server) {
    server.use((client: Socket, next: (err?: Error) => void) => {
      try {
        // HTTP middleware never sees WebSocket upgrades, so the blocklist has
        // to be consulted here too — same resolver, same trust rules.
        const ip = resolveClientIp(
          {
            headers: client.handshake.headers,
            remoteAddress: client.handshake.address,
          },
          {
            trustCloudflare: this.configService.get<boolean>(
              'security.trustCloudflare',
              false,
            ),
          },
        );
        if (ip && this.ipBlockService.findBlock(ip)) {
          this.ipActivityService.recordBlocked(ip);
          if (
            this.configService.get<boolean>('security.enforceIpBlocks', false)
          ) {
            this.logger.warn(`Refused socket from blocked IP ${ip}`);
            return next(new Error('Access restricted'));
          }
          this.logger.warn(`[shadow] would refuse socket from blocked IP ${ip}`);
        }

        const token = this.extractTokenFromHeader(client);
        if (!token) {
          return next(new Error('Unauthorized'));
        }

        const payload = this.jwtService.verify(token);
        // Resolved once here; handleConnection and every handler trust it.
        client.data.userId = payload.sub || payload.userId;
        return next();
      } catch (e) {
        // Expired tokens are expected and recoverable — the client refreshes
        // and reconnects on this exact message. Keep it out of the error log.
        if (e?.name === 'TokenExpiredError') {
          this.logger.debug(`Socket auth: jwt expired (${client.id})`);
          return next(new Error('jwt expired'));
        }
        this.logger.warn(`Socket auth rejected: ${e?.message}`);
        return next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: Socket) {
    // The handshake middleware has already authenticated the socket, so a
    // userId is guaranteed. The guard is purely defensive.
    const userId: string | undefined = client.data.userId;
    if (!userId) {
      client.disconnect();
      return;
    }

    let sockets = this.connectedUsers.get(userId);
    if (!sockets) {
      sockets = [];
      this.connectedUsers.set(userId, sockets);
    }
    sockets.push(client.id);

    client.join(`user_${userId}`); // Personal room for direct events
    this.server.emit('userStatusUpdate', { userId, online: true });
    this.logger.log(`Client connected: ${client.id} (User: ${userId})`);
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const sockets = this.connectedUsers.get(userId);
      if (sockets) {
        const index = sockets.indexOf(client.id);
        if (index !== -1) {
          sockets.splice(index, 1);
        }
        if (sockets.length === 0) {
          this.connectedUsers.delete(userId);
          // Broadcast offline status to all clients
          this.server.emit('userStatusUpdate', { userId, online: false });
        }
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    try {
      await this.chatService.assertParticipant(conversationId, client.data.userId);
    } catch {
      this.logger.warn(
        `User ${client.data.userId} tried to join conversation ${conversationId} they are not part of`,
      );
      throw new WsException('You are not a participant in this conversation');
    }

    client.join(`conversation_${conversationId}`);
    return { event: 'joined', data: conversationId };
  }

  // ─── Public helpers for other modules (e.g. live classes) ────────────────────

  /** Emit an event to everyone currently in a conversation/Q&A room. */
  emitToConversation(conversationId: string, event: string, payload: any) {
    this.server.to(`conversation_${conversationId}`).emit(event, payload);
  }

  /** Emit an event directly to a set of users' personal rooms. */
  emitToUsers(userIds: Array<string | { toString(): string }>, event: string, payload: any) {
    for (const id of userIds) {
      this.server.to(`user_${id.toString()}`).emit(event, payload);
    }
  }

  /**
   * Runs `task` after every task already queued for `key`, so work for one
   * conversation is serialised while different conversations stay concurrent.
   * The map entry is dropped once the chain drains, so it does not grow.
   */
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sendQueues.get(key) ?? Promise.resolve();
    // Run `task` whether or not the previous one succeeded — one failed send
    // must not wedge the conversation.
    const result = previous.then(task, task);
    const drained = result.then(
      () => undefined,
      () => undefined,
    );

    this.sendQueues.set(key, drained);
    void drained.then(() => {
      if (this.sendQueues.get(key) === drained) {
        this.sendQueues.delete(key);
      }
    });

    return result;
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; content: string },
  ) {
    return this.enqueue(payload.conversationId, () =>
      this.deliverMessage(client.data.userId, payload),
    );
  }

  private async deliverMessage(
    senderId: string,
    payload: { conversationId: string; content: string },
  ) {
    const { conversationId, content } = payload;

    // Knowing a conversation id is not permission to post into it.
    let conversation: Awaited<ReturnType<ChatService['assertParticipant']>>;
    try {
      conversation = await this.chatService.assertParticipant(conversationId, senderId);
    } catch {
      this.logger.warn(
        `User ${senderId} tried to post into conversation ${conversationId} they are not part of`,
      );
      throw new WsException('You are not a participant in this conversation');
    }

    // A blocked thread is frozen for both sides until whoever blocked it
    // unblocks — otherwise blocking only hides messages in the UI while the
    // sender keeps writing into the recipient's history.
    if (conversation.isBlocked) {
      throw new WsException('This conversation is blocked');
    }

    const message = await this.chatService.saveMessage(conversationId, senderId, content);
    const participantIds = conversation.participants.map((p) => p.toString());

    // Deliver once per socket. Recipients viewing the thread are in the
    // conversation room *and* their personal room, so a single emit across
    // both room sets is what keeps them from receiving the message twice —
    // socket.io de-duplicates recipients within one emit, but not across
    // separate emit calls.
    this.server
      .to([
        `conversation_${conversationId}`,
        ...participantIds.map((id) => `user_${id}`),
      ])
      .emit('newMessage', message);

    // Name of whoever sent this, so a notification can label the chat it opens
    // instead of falling back to a placeholder.
    const senderName = await this.chatService.getParticipantName(conversationId, senderId);

    for (const participantId of participantIds) {
      if (participantId === senderId) continue;

      this.server.to(`user_${participantId}`).emit('newNotification', {
        type: 'chat_message',
        conversationId,
        message: message,
        senderId,
        senderName,
      });

      // Persist so the notification survives a reload. senderId and the
      // conversation id have to be stored too — without them a notification
      // fetched from the database has no way to reopen the chat it came from.
      await this.notificationsService.create({
        userId: participantId,
        title: senderName || 'New Message',
        content: message.content,
        type: 'chat_message',
        senderId,
        actionPayload: { conversationId, senderId, senderName },
      });
    }

    return message;
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    const senderId = client.data.userId;
    // Broadcast to others in the room
    client.to(`conversation_${conversationId}`).emit('userTyping', { conversationId, userId: senderId });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    const senderId = client.data.userId;
    client.to(`conversation_${conversationId}`).emit('userStoppedTyping', { conversationId, userId: senderId });
  }

  @SubscribeMessage('checkStatus')
  handleCheckStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() userId: string,
  ) {
    const isOnline = this.connectedUsers.has(userId) && (this.connectedUsers.get(userId)?.length ?? 0) > 0;
    client.emit('statusResponse', { userId, online: isOnline });
  }

  private extractTokenFromHeader(client: Socket): string | undefined {
    const auth = client.handshake.auth.token || client.handshake.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.substring(7);
    }
    return auth;
  }
}
