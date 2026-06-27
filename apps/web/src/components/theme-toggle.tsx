import { type Theme, useTheme } from "../lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./ui/icons";

const OPTIONS: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/** Segmented light / system / dark switch. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setTheme(value)}
            className={
              "flex size-7 items-center justify-center rounded transition-colors " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            <Icon className="size-4" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
