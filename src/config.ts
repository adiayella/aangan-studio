import { config as loadEnv } from "dotenv";

// Local development reads .env.local; on Vercel the same names come from project settings.
loadEnv({ path: ".env.local", quiet: true });

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const optionalEnv = (name: string, fallback = "") => process.env[name] || fallback;
