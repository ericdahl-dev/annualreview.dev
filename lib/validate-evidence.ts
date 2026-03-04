// Validates data against schemas/evidence.json (timeframe, contributions, etc.). Used by CLI and tests.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "schemas", "evidence.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ strict: false, logger: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ErrorObject[] };

/** Returns { valid: true } or { valid: false, errors }. */
export function validateEvidence(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) return { valid: true };
  return { valid: false, errors: validate.errors ?? [] };
}
