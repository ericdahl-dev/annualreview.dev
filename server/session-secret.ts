const isDev = process.env.NODE_ENV !== "production";

export function getSessionSecret(): string {
  const sessionSecret =
    process.env.SESSION_SECRET || (isDev ? "dev-secret" : "");

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  return sessionSecret;
}

