import type { ParseSuccess } from "../../lib/parse-file";

export type StepUploadFileProps = {
  onParsed: (result: ParseSuccess) => void;
  onBack: () => void;
};

export function StepUploadFile(_props: StepUploadFileProps) {
  return null;
}
