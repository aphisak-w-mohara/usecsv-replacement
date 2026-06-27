import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "../../lib/cn";

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
    <div className="flex flex-col gap-6">
      <header className="border-b border-border pb-3">
        <h1 className="text-xl font-semibold text-foreground">{importerName}</h1>
      </header>
      <nav
        role="tablist"
        aria-label="Importer settings"
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(t.key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
              )}
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
