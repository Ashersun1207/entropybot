/** Authenticated collection output. URLs and text are inert data, never markup or file handles. */
export interface CollectionReportResponse {
  version: 1;
  pages: number;
  unique: number;
  hash: string;
  sources: Array<{ url: string; text: string }>;
}
