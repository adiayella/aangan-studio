// Neon Data API (PostgREST) base URL. This URL is not a secret; access is controlled by the login token.
export const API_URL = "https://ep-purple-recipe-b574hdyn.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1";

// Neon Auth (Better Auth) base URL, used for designer sign-in.
export const AUTH_URL = "https://ep-purple-recipe-b574hdyn.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";

// Pipeline stages a designer can move a lead through.
export const STAGES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["consult_scheduled", "Consultation scheduled"],
  ["consult_done", "Consultation done"],
  ["won", "Won"],
  ["lost", "Lost"],
];
