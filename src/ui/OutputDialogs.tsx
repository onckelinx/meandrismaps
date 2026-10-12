/** Export (SVG / PNG / JPEG) and Print dialogs. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createStore, useStore } from "zustand";
import { registerCommands } from "../app/commands";
import { saveExport } from "../app/interchange";
import { getMeasurer } from "../canvas/useMapLayout";
import { buildMapSvg, clampScale, rasterize } from "../export/svg";
import { PAPER_MM, planPrint, preparePrintDom, type PrintOptions } from "../export/print";
import { displayUrl } from "../images/assetStore";
import { layoutMap } from "../layout/layout";
import { platform } from "../platform";
import { MapScene } from "../render/MapScene";
import { DARK_THEME, LIGHT_THEME } from "../render/theme";
import { commitEditing } from "../state/actions";
import { getState } from "../state/store";
import { notify, showError } from "./dialogs";

type Kind = "svg" | "png" | "jpeg" | "print";
const outputStore = createStore<{ kind: Kind | null }>(() => ({ kind: null }));
const open = (kind: Kind) => {
  commitEditing();
  outputStore.setState({ kind });
};
const close = () => outputStore.setState({ kind: null });

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`meandris.${key}`);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`meandris.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button.primary")?.focus();
  }, []);
  return (
    <div className="modal-backdrop" data-own-keys>
      <div
        ref={ref}
        className="modal options"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "on" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ExportPrefs {
  appearance: "light" | "dark";
  scale: number;
  transparent: boolean;
}

function ExportDialog({ kind }: { kind: "svg" | "png" | "jpeg" }) {
  const [prefs, setPrefs] = useState<ExportPrefs>(() => loadPref("export", { appearance: "light", scale: 2, transparent: false }));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ExportPrefs>) => setPrefs((old) => ({ ...old, ...p }));
  const bounds = useMemo(() => layoutMap(getState().doc, { measure: getMeasurer() }).bounds, []);
  const raster = kind !== "svg";
  const w = Math.ceil(bounds.width + 80);
  const h = Math.ceil(bounds.height + 80);
  const effScale = raster ? clampScale(w, h, prefs.scale) : 1;

  const run = async () => {
    setBusy(true);
    savePref("export", prefs);
    const theme = prefs.appearance === "dark" ? DARK_THEME : LIGHT_THEME;
    const transparent = kind === "png" && prefs.transparent;
    try {
      const map = await buildMapSvg(getState().doc, { theme, background: !transparent });
      close();
      if (kind === "svg") {
        await saveExport(new TextEncoder().encode(map.svg), "svg", { name: "SVG Image", extensions: ["svg"] });
      } else {
        const { bytes, scale } = await rasterize(map, {
          format: kind,
          scale: prefs.scale,
          fill: kind === "jpeg" ? theme.background : undefined,
        });
        if (scale < prefs.scale - 0.01) notify(`The map is very large, so it was exported at ${scale.toFixed(2)}× instead.`, "warning");
        await saveExport(bytes, kind === "png" ? "png" : "jpg", {
          name: kind === "png" ? "PNG Image" : "JPEG Image",
          extensions: kind === "png" ? ["png"] : ["jpg", "jpeg"],
        });
      }
    } catch (e) {
      close();
      await showError("The export failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Export as ${kind.toUpperCase()}`} onClose={close}>
      <Segmented
        label="Appearance"
        value={prefs.appearance}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={(appearance) => set({ appearance })}
      />
      {raster && (
        <Segmented
          label="Resolution"
          value={prefs.scale}
          options={[1, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))}
          onChange={(scale) => set({ scale })}
        />
      )}
      {kind === "png" && (
        <label className="field checkbox">
          <input type="checkbox" checked={prefs.transparent} onChange={(e) => set({ transparent: e.target.checked })} />
          Transparent background
        </label>
      )}
      <p className="field-note">
        {raster
          ? `${Math.round(w * effScale)} × ${Math.round(h * effScale)} pixels`
          : "Vector image; text stays sharp at any size."}{" "}
        The whole map is exported as currently expanded.
      </p>
      <div className="modal-buttons">
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={() => void run()} disabled={busy}>
          Export…
        </button>
      </div>
    </Modal>
  );
}

function PrintDialog() {
  const [o, setO] = useState<PrintOptions>(() =>
    loadPref("print", { paper: "a4", orientation: "auto", mode: "fit", scale: 100, marginMm: 12 } as PrintOptions),
  );
  const set = (p: Partial<PrintOptions>) => setO((old) => ({ ...old, ...p }));
  const layout = useMemo(() => layoutMap(getState().doc, { measure: getMeasurer() }), []);
  const bounds = useMemo(() => {
    const b = layout.bounds;
    return { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 };
  }, [layout]);
  const plan = planPrint(bounds, o);
  const pages = plan.tiles.length;

  const run = async () => {
    savePref("print", o);
    try {
      const map = await buildMapSvg(getState().doc, { theme: LIGHT_THEME, background: false, padding: 10 });
      const finalPlan = planPrint(map.bounds, o);
      preparePrintDom(finalPlan, map, o);
      close();
      // Let the print DOM render before the dialog snapshots it.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await platform.print();
    } catch (e) {
      close();
      await showError("Printing failed", e instanceof Error ? e.message : String(e));
    }
  };

  // Preview: the map with the page grid drawn over it.
  const all = plan.tiles.reduce(
    (acc, t) => ({
      x: Math.min(acc.x, t.x),
      y: Math.min(acc.y, t.y),
      r: Math.max(acc.r, t.x + t.width),
      b: Math.max(acc.b, t.y + t.height),
    }),
    { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
  );
  const view = { x: all.x, y: all.y, w: all.r - all.x, h: all.b - all.y };
  const marginUnits = o.marginMm / plan.mmPerUnit;

  return (
    <Modal title="Print" onClose={close}>
      <div className="print-layout">
        <div className="print-preview" aria-label={`Preview: ${pages} page${pages === 1 ? "" : "s"}`}>
          <svg viewBox={`${view.x - marginUnits} ${view.y - marginUnits} ${view.w + marginUnits * 2} ${view.h + marginUnits * 2}`}>
            {plan.tiles.map((t, i) => (
              <rect
                key={`p${i}`}
                x={t.x - marginUnits}
                y={t.y - marginUnits}
                width={t.width + marginUnits * 2}
                height={t.height + marginUnits * 2}
                fill="#fff"
                stroke="#c9ccd2"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <MapScene layout={layout} theme={LIGHT_THEME} imageUrl={(id, w) => displayUrl(id, w)} />
            {plan.tiles.length > 1 &&
              plan.tiles.map((t, i) => (
                <rect
                  key={`g${i}`}
                  x={t.x}
                  y={t.y}
                  width={t.width}
                  height={t.height}
                  fill="none"
                  stroke="#2f6fe0"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          </svg>
        </div>
        <div className="print-fields">
          <Segmented
            label="Paper"
            value={o.paper}
            options={(Object.keys(PAPER_MM) as PrintOptions["paper"][]).map((p) => ({ value: p, label: PAPER_MM[p].label }))}
            onChange={(paper) => set({ paper })}
          />
          <Segmented
            label="Orientation"
            value={o.orientation}
            options={[
              { value: "auto", label: "Auto" },
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
            onChange={(orientation) => set({ orientation })}
          />
          <Segmented
            label="Size"
            value={o.mode}
            options={[
              { value: "fit", label: "Fit to one page" },
              { value: "tile", label: "Across pages" },
            ]}
            onChange={(mode) => set({ mode })}
          />
          {o.mode === "tile" && (
            <Segmented
              label="Scale"
              value={o.scale}
              options={[50, 75, 100, 150, 200].map((s) => ({ value: s, label: `${s}%` }))}
              onChange={(scale) => set({ scale })}
            />
          )}
          <Segmented
            label="Margins"
            value={o.marginMm}
            options={[
              { value: 6, label: "Narrow" },
              { value: 12, label: "Normal" },
              { value: 20, label: "Wide" },
            ]}
            onChange={(marginMm) => set({ marginMm })}
          />
          <p className="field-note">
            {pages === 1 ? "1 page" : `${pages} pages (${plan.cols} × ${plan.rows})`}, {PAPER_MM[o.paper].label}{" "}
            {plan.landscape ? "landscape" : "portrait"}. Choose the same paper in the system print dialog.
          </p>
        </div>
      </div>
      <div className="modal-buttons">
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={() => void run()}>
          Print…
        </button>
      </div>
    </Modal>
  );
}

export function OutputDialogs() {
  const kind = useStore(outputStore, (s) => s.kind);
  if (!kind) return null;
  return kind === "print" ? <PrintDialog /> : <ExportDialog kind={kind} />;
}

registerCommands([
  { id: "export.svg", label: "SVG Image…", run: () => open("svg") },
  { id: "export.png", label: "PNG Image…", run: () => open("png") },
  { id: "export.jpeg", label: "JPEG Image…", run: () => open("jpeg") },
  { id: "file.print", label: "Print…", keys: ["Mod+P"], global: true, run: () => open("print") },
]);
