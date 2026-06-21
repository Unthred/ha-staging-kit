import type { CSSProperties, ReactNode } from "react";
import { useAppearance } from "../../context/AppearanceContext";
import {
  ACCENT_COLOR_PRESETS,
  BADGE_COLOR_PRESETS,
  type FontScale,
  type StatusIntensity,
  type ThemeMode,
  type UiDensity,
} from "../../lib/appearancePreferences";

const THEME_OPTIONS: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always use light theme" },
  { id: "dark", label: "Dark", hint: "Always use dark theme" },
  { id: "system", label: "System", hint: "Follow your device appearance setting" },
];

const DENSITY_OPTIONS: { id: UiDensity; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

const FONT_SCALE_OPTIONS: { id: FontScale; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
];

const STATUS_INTENSITY_OPTIONS: { id: StatusIntensity; label: string }[] = [
  { id: "soft", label: "Soft" },
  { id: "default", label: "Default" },
  { id: "strong", label: "Strong" },
];

function SaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle" || state === "saved") return null;
  const label = state === "saving" ? "Saving…" : "Could not save — retry by changing a setting";
  const className = state === "error" ? "msg err appearance-save-status" : "msg ok appearance-save-status";
  return <p className={className}>{label}</p>;
}

function AppearanceCard({ legend, children, className = "" }: { legend: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`appearance-fieldset ${className}`.trim()}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="appearance-segmented" role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          title={opt.hint}
          className={`appearance-segment ${value === opt.id ? "active" : ""}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ColorSwatches({
  presets,
  value,
  onChange,
  label,
}: {
  presets: readonly { id: string; label: string; value: string }[];
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div className="appearance-color-swatches" role="list" aria-label={label}>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="listitem"
          className={`appearance-color-swatch ${value.toLowerCase() === preset.value.toLowerCase() ? "active" : ""}`}
          style={{ "--swatch-color": preset.value } as CSSProperties}
          title={preset.label}
          aria-label={preset.label}
          aria-pressed={value.toLowerCase() === preset.value.toLowerCase()}
          onClick={() => onChange(preset.value)}
        />
      ))}
    </div>
  );
}

function ColorField({
  legend,
  hint,
  presets,
  value,
  onChange,
  preview,
}: {
  legend: string;
  hint: string;
  presets: readonly { id: string; label: string; value: string }[];
  value: string;
  onChange: (color: string) => void;
  preview?: ReactNode;
}) {
  return (
    <AppearanceCard legend={legend}>
      <div className="appearance-field-head">
        <p className="muted appearance-field-desc">{hint}</p>
        {preview}
      </div>
      <ColorSwatches presets={presets} value={value} onChange={onChange} label={`${legend} presets`} />
      <label className="appearance-custom-color">
        <span className="appearance-custom-color-label">Custom</span>
        <div className="appearance-custom-color-row">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${legend.toLowerCase()}`} />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
            }}
            spellCheck={false}
            aria-label={`${legend} hex value`}
          />
        </div>
      </label>
    </AppearanceCard>
  );
}

export function AppearanceSettingsPanel() {
  const {
    appearance,
    resolvedTheme,
    saveState,
    setThemeMode,
    setBadgeColor,
    setAccentColor,
    setDensity,
    setFontScale,
    setReduceMotion,
    setStatusIntensity,
    setHideNavBadges,
    setHighContrast,
    resetAppearance,
  } = useAppearance();

  return (
    <div className="appearance-layout">
      <p className="muted appearance-intro">
        Saved with your kit configuration — applies for anyone using this console.
      </p>
      <SaveStatus state={saveState} />

      <div className="appearance-row appearance-row--theme-access">
        <AppearanceCard legend="Theme">
          <SegmentedControl options={THEME_OPTIONS} value={appearance.themeMode} onChange={setThemeMode} label="Theme" />
          {appearance.themeMode === "system" && (
            <p className="appearance-hint muted">
              Using <strong>{resolvedTheme}</strong> from system preference.
            </p>
          )}
        </AppearanceCard>

        <AppearanceCard legend="Accessibility" className="appearance-toggles">
          <label className="checkbox">
            <input type="checkbox" checked={appearance.reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} />
            Reduce motion
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={appearance.highContrast} onChange={(e) => setHighContrast(e.target.checked)} />
            High contrast
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={appearance.hideNavBadges} onChange={(e) => setHideNavBadges(e.target.checked)} />
            Hide nav badges
          </label>
        </AppearanceCard>
      </div>

      <div className="appearance-row appearance-row--colors">
        <ColorField
          legend="Badge colour"
          hint="Nav and section attention counts."
          presets={BADGE_COLOR_PRESETS}
          value={appearance.badgeColor}
          onChange={setBadgeColor}
          preview={
            <div className="appearance-badge-preview" aria-hidden="true">
              <span className="nav-link-badge">3</span>
              <span className="section-attention-badge">2</span>
            </div>
          }
        />
        <ColorField
          legend="Accent colour"
          hint="Buttons, links, and highlights."
          presets={ACCENT_COLOR_PRESETS}
          value={appearance.accentColor}
          onChange={setAccentColor}
        />
      </div>

      <div className="appearance-row appearance-row--layout">
        <AppearanceCard legend="UI density">
          <SegmentedControl options={DENSITY_OPTIONS} value={appearance.density} onChange={setDensity} label="UI density" />
        </AppearanceCard>
        <AppearanceCard legend="Font size">
          <SegmentedControl options={FONT_SCALE_OPTIONS} value={appearance.fontScale} onChange={setFontScale} label="Font size" />
        </AppearanceCard>
        <AppearanceCard legend="Status colours">
          <p className="muted appearance-field-desc">Ok / warn / error intensity.</p>
          <SegmentedControl
            options={STATUS_INTENSITY_OPTIONS}
            value={appearance.statusIntensity}
            onChange={setStatusIntensity}
            label="Status colour intensity"
          />
          <div className="appearance-status-preview" aria-hidden="true">
            <span className="appearance-status-chip appearance-status-chip--ok">OK</span>
            <span className="appearance-status-chip appearance-status-chip--warn">Warn</span>
            <span className="appearance-status-chip appearance-status-chip--err">Error</span>
          </div>
        </AppearanceCard>
      </div>

      <div className="step-actions-right appearance-reset-row">
        <button type="button" className="btn primary" onClick={resetAppearance}>
          Reset appearance to defaults
        </button>
      </div>
    </div>
  );
}
