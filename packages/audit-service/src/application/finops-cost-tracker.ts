/**
 * @module FinOpsCostTracker
 * @description Sprint 12.3 — FinOps Cost Visibility.
 *
 * Per-tenant cost allocation using Kubernetes namespace labels + OpenCost-compatible
 * cost model. Produces monthly CSV billing reports.
 *
 * ## Architecture
 *
 * - Cost sources: CPU/memory/storage from Prometheus metrics (node_cpu_seconds_total,
 *   container_memory_working_set_bytes, persistentvolumeclaim_info)
 * - Allocation: Kubernetes namespace → tenantId label → cost centre
 * - Pricing: AWS/Azure on-demand hourly rates (configurable per deployment)
 * - Output: Monthly CSV per tenant + aggregate dashboard JSON
 *
 * @see Sprint 12.3 | OpenCost spec: https://www.opencost.io/docs
 */

export interface ServiceCostEntry {
  readonly service: string;
  readonly namespace: string;
  readonly tenantId: string;
  /** Average CPU cores consumed during period */
  readonly cpuCores: number;
  /** Average memory GiB consumed */
  readonly memoryGib: number;
  /** Persistent storage GiB allocated */
  readonly storageGib: number;
  /** Network egress GiB */
  readonly networkGib: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface TenantCostReport {
  readonly tenantId: string;
  readonly period: string; // 'YYYY-MM'
  readonly currency: string;
  readonly cpuCostUSD: number;
  readonly memoryCostUSD: number;
  readonly storageCostUSD: number;
  readonly networkCostUSD: number;
  readonly totalCostUSD: number;
  readonly serviceBreakdown: ServiceCostLine[];
  readonly budgetUSD?: number;
  readonly budgetUtilPct?: number;
  readonly csvExport: string;
  readonly generatedAt: string;
}

export interface ServiceCostLine {
  readonly service: string;
  readonly costUSD: number;
  readonly pctOfTotal: number;
}

// ── Cloud pricing constants (AWS us-east-1 on-demand, April 2026) ──────────────
const CPU_COST_PER_CORE_HOUR = 0.048; // m7i.xlarge: $0.192/hr ÷ 4 cores
const MEM_COST_PER_GIB_HOUR = 0.006; // $0.006/GiB/hour
const STORAGE_COST_PER_GIB_MO = 0.1; // EBS gp3
const NETWORK_COST_PER_GIB = 0.09; // AWS data transfer

function hoursInPeriod(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}

export class FinOpsCostTracker {
  private readonly _entries: ServiceCostEntry[] = [];
  private readonly _budgets = new Map<string, number>(); // tenantId → monthly budget USD

  addEntry(entry: ServiceCostEntry): void {
    this._entries.push(entry);
  }

  setBudget(tenantId: string, monthlyBudgetUSD: number): void {
    this._budgets.set(tenantId, monthlyBudgetUSD);
  }

  generateTenantReport(tenantId: string, period: string): TenantCostReport {
    const entries = this._entries.filter(
      (e) => e.tenantId === tenantId && e.periodStart.startsWith(period.slice(0, 7)),
    );

    const serviceMap = new Map<string, { cpu: number; mem: number; stor: number; net: number }>();
    for (const e of entries) {
      const hours = hoursInPeriod(e.periodStart, e.periodEnd);
      const cpuC = e.cpuCores * hours * CPU_COST_PER_CORE_HOUR;
      const memC = e.memoryGib * hours * MEM_COST_PER_GIB_HOUR;
      const stoC = e.storageGib * STORAGE_COST_PER_GIB_MO;
      const netC = e.networkGib * NETWORK_COST_PER_GIB;
      const prev = serviceMap.get(e.service) ?? { cpu: 0, mem: 0, stor: 0, net: 0 };
      serviceMap.set(e.service, {
        cpu: prev.cpu + cpuC,
        mem: prev.mem + memC,
        stor: prev.stor + stoC,
        net: prev.net + netC,
      });
    }

    let totalCPU = 0,
      totalMem = 0,
      totalStor = 0,
      totalNet = 0;
    serviceMap.forEach((v) => {
      totalCPU += v.cpu;
      totalMem += v.mem;
      totalStor += v.stor;
      totalNet += v.net;
    });
    const total = totalCPU + totalMem + totalStor + totalNet;

    const breakdown: ServiceCostLine[] = [...serviceMap.entries()]
      .map(([svc, v]) => ({
        service: svc,
        costUSD: parseFloat((v.cpu + v.mem + v.stor + v.net).toFixed(2)),
        pctOfTotal:
          total > 0 ? parseFloat((((v.cpu + v.mem + v.stor + v.net) / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.costUSD - a.costUSD);

    const budget = this._budgets.get(tenantId);
    const csvExport = this._buildCSV(tenantId, period, breakdown);

    return {
      tenantId,
      period,
      currency: 'USD',
      cpuCostUSD: parseFloat(totalCPU.toFixed(2)),
      memoryCostUSD: parseFloat(totalMem.toFixed(2)),
      storageCostUSD: parseFloat(totalStor.toFixed(2)),
      networkCostUSD: parseFloat(totalNet.toFixed(2)),
      totalCostUSD: parseFloat(total.toFixed(2)),
      serviceBreakdown: breakdown,
      budgetUSD: budget,
      budgetUtilPct: budget ? parseFloat(((total / budget) * 100).toFixed(1)) : undefined,
      csvExport,
      generatedAt: new Date().toISOString(),
    };
  }

  getAllTenantsSummary(period: string): { tenantId: string; totalCostUSD: number }[] {
    const tenants = [...new Set(this._entries.map((e) => e.tenantId))];
    return tenants
      .map((t) => ({
        tenantId: t,
        totalCostUSD: this.generateTenantReport(t, period).totalCostUSD,
      }))
      .sort((a, b) => b.totalCostUSD - a.totalCostUSD);
  }

  private _buildCSV(tenantId: string, period: string, lines: ServiceCostLine[]): string {
    const header = 'tenant_id,period,service,cost_usd,pct_of_total';
    const rows = lines.map(
      (l) =>
        `${tenantId},${period},${l.service},${l.costUSD.toFixed(2)},${l.pctOfTotal.toFixed(1)}`,
    );
    return [header, ...rows].join('\n');
  }
}
