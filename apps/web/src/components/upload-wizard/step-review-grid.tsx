import type { ImporterColumn } from "../../lib/fuzzy-match";

export type StepReviewGridProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  matched: Record<string, string>;
  filterInvalidRows: boolean;
  disableIfAnyInvalid: boolean;
  onConfirmed: () => void;
  onBack: () => void;
};

export function StepReviewGrid(_props: StepReviewGridProps) {
  return null;
}
