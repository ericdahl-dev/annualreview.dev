/** Shared API error code constants used by both server routes and frontend clients. */

/** Returned (HTTP 503) when a premium request is made but the credit store (DATABASE_URL) is not configured. */
export const PAYMENTS_NOT_CONFIGURED = "PAYMENTS_NOT_CONFIGURED" as const;
