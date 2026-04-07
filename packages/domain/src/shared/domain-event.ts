import { randomUUID } from 'crypto';

/**
 * Base class for all Domain Events published to Kafka.
 * Every state change produces an immutable, versioned event.
 */
export abstract class DomainEvent {
  public readonly eventId: string;
  public readonly occurredAt: Date;
  public readonly schemaVersion: number = 1;

  constructor(
    public readonly eventType: string,
    public readonly aggregateId: string,
    public readonly tenantId: string,
  ) {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
  }
}
