import type { ImporterColumn } from "../../lib/fuzzy-match";

export type StepMatchColumnsProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  onMatched: (matchedColumnsMap: Record<string, string>) => void;
  onBack: () => void;
};

export function StepMatchColumns(_props: StepMatchColumnsProps) {
  return null;
}
