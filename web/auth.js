import { AUTH_URL } from "./config.js";

const isJwt = (s) => typeof s === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s);
const KEY = "aangan_session";

function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function stored() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } }
export function signOut() { try { sessionStorage.removeItem(KEY); } catch {} }

async function post(path, body) {
  const r = await fetch(`${AUTH_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

/** Exchange a session token for the short-lived JWT the Data API accepts. */
async function fetchJwt(sessionToken) {
  const r = await fetch(`${AUTH_URL}/token`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  if (!r.ok) throw new Error(`Could not get an access token (${r.status}).`);
  const j = await r.json();
  const jwt = j.token || j.access_token || j.jwt;
  if (!isJwt(jwt)) throw new Error("Sign-in worked but no usable access token was returned.");
  return jwt;
}

export async function signIn(email, password) {
  const res = await post("/sign-in/email", { email, password });
  if (!res.ok) throw new Error(res.json?.message || `Sign-in failed (${res.status}). Check your email and password.`);
  const j = res.json || {};
  const sessionToken = j.token || j.session?.token || null;
  let jwt = [j.jwt, j.access_token, j.session?.access_token].find(isJwt) || null;
  if (!jwt && sessionToken) jwt = await fetchJwt(sessionToken);
  if (!jwt) throw new Error("Signed in, but could not get an access token. Please tell your admin.");
  const s = { jwt, sessionToken, email: j.user?.email || email, name: j.user?.name || "" };
  save(s);
  return s;
}

/** Renew the JWT using the stored session token; returns the new session or null. */
export async function refresh() {
  const s = stored();
  if (!s?.sessionToken) return null;
  try { s.jwt = await fetchJwt(s.sessionToken); save(s); return s; } catch { return null; }
}
