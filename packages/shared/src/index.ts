export type { WebhookPayload, WebhookErrorsResponse } from "./webhook.js";

export type WebhookDispatchJob = {
  uploadId: string;
  batchIndex: number;
  attempt: number;
};
