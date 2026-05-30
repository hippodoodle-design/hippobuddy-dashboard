// steward-door/buddies.js — per-provider adapters. Endpoints + shapes only. NO KEYS.
// Keys come from env at runtime, sourced from HippoBuddy by the Worker.
// A missing key => {ok:false, reason:"no_key"}.

export const BUDDIES = {
  chatgpt: { envKey: "OPENAI_API_KEY", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o",
    build: (b, key, model) => ({ headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: { model, max_tokens: b.max_tokens || 1024, messages: msgs(b) } }),
    pluck: (d) => d.choices?.[0]?.message?.content ?? "" },
  deepseek: { envKey: "DEEPSEEK_API_KEY", url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat",
    build: (b, key, model) => ({ headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: { model, max_tokens: b.max_tokens || 1024, messages: msgs(b) } }),
    pluck: (d) => d.choices?.[0]?.message?.content ?? "" },
  perplexity: { envKey: "PERPLEXITY_API_KEY", url: "https://api.perplexity.ai/chat/completions", model: "sonar",
    build: (b, key, model) => ({ headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: { model, max_tokens: b.max_tokens || 1024, messages: msgs(b) } }),
    pluck: (d) => d.choices?.[0]?.message?.content ?? "" },
  gemini: { envKey: "GEMINI_API_KEY", model: "gemini-1.5-pro",
    url: (key, model) => "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key,
    build: (b) => ({ headers: { "content-type": "application/json" }, body: { systemInstruction: b.system ? { parts: [{ text: b.system }] } : undefined, contents: [{ role: "user", parts: [{ text: b.prompt }] }], generationConfig: { maxOutputTokens: b.max_tokens || 1024 } } }),
    pluck: (d) => d.candidates?.[0]?.content?.parts?.[0]?.text ?? "" },
};

function msgs(b) {
  const m = [];
  if (b.system) m.push({ role: "system", content: b.system });
  m.push({ role: "user", content: b.prompt });
  return m;
}

export async function askBuddy(env, buddy, body) {
  const cfg = BUDDIES[buddy];
  if (!cfg) return { ok: false, reason: "unknown_buddy", buddy };
  const key = env[cfg.envKey];
  if (!key) return { ok: false, reason: "no_key", buddy };
  const model = body.model || cfg.model;
  const url = typeof cfg.url === "function" ? cfg.url(key, model) : cfg.url;
  const { headers, body: reqBody } = cfg.build(body, key, model);
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(reqBody) });
    const data = await r.json();
    if (!r.ok) return { ok: false, reason: "provider_error", status: r.status, buddy, detail: data };
    return { ok: true, buddy, model, reply: cfg.pluck(data), usage: data.usage || null };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", buddy, detail: String(e) };
  }
}
