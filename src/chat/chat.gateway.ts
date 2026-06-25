import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private logger = new Logger('ChatGateway');

  // Keep track of connected users: Map<userId, socketId[]>
  private connectedUsers = new Map<string, string[]>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractTokenFromHeader(client);
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub || payload.userId; // Depending on how your JWT is structured

      // Add to connected users
      let sockets = this.connectedUsers.get(userId);
      if (!sockets) {
        sockets = [];
        this.connectedUsers.set(userId, sockets);
      }
      sockets.push(client.id);

      client.data.userId = userId;
      client.join(`user_${userId}`); // Join a personal room for direct events

      // Broadcast online status to all clients
      this.server.emit('userStatusUpdate', { userId, online: true });

      this.logger.log(`Client connected: ${client.id} (User: ${userId})`);
    } catch (e) {
      this.logger.error(`Connection error: ${e.message}`);
      client.disconnect();
    }
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
  handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    client.join(`conversation_${conversationId}`);
    return { event: 'joined', data: conversationId };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; content: string },
  ) {
    const senderId = client.data.userId;
    const { conversationId, content } = payload;

    // Save to database
    const message = await this.chatService.saveMessage(conversationId, senderId, content);

    // Broadcast to everyone in the conversation room
    this.server.to(`conversation_${conversationId}`).emit('newMessage', message);
    
    // Notify all participants except sender
    const conversation = await this.chatService.getConversationById(conversationId);
    if (conversation && conversation.participants) {
      for (const participant of conversation.participants) {
        const participantId = participant.toString();
        if (participantId !== senderId) {
          this.server.to(`user_${participantId}`).emit('newNotification', {
            type: 'chat_message',
            conversationId,
            message: message,
            senderId,
          });
        }
      }
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
