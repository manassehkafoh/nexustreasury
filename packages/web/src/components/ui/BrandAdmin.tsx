'use client';

/**
 * @module web/components/ui/BrandAdmin
 *
 * Tenant Branding Administration Panel.
 *
 * Allows platform administrators to configure the white-label theme
 * for their tenant. Changes are previewed live and persisted to the
 * tenant_config table via POST /api/v1/tenant/branding.
 *
 * Features:
 *  - Preset selector (NexusTreasury / Republic Bank / Minimal / Custom)
 *  - Live color picker for primary accent, buy/sell, backgrounds
 *  - Font family selectors (display / body / mono)
 *  - Feature flag toggles per tenant
 *  - One-click CSS variable preview
 *  - Export config as JSON (for CI/CD deployment configs)
 *
 * Access control: TENANT_ADMIN role required.
 */

import { useState } from 'react';
import { useBrand } from './BrandProvider.js';
import { BRAND_PRESETS, type BrandConfig } from '../../lib/branding';

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="border border-[var(--nt-border,#243558)] rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-2 bg-[var(--nt-bg-elevated,#0C2038)] border-b border-[var(--nt-border,#243558)]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--nt-muted,#6882A8)]">
          {title}
        </span>
      </div>
      <div className="p-4 space-y-3 bg-[var(--nt-bg-surface,#071827)]">{children}</div>
    </div>
  );
}

// ── ColorInput ────────────────────────────────────────────────────────────────

function ColorInput({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { onChange(e.target.value); }}
        className="w-8 h-8 rounded cursor-pointer border border-[var(--nt-border,#243558)] bg-transparent"
        aria-label={label}
      />
      <div className="flex-1">
        <div className="text-[10px] text-[var(--nt-muted,#6882A8)] uppercase tracking-wider">{label}</div>
        <div className="text-xs font-mono text-[var(--nt-text,#EAF0FF)]">{value}</div>
      </div>
    </div>
  );
}

// ── FeatureToggle ─────────────────────────────────────────────────────────────

function FeatureToggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-[var(--nt-text,#EAF0FF)]">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={(): void => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-[var(--nt-accent,#D4A843)]' : 'bg-[var(--nt-border,#243558)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

// ── BrandAdmin ────────────────────────────────────────────────────────────────

export function BrandAdmin(): JSX.Element {
  const { brand, setBrand, loadPreset } = useBrand();
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [error,  setError]    = useState<string | null>(null);

  // Local draft to allow live preview without persisting
  const [draft, setDraft] = useState<BrandConfig>({ ...brand });

  const updateColor = (key: keyof BrandConfig['colors'], value: string): void => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
    setBrand({ ...draft, colors: { ...draft.colors, [key]: value } });
  };

  const updateFeature = (key: keyof BrandConfig['features'], value: boolean): void => {
    setDraft((d) => ({ ...d, features: { ...d.features, [key]: value } }));
    setBrand({ ...draft, features: { ...draft.features, [key]: value } });
  };

  const handlePreset = (id: string): void => {
    loadPreset(id);
    const preset = BRAND_PRESETS[id];
    if (preset) setDraft({ ...preset });
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true); setError(null);
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('nexus_jwt') ?? '' : '';
      const resp = await fetch('/api/v1/tenant/branding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(draft),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = (): void => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${draft.id}-brand.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-lg text-sm">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--nt-accent,#D4A843)]">Brand Configuration</h2>
          <p className="text-xs text-[var(--nt-muted,#6882A8)] mt-0.5">
            Customise your tenant theme. Changes preview live.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs rounded border border-[var(--nt-border,#243558)] text-[var(--nt-muted,#6882A8)] hover:text-[var(--nt-text,#EAF0FF)] transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={(): void => { void handleSave(); }}
            disabled={saving}
            className="px-4 py-1.5 text-xs rounded font-semibold bg-[var(--nt-accent,#D4A843)] text-[var(--nt-bg-deep,#030C1B)] disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-xs text-red-400 px-1">{error}</div>}

      {/* Preset Selector */}
      <Section title="Presets">
        <div className="flex flex-wrap gap-2">
          {Object.entries(BRAND_PRESETS).map(([id, preset]) => (
            <button
              key={id}
              onClick={(): void => handlePreset(id)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                draft.id === id
                  ? 'border-[var(--nt-accent,#D4A843)] text-[var(--nt-accent,#D4A843)]'
                  : 'border-[var(--nt-border,#243558)] text-[var(--nt-muted,#6882A8)] hover:border-[var(--nt-muted,#6882A8)]'
              }`}
            >
              {preset.displayName}
            </button>
          ))}
        </div>
      </Section>

      {/* Identity */}
      <Section title="Identity">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--nt-muted,#6882A8)] mb-1">
            Platform Name
          </label>
          <input
            type="text"
            value={draft.displayName}
            onChange={(e): void => { const updated = { ...draft, displayName: e.target.value }; setDraft(updated); setBrand(updated); }}
            className="w-full bg-[var(--nt-bg-elevated,#0C2038)] border border-[var(--nt-border,#243558)] rounded px-3 py-1.5 text-xs text-[var(--nt-text,#EAF0FF)] focus:outline-none focus:border-[var(--nt-accent,#D4A843)]"
          />
        </div>
      </Section>

      {/* Colors */}
      <Section title="Color Tokens">
        <ColorInput label="Accent"      value={draft.colors.accent}     onChange={(v): void => updateColor('accent', v)} />
        <ColorInput label="Accent Light" value={draft.colors.accentLight} onChange={(v): void => updateColor('accentLight', v)} />
        <ColorInput label="BUY"         value={draft.colors.buy}        onChange={(v): void => updateColor('buy', v)} />
        <ColorInput label="SELL / Alert" value={draft.colors.sell}      onChange={(v): void => updateColor('sell', v)} />
        <ColorInput label="Background (Deep)"   value={draft.colors.bgDeep}    onChange={(v): void => updateColor('bgDeep', v)} />
        <ColorInput label="Background (Surface)" value={draft.colors.bgSurface} onChange={(v): void => updateColor('bgSurface', v)} />
        <ColorInput label="Text Primary" value={draft.colors.textPrimary} onChange={(v): void => updateColor('textPrimary', v)} />
        <ColorInput label="Text Muted"  value={draft.colors.textMuted}   onChange={(v): void => updateColor('textMuted', v)} />
        <ColorInput label="Border"      value={draft.colors.border}      onChange={(v): void => updateColor('border', v)} />
      </Section>

      {/* Features */}
      <Section title="Feature Flags">
        <FeatureToggle label="FX eDealing Portal"    checked={draft.features.fxEDealing}     onChange={(v): void => updateFeature('fxEDealing', v)} />
        <FeatureToggle label="IRRBB Reporting"       checked={draft.features.irrbbReporting} onChange={(v): void => updateFeature('irrbbReporting', v)} />
        <FeatureToggle label="Collateral Management" checked={draft.features.collateralMgmt} onChange={(v): void => updateFeature('collateralMgmt', v)} />
        <FeatureToggle label="Islamic Finance"       checked={draft.features.islamicFinance} onChange={(v): void => updateFeature('islamicFinance', v)} />
        <FeatureToggle label="AI Insights Panel"     checked={draft.features.aiInsights}     onChange={(v): void => updateFeature('aiInsights', v)} />
        <FeatureToggle label="Market Data Feed"      checked={draft.features.marketData}     onChange={(v): void => updateFeature('marketData', v)} />
      </Section>

      {/* Live preview */}
      <Section title="Live Preview">
        <div
          style={{ background: draft.colors.bgSurface, border: `1px solid ${draft.colors.border}` }}
          className="rounded-lg p-4"
        >
          <div style={{ color: draft.colors.accent, fontFamily: draft.typography.fontDisplay }} className="text-lg font-bold">
            {draft.displayName}
          </div>
          <div style={{ color: draft.colors.textMuted }} className="text-xs mt-1">
            {draft.tagline}
          </div>
          <div className="flex gap-2 mt-3">
            <span style={{ background: draft.colors.buy,  color: '#fff' }} className="px-3 py-1 rounded text-xs font-bold">BUY</span>
            <span style={{ background: draft.colors.sell, color: '#fff' }} className="px-3 py-1 rounded text-xs font-bold">SELL</span>
            <span style={{ background: draft.colors.accent, color: draft.colors.bgDeep }} className="px-3 py-1 rounded text-xs font-bold">BOOK</span>
          </div>
        </div>
      </Section>
    </div>
  );
}
