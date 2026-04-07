import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { logger } from '../logger.js';

interface WebSocketLike {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  on(event: 'close' | 'error' | 'message', listener: (...args: unknown[]) => void): void;
}

/**
 * WebSocket gateway — pushes TradeBookedEvent JSON to live blotter clients.
 * Endpoint: GET /api/v1/trades/stream?token=<jwt>
 *
 * Requires @fastify/websocket registered on the Fastify instance.
 * Server-push only — no client messages expected.
 */
export class BlotterGateway {
  private readonly clients = new Set<WebSocketLike>();

  register(app: FastifyInstance): void {
    // @ts-expect-error — websocket property added by @fastify/websocket plugin at runtime
    app.get('/api/v1/trades/stream', { websocket: true }, (socket: WebSocketLike, _req: FastifyRequest) => {
      this.clients.add(socket);
      logger.info({ totalClients: this.clients.size }, 'Blotter client connected');

      socket.on('close', () => {
        this.clients.delete(socket);
        logger.info({ totalClients: this.clients.size }, 'Blotter client disconnected');
      });

      socket.on('error', (err: unknown) => {
        logger.warn({ err }, 'Blotter WebSocket error');
        this.clients.delete(socket);
      });
    });
  }

  broadcast(row: object): void {
    if (this.clients.size === 0) return;
    const frame = JSON.stringify(row);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  }

  get connectedClients(): number { return this.clients.size; }
}
