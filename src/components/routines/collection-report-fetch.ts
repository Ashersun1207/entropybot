import { api } from "@/state/api";

// The authorized artifact cap is 61 MB; 1 MB also covers the report's JSON envelope after replacing private binding metadata.
export const COLLECTION_REPORT_RESPONSE_BYTES = 62_000_000;

export function fetchCollectionReport(routineId: string, runId: string, signal: AbortSignal): Promise<unknown> {
  return api(`/api/routines/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(runId)}/collection-report`, {
    signal, timeoutMs: 15_000, responseByteLimit: COLLECTION_REPORT_RESPONSE_BYTES,
  });
}
