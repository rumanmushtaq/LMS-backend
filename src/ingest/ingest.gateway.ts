import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { SessionService } from '../auth/services/session.service';
import { IngestService } from './ingest.service';

/**
 * Socket entry point for browser broadcasting. Kept deliberately thin: it
 * authenticates the socket (same rules as the chat gateway), then forwards
 * everything to IngestService, which re-checks class ownership itself.
 *
 * A namespace of its own so binary chunk traffic never shares a pipe with
 * chat, and so the buffer limit below applies only here.
 */
@WebSocketGateway({
  namespace: '/ingest',
  cors: { origin: '*' },
  // 1s MediaRecorder chunks at ~2.5 Mbps are ~320 KB; leave generous room.
  maxHttpBufferSize: 8 * 1024 * 1024,
})
export class IngestGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger('IngestGateway');

  constructor(
    private readonly ingestService: IngestService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  afterInit(server: Server) {
    server.use(async (client: Socket, next: (err?: Error) => void) => {
      try {
        const token =
          client.handshake.auth?.token ||
          client.handshake.headers?.authorization?.replace(/^Bearer /, '');
        if (!token) return next(new Error('Unauthorized'));
        const payload = this.jwtService.verify(token);
        await this.sessionService.assertActive(payload.sid);
        client.data.userId = payload.sub || payload.userId;
        next();
      } catch (err: any) {
        next(new Error(err?.message || 'Unauthorized'));
      }
    });
  }

  handleDisconnect(client: Socket) {
    const classId = client.data.ingestClassId;
    if (classId) {
      // Browser vanished mid-broadcast (tab closed, network drop): stop the
      // relay so the provider ends the stream instead of holding it open.
      this.ingestService.stop(classId, client.data.userId);
    }
  }

  @SubscribeMessage('startIngest')
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { classId: string; mimeType?: string },
  ) {
    const { classId, mimeType } = body ?? {};
    try {
      await this.ingestService.start(
        classId,
        client.data.userId,
        mimeType,
        (event, detail) => {
          if (event === 'ready') client.emit('ingestReady');
          else if (event === 'ended') client.emit('ingestEnded');
          else client.emit('ingestError', { message: detail });
        },
      );
      client.data.ingestClassId = classId;
    } catch (err: any) {
      client.emit('ingestError', {
        message: err?.message || 'Could not start the broadcast',
      });
    }
  }

  @SubscribeMessage('ingestChunk')
  handleChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { classId: string; chunk: ArrayBuffer | Buffer },
  ) {
    try {
      const chunk = Buffer.isBuffer(body.chunk)
        ? body.chunk
        : Buffer.from(body.chunk);
      this.ingestService.write(body.classId, client.data.userId, chunk);
    } catch (err: any) {
      client.emit('ingestError', {
        message: err?.message || 'Broadcast is not running',
      });
    }
  }

  @SubscribeMessage('stopIngest')
  handleStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { classId: string },
  ) {
    try {
      this.ingestService.stop(body.classId, client.data.userId);
    } catch (err: any) {
      client.emit('ingestError', { message: err?.message });
    }
    client.data.ingestClassId = undefined;
  }
}
