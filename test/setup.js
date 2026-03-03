import "dotenv/config";

// Payment/premium tests assume 1 credit per purchase; override .env so they pass regardless of local config.
if (process.env.DATABASE_URL) {
  process.env.CREDITS_PER_PURCHASE = "1";
}

import "@testing-library/jest-dom/vitest";
