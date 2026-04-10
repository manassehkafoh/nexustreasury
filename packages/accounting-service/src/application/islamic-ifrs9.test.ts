import { describe, it, expect } from 'vitest';
import {
  IslamicIFRS9Extension,
  IslamicInstrumentType,
  IFRS9Classification,
} from './islamic-ifrs9.js';

const ext = new IslamicIFRS9Extension();
const BASE = {
  outstandingAmount: 1_000_000,
  currency: 'USD',
  profitRate: 0.055,
  tenorYears: 3,
  daysPastProfit: 0,
  isNonPerforming: false,
  recoveryRate: 0.4,
  pd12Month: 0.02,
  pdLifetime: 0.08,
};

describe('IslamicIFRS9Extension — Sprint 9.3', () => {
  it('Murabaha classified as AMORTISED_COST', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MURABAHA });
    expect(r.ifrs9Classification).toBe(IFRS9Classification.AMORTISED_COST);
  });
  it('Sukuk Ijara classified as FVOCI', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.SUKUK_IJARA });
    expect(r.ifrs9Classification).toBe(IFRS9Classification.FVOCI);
  });
  it('Mudaraba classified as FVPL', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MUDARABA });
    expect(r.ifrs9Classification).toBe(IFRS9Classification.FVPL);
  });
  it('Stage 1 for performing Murabaha (DPP=0)', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MURABAHA });
    expect(r.stage).toBe(1);
  });
  it('Stage 2 for DPP >= 30', () => {
    const r = ext.calculateECL({
      ...BASE,
      instrumentType: IslamicInstrumentType.IJARA,
      daysPastProfit: 35,
    });
    expect(r.stage).toBe(2);
  });
  it('Stage 3 for non-performing', () => {
    const r = ext.calculateECL({
      ...BASE,
      instrumentType: IslamicInstrumentType.MURABAHA,
      isNonPerforming: true,
      daysPastProfit: 95,
    });
    expect(r.stage).toBe(3);
  });
  it('ECL > 0 for any non-zero exposure', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MURABAHA });
    expect(r.ecl).toBeGreaterThan(0);
  });
  it('Stage 3 ECL > Stage 1 ECL (lifetime PD > 12M PD)', () => {
    const s1 = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MURABAHA });
    const s3 = ext.calculateECL({
      ...BASE,
      instrumentType: IslamicInstrumentType.MURABAHA,
      isNonPerforming: true,
      daysPastProfit: 95,
    });
    expect(s3.ecl).toBeGreaterThan(s1.ecl);
  });
  it('AAOIFI standard is referenced', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.MURABAHA });
    expect(r.aaoifiStandard).toContain('AAOIFI');
  });
  it('Staging rationale is non-empty', () => {
    const r = ext.calculateECL({ ...BASE, instrumentType: IslamicInstrumentType.IJARA });
    expect(r.stagingRationale.length).toBeGreaterThan(5);
  });
});
