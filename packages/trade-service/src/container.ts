import { PrismaClient } from '@prisma/client';
import { PrismaTradeRepository } from './infrastructure/postgres/trade.repository.js';
import { BookTradeCommand } from './application/commands/book-trade.command.js';
import { PassThroughPreDealCheck } from './application/services/pre-deal-check.service.js';
import { KafkaProducer } from './infrastructure/kafka/producer.js';
import { logger } from './infrastructure/logger.js';

/**
 * Application DI container.
 * Wires infrastructure adapters to application use cases.
 * Singleton pattern — one instance per process.
 */
export class Container {
  private static _instance: Container;

  public readonly prisma: PrismaClient;
  public readonly tradeRepository: PrismaTradeRepository;
  public readonly kafkaProducer: KafkaProducer;
  public readonly bookTradeCommand: BookTradeCommand;

  private constructor() {
    this.prisma = new PrismaClient();

    this.tradeRepository   = new PrismaTradeRepository(this.prisma);
    this.kafkaProducer     = new KafkaProducer();

    this.bookTradeCommand  = new BookTradeCommand(
      this.tradeRepository,
      new PassThroughPreDealCheck(),   // swap with GrpcPreDealCheck in production
      this.kafkaProducer,
    );
  }

  static get(): Container {
    if (!Container._instance) {
      Container._instance = new Container();
    }
    return Container._instance;
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
    await this.kafkaProducer.connect();
    logger.info('Container: all adapters connected');
  }

  async disconnect(): Promise<void> {
    await this.kafkaProducer.disconnect();
    await this.prisma.$disconnect();
    logger.info('Container: all adapters disconnected');
  }
}
