import type { FastifyInstance, FastifyRequest } from 'fastify';
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
 * The `websocket: true` route option and WebSocket handler signature are
 * injected by @fastify/websocket at runtime and are not reflected in
 * Fastify's core TypeScript types — hence the (app as any) cast below.
 */
export class BlotterGateway {
  private readonly clients = new Set<WebSocketLike>();

  register(app: FastifyInstance): void {
    // @fastify/websocket augments app.get() at runtime; cast required
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).get(
      '/api/v1/trades/stream',
      { websocket: true },
      (socket: WebSocketLike, _req: FastifyRequest): void => {
        this.clients.add(socket);
        logger.info({ totalClients: this.clients.size }, 'Blotter client connected');

        socket.on('close', (): void => {
          this.clients.delete(socket);
          logger.info({ totalClients: this.clients.size }, 'Blotter client disconnected');
        });

        socket.on('error', (err: unknown): void => {
          logger.warn({ err }, 'Blotter WebSocket error');
          this.clients.delete(socket);
        });
      },
    );
  }

  broadcast(row: object): void {
    if (this.clients.size === 0) return;
    const frame = JSON.stringify(row);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  }

  get connectedClients(): number {
    return this.clients.size;
  }
}
