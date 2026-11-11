/**
 * Groq SDK client + model constants.
 *
 * Server-side ONLY. Never import this module (or `groq-sdk`) from a
 * file marked "use client" - doing so would ship the API key to the
 * browser. All AI calls go through Route Handlers under /api/ai/* or
 * /api/chat, which run on the server.
 *
 * Models are read from env with sensible defaults so a missing
 * GROQ_MODEL_* doesn't crash the app, but a missing GROQ_API_KEY
 * throws a clear error immediately (see src/lib/env.ts).
 */
import Groq from "groq-sdk";
import { getEnv } from "@/lib/env";

/**
 * Main model: used for chat, journal analysis, market briefs, trade
 * checks - anything that benefits from stronger reasoning.
 */
export const GROQ_MODEL_MAIN: string = getEnv().GROQ_MODEL_MAIN;

/**
 * Fast model: used for lightweight tasks (classification, short
 * summaries) where latency matters more than depth.
 */
export const GROQ_MODEL_FAST: string = getEnv().GROQ_MODEL_FAST;

/**
 * Singleton Groq client. Created once per process.
 *
 * `getEnv()` already validated that GROQ_API_KEY is non-empty, so
 * by the time we reach this line the key exists. If env validation
 * was bypassed (e.g. in a test), the Groq SDK will itself throw a
 * clear "API key is required" error on first use.
 */
let _client: Groq | null = null;

export function getGroq(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: getEnv().GROQ_API_KEY });
  }
  return _client;
}

/**
 * True when GROQ_API_KEY is configured. Useful for showing a friendly
 * "missing key" banner in the UI instead of letting the first API
 * call fail with a cryptic 500.
 */
export function isGroqConfigured(): boolean {
  try {
    return getEnv().GROQ_API_KEY.length > 0;
  } catch {
    return false;
  }
}
