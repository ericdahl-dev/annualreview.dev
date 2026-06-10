import { isDbConfigured } from "../db.js";

export function isEvidenceArchiveConfigured(): boolean {
  return isDbConfigured();
}
