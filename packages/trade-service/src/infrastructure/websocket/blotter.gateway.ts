import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../logger.js';

/**
 * WebSocket gateway — pushes TradeBookedEvent JSON to connected blotter clients.
 * Clients subscribe at GET /api/v1/trades/stream?token=<jwt>
 *
 * Protocol: server-push only (no client messages expected).
 * Frame format: JSON-serialised BlotterRow (single trade per frame).
 */
export class BlotterGateway {
  private readonly clients = new Set<WebSocket>();

  register(app: FastifyInstance): void {
    app.get(
      '/api/v1/trades/stream',
      { websocket: true },
      (socket: WebSocket, req) => {
        this.clients.add(socket);
        logger.info({ clientsTotal: this.clients.size }, 'Blotter client connected');

        socket.on('close', () => {
          this.clients.delete(socket);
          logger.info({ clientsTotal: this.clients.size }, 'Blotter client disconnected');
        });

        socket.on('error', (err) => {
          logger.warn({ err }, 'Blotter WebSocket error');
          this.clients.delete(socket);
        });
      },
    );
  }

  /**
   * Broadcast a trade row to all connected blotter clients.
   * Called by BookTradeCommand after successful trade persistence.
   */
  broadcast(row: object): void {
    if (this.clients.size === 0) return;

    const frame = JSON.stringify(row);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(frame);
      }
    }
    logger.debug({ clients: this.clients.size }, 'Blotter frame broadcast');
  }

  get connectedClients(): number {
    return this.clients.size;
  }
}
