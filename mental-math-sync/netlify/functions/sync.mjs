import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const same = (a, b) => {
  const x = Buffer.from(a || ""), y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};

// Every env var named SYNC_KEY or SYNC_KEY_<NAME> is one person.
//   SYNC_KEY          -> store "mental-math"        (your existing data, untouched)
//   SYNC_KEY_SISTER   -> store "mental-math-sister" (separate data)
// To add another person later: add SYNC_KEY_<NAME> in Netlify and redeploy. No code change.
const users = () =>
  Object.entries(process.env)
    .filter(([k, v]) => v && (k === "SYNC_KEY" || /^SYNC_KEY_[A-Z0-9_]+$/.test(k)))
    .map(([k, v]) => ({
      key: v,
      store: k === "SYNC_KEY" ? "mental-math" : "mental-math-" + k.slice(9).toLowerCase().replace(/_/g, "-"),
    }));

const J = (o) => Response.json(o, { headers: { "cache-control": "no-store" } });

export default async (req) => {
  const sent = req.headers.get("x-sync-key");
  let who = null;
  for (const u of users()) if (same(sent, u.key) && !who) who = u; // checks all, no early exit
  if (!who) return new Response("unauthorized", { status: 401 });

  const store = getStore({ name: who.store, consistency: "strong" });

  if (req.method === "GET") {
    // /api/sync?backup=1 returns the daily safety copy
    if (new URL(req.url).searchParams.has("backup")) {
      return J((await store.get("backup", { type: "json" })) || {});
    }
    return J({ data: await store.get("state", { type: "json" }) });
  }
  if (req.method === "PUT") {
    if (Number(req.headers.get("content-length") || 0) > 4e6) return new Response("too large", { status: 413 });
    const body = await req.json().catch(() => null);
    if (!body || !body.sk || !Array.isArray(body.sessions)) return new Response("bad data", { status: 400 });
    const old = await store.get("state", { type: "json" });
    if (old && Array.isArray(old.sessions) && body.sessions.length < old.sessions.length) {
      return new Response("would lose sessions", { status: 409 });
    }
    const bk = await store.get("backup", { type: "json" });
    if (old && (!bk || Date.now() - (bk.at || 0) > 864e5)) await store.setJSON("backup", { at: Date.now(), state: old });
    await store.setJSON("state", body);
    return J({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};

export const config = { path: "/api/sync" };
