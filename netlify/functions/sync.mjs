import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const same = (a, b) => {
  const x = Buffer.from(a || ""), y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async (req) => {
  if (!process.env.SYNC_KEY || !same(req.headers.get("x-sync-key"), process.env.SYNC_KEY)) {
    return new Response("unauthorized", { status: 401 });
  }
  const store = getStore({ name: "mental-math", consistency: "strong" });

  if (req.method === "GET") {
    // /api/sync?backup=1 returns the daily safety copy
    if (new URL(req.url).searchParams.has("backup")) {
      return Response.json((await store.get("backup", { type: "json" })) || {});
    }
    return Response.json({ data: await store.get("state", { type: "json" }) });
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body || !body.sk || !Array.isArray(body.sessions)) return new Response("bad data", { status: 400 });
    const old = await store.get("state", { type: "json" });
    if (old && Array.isArray(old.sessions) && body.sessions.length < old.sessions.length) {
      return new Response("would lose sessions", { status: 409 });
    }
    const bk = await store.get("backup", { type: "json" });
    if (old && (!bk || Date.now() - (bk.at || 0) > 864e5)) await store.setJSON("backup", { at: Date.now(), state: old });
    await store.setJSON("state", body);
    return Response.json({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};

export const config = { path: "/api/sync" };
