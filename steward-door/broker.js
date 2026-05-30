// steward-door/broker.js — key-less broker + HippoBuddy read door.
// Staged via ButlerDispatch; intended to run in the hippobridge Worker.
// Inert until env keys exist. No secrets in this file. See steward-door/README.md.
import { askBuddy, BUDDIES } from "./buddies.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

function bearerOk(req, env) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  return env.HIPPOBRIDGE_BEARER && tok === env.HIPPOBRIDGE_BEARER;
}

async function audit(env, entry) {
  try {
    if (!env.BRIDGE_AUDIT_URL) return;
    await fetch(env.BRIDGE_AUDIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.HIPPOBRIDGE_BEARER },
      body: JSON.stringify({ channel: "control-plane-audit:bonnie-bothy-cloud", sender: "steward-door", content: { ...entry, ts: new Date().toISOString() } }),
    });
  } catch (_) {}
}

const allowedKeys = (env) => (env.STEWARD_ALLOWED_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
const ENV_NAME = { github_token: "GITHUB_TOKEN", openai_key: "OPENAI_API_KEY", gemini_key: "GEMINI_API_KEY", deepseek_key: "DEEPSEEK_API_KEY", perplexity_key: "PERPLEXITY_API_KEY" };

export async function handleGet(req, env) {
  if (!bearerOk(req, env)) return json({ error: "unauthorized" }, 401);
  const { key } = await req.json().catch(() => ({}));
  if (!key) return json({ error: "key required" }, 400);
  if (!allowedKeys(env).includes(key)) {
    await audit(env, { endpoint: "get", key, result: "denied_not_allowlisted" });
    return json({ error: "key not allow-listed", key }, 403);
  }
  const value = env[ENV_NAME[key] || key.toUpperCase()];
  await audit(env, { endpoint: "get", key, result: value ? "served" : "not_found" });
  return json({ key, value: value || null, found: Boolean(value) });
}

export async function handleAsk(req, env) {
  if (!bearerOk(req, env)) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (!body.buddy || !body.prompt) return json({ error: "buddy and prompt required" }, 400);
  await audit(env, { endpoint: "ask", buddy: body.buddy });
  const res = await askBuddy(env, body.buddy, body);
  return json(res, res.ok === false ? 502 : 200);
}

export async function handleCouncil(req, env) {
  if (!bearerOk(req, env)) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const list = Array.isArray(body.buddies) && body.buddies.length ? body.buddies : Object.keys(BUDDIES);
  if (!body.prompt) return json({ error: "prompt required" }, 400);
  await audit(env, { endpoint: "council", buddies: list });
  const replies = await Promise.all(list.map(b => askBuddy(env, b, body).then(r => ({ buddy: b, ...r }))));
  return json({ replies });
}

export async function route(req, env) {
  const { pathname } = new URL(req.url);
  if (req.method === "POST" && pathname.endsWith("/buddy/v2/steward/get")) return handleGet(req, env);
  if (req.method === "POST" && pathname.endsWith("/buddy/v2/steward/ask")) return handleAsk(req, env);
  if (req.method === "POST" && pathname.endsWith("/buddy/v2/steward/council")) return handleCouncil(req, env);
  return json({ error: "not found" }, 404);
}
