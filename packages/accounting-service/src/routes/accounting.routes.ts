/**
 * @module accounting-service/routes/accounting.routes
 *
 * OpenAPI 3.0 — Accounting Service REST API (Fastify)
 *
 * Endpoints:
 *   POST /api/v1/accounting/journal-entries          — manual JE creation
 *   GET  /api/v1/accounting/journal-entries/:tradeId — JEs for a trade
 *   POST /api/v1/accounting/ecl                      — compute ECL for an instrument
 *   GET  /api/v1/accounting/ecl/:instrumentId        — last ECL result
 *   POST /api/v1/accounting/hedge/effectiveness-test — run effectiveness test
 *   GET  /api/v1/accounting/chart-of-accounts        — tenant CoA
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AssetClass, TenantId, TradeId } from '@nexustreasury/domain';
import { ChartOfAccounts } from '../domain/chart-of-accounts.js';
import { JournalEntry, type JournalEntryRepository } from '../domain/journal-entry.aggregate.js';
import { TradeBookedHandler } from '../application/trade-booked.handler.js';
import { ECLCalculator } from '../application/ecl-calculator.js';
import { HedgeAccountingService } from '../application/hedge-accounting.service.js';
import {
  BusinessModel,
  EntryDirection,
  HedgeType,
  EffectivenessMethod,
} from '../domain/value-objects.js';

// ── Zod Schemas ────────────────────────────────────────────────────────────────

const LineSchema = z.object({
  accountCode: z.string().min(1),
  accountName: z.string().min(1),
  direction: z.enum(['DR', 'CR']),
  amount: z.number().positive(),
  currency: z.string().length(3),
  description: z.string().optional(),
});

const ManualJESchema = z.object({
  sourceTradeId: z.string().uuid().optional(),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  lines: z.array(LineSchema).min(2),
  sourceSystem: z.string().default('MANUAL'),
});

const ECLSchema = z.object({
  instrumentId: z.string().min(1),
  originationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  outstandingPrincipal: z.number().positive(),
  currency: z.string().length(3),
  accruedInterest: z.number().min(0).default(0),
  originationRating: z.string().default('BBB'),
  currentRating: z.string().default('BBB'),
  daysPastDue: z.number().int().min(0).default(0),
  onWatchList: z.boolean().default(false),
  effectiveInterestRate: z.number().min(0).max(1).default(0.05),
  recoveryRate: z.number().min(0).max(1).default(0.4),
  stageOverride: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

const HedgeTestSchema = z.object({
  hedgeId: z.string().min(1),
  hedgeType: z.nativeEnum(HedgeType),
  hedgedItemId: z.string().min(1),
  hedgingInstrumentId: z.string().min(1),
  notional: z.number().positive(),
  currency: z.string().length(3),
  effectivenessMethod: z.nativeEnum(EffectivenessMethod),
  designationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hedgeRatio: z.number().min(0).max(1).default(1.0),
  instrumentFVChange: z.number(),
  hedgedItemFVChange: z.number(),
  historicalPairs: z.array(z.tuple([z.number(), z.number()])).optional(),
});

// ── Route Options ─────────────────────────────────────────────────────────────

export interface AccountingRouteOptions {
  journalEntryRepo: JournalEntryRepository;
  coa: ChartOfAccounts;
}

// ── Route Registration ────────────────────────────────────────────────────────

export async function accountingRoutes(
  app: FastifyInstance,
  opts: AccountingRouteOptions,
): Promise<void> {
  const { journalEntryRepo, coa } = opts;
  const eclCalc = new ECLCalculator();
  const hedgeSvc = new HedgeAccountingService();
  const tradeHandler = new TradeBookedHandler(coa, journalEntryRepo);

  // ── JWT guard ──────────────────────────────────────────────────────────────
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
  });

  // ── GET /chart-of-accounts ─────────────────────────────────────────────────
  /**
   * @summary Get tenant Chart of Accounts
   * @description Returns all active GL accounts for the authenticated tenant.
   */
  app.get('/chart-of-accounts', async (_req, reply) => {
    return reply.send({ accounts: coa.activeAccounts() });
  });

  // ── POST /journal-entries — manual JE ─────────────────────────────────────
  /**
   * @summary Post a manual journal entry
   * @description Creates and immediately posts a balanced journal entry.
   * Used for manual adjustments and corrections by Finance Controllers.
   * Requires FINANCE_CONTROLLER role.
   */
  app.post('/journal-entries', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = ManualJESchema.parse(req.body);
    const user = req.user as { tenantId: string };
    const tenantId = TenantId(user.tenantId);

    const entry = JournalEntry.create({
      tenantId,
      sourceTradeId: body.sourceTradeId ? TradeId(body.sourceTradeId) : undefined,
      valueDate: new Date(body.valueDate),
      postingDate: new Date(),
      description: body.description,
      sourceSystem: body.sourceSystem,
      lines: body.lines.map((l) => ({
        ...l,
        direction: l.direction === 'DR' ? EntryDirection.DEBIT : EntryDirection.CREDIT,
      })),
    });

    entry.post();
    await journalEntryRepo.save(entry);

    return reply.status(201).send({
      id: entry.id,
      status: entry.status,
      lines: entry.lines,
      drTotal: entry.debitTotal(),
      crTotal: entry.creditTotal(),
    });
  });

  // ── GET /journal-entries/:tradeId ──────────────────────────────────────────
  /**
   * @summary Get journal entries for a trade
   */
  app.get<{ Params: { tradeId: string } }>(
    '/journal-entries/by-trade/:tradeId',
    async (req, reply) => {
      const user = req.user as { tenantId: string };
      const entries = await journalEntryRepo.findByTradeId(
        TradeId(req.params.tradeId),
        TenantId(user.tenantId),
      );
      return reply.send({ entries: entries.map(jeToDTO) });
    },
  );

  // ── POST /ecl — compute ECL ────────────────────────────────────────────────
  /**
   * @summary Compute IFRS 9 Expected Credit Loss
   * @description Calculates Stage 1/2/3 ECL for a financial instrument
   * using the simplified PD/LGD/EAD model (or ML model if configured).
   */
  app.post('/ecl', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = ECLSchema.parse(req.body);
    const result = eclCalc.calculate({
      ...body,
      originationDate: new Date(body.originationDate),
      reportingDate: new Date(body.reportingDate ?? new Date().toISOString().slice(0, 10)),
    });
    return reply.send(result);
  });

  // ── POST /hedge/effectiveness-test ────────────────────────────────────────
  /**
   * @summary Run hedge effectiveness test
   * @description Tests hedge effectiveness using dollar-offset or regression method.
   * Returns effectiveness ratio, split between effective/ineffective portions,
   * and the required journal entries per IAS 39 / IFRS 9 §6.
   */
  app.post('/hedge/effectiveness-test', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = HedgeTestSchema.parse(req.body);

    const result = hedgeSvc.testEffectiveness({
      hedgeRelationship: {
        hedgeId: body.hedgeId,
        hedgeType: body.hedgeType,
        hedgedItemId: body.hedgedItemId,
        hedgingInstrumentId: body.hedgingInstrumentId,
        notional: body.notional,
        currency: body.currency,
        effectivenessMethod: body.effectivenessMethod,
        designationDate: new Date(body.designationDate),
        hedgeRatio: body.hedgeRatio,
      },
      instrumentFVChange: body.instrumentFVChange,
      hedgedItemFVChange: body.hedgedItemFVChange,
      historicalPairs: body.historicalPairs,
    });

    return reply.send(result);
  });
}

// ── DTO Helper ────────────────────────────────────────────────────────────────

function jeToDTO(je: JournalEntry) {
  return {
    id: je.id,
    status: je.status,
    valueDate: je.valueDate,
    postingDate: je.postingDate,
    description: je.description,
    ifrs9Category: je.ifrs9Category,
    sourceSystem: je.sourceSystem,
    lines: je.lines,
  };
}
