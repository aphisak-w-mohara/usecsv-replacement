export type StepContextSubmit = {
  ticketReference: string;
  note: string;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
};

export function StepContext(_props: { onSubmit: (v: StepContextSubmit) => void }) {
  return null;
}
