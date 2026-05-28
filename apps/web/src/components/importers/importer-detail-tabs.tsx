import type { ReactNode } from "react";
import { useState } from "react";

export type ImporterTabKey = "general" | "columns" | "environments";

type TabDef = { key: ImporterTabKey; label: string };

const TABS: readonly TabDef[] = [
  { key: "general", label: "General" },
  { key: "columns", label: "Columns" },
  { key: "environments", label: "Environments" },
] as const;

type Props = {
  importerName: string;
  initialTab?: ImporterTabKey;
  renderTab: (tab: ImporterTabKey) => ReactNode;
};

export function ImporterDetailTabs({ importerName, initialTab = "general", renderTab }: Props) {
  const [active, setActive] = useState<ImporterTabKey>(initialTab);

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-slate-200 pb-2">
        <h1 className="text-xl font-semibold text-slate-900">{importerName}</h1>
      </header>
      <nav role="tablist" aria-label="Importer settings" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                selected
                  ? "border-b-2 border-slate-900 px-4 py-2 text-sm font-medium text-slate-900"
                  : "border-b-2 border-transparent px-4 py-2 text-sm text-slate-500 hover:text-slate-900"
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <section role="tabpanel">{renderTab(active)}</section>
    </div>
  );
}
