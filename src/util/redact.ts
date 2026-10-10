/** Strips secrets and personal data from text before it is stored or shown (error messages, logs). */
const RULES: [RegExp, string][] = [
  [/pat-[a-z0-9]+-[0-9a-f-]{20,}/gi, "[hubspot-key]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [/AQ\.[A-Za-z0-9_-]{20,}/g, "[gemini-key]"],
  [/napi_[A-Za-z0-9]+/g, "[neon-key]"],
  [/nt_live_[A-Za-z0-9_]+/g, "[neon-token]"],
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database-url]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Phone numbers: anything with a leading + or digit-group separators, or a bare Indian mobile (10 digits starting 6-9,
  // optionally with 91). Plain 12-digit HubSpot record ids start with 5 or 3 and are deliberately left readable.
  [/\+\d[\d\s().-]{8,}\d|\b\d{3,5}[\s.-]\d{5,6}\b|\b(?:91)?[6-9]\d{9}\b/g, "[phone]"],
];

export function redact(text: string, max = 500): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out.length > max ? out.slice(0, max) + "…" : out;
}
