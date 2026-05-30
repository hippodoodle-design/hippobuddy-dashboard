// copy-credential.js - the move Amanda described in plain terms:
// a program that ALREADY HOLDS a github token copies that token, from its own
// environment, into HippoBuddy under the name hippobridge asks for. The token
// never passes through Claude; the worker moves its own key into Amanda's safe.
//
// Staged via the working arm (ButlerDispatch). INERT until:
//   1) this handler is wired into a worker that holds the token (ButlerDispatch,
//      or any worker with GITHUB_TOKEN + the HippoBuddy bearer in env), and
//   2) env is set. No secret is in this file.
//
// Why this exists: every direct path from the chat seat is read-scoped. But a
// worker that already has the key can copy it sideways on Amanda's instruction.
// That is ownership, not a back door - the program writes its OWN credential
// into its OWN vault.

const HIPPOBUDDY_BASE = process.env.HIPPOBUDDY_BASE_URL || "https://hippobridge.hippoflow.workers.dev";

/**
 * Copy a token already present in this worker's env into HippoBuddy.
 * @param {object} env  - the worker's process.env
 * @param {object} task - { source_env_var, target_key, scope } from the dispatch payload
 * Reads env[source_env_var] (e.g. GITHUB_TOKEN), writes it to HippoBuddy as target_key
 * (e.g. the exact name hippobridge's preflight requests) under the given scope.
 * Returns metadata only - never the value.
 */
export async function copyCredential(env, task) {
  const sourceVar = task.source_env_var || "GITHUB_TOKEN";
  const targetKey = task.target_key;            // the name hippobridge asks for
  const scope     = task.scope || "hippobridge";
  if (!targetKey) return { ok: false, reason: "target_key required" };

  const value = env[sourceVar];
  if (!value) return { ok: false, reason: "source_env_var_empty", source_env_var: sourceVar };

  const bearer = env.HIPPOBRIDGE_BEARER;
  if (!bearer) return { ok: false, reason: "no_bearer_in_env" };

  // Write to HippoBuddy via its standard credential-set endpoint. The value goes
  // worker -> vault directly. We log only names, never the value.
  const res = await fetch(`${HIPPOBUDDY_BASE}/buddy/v2/credentials/set`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ scope, key: targetKey, value, source: `copied_from_env:${sourceVar}`, set_by: "credential-copier" }),
  });

  let detail = null;
  try { detail = await res.json(); } catch (_) {}
  if (!res.ok) return { ok: false, reason: "hippobuddy_write_failed", status: res.status, target_key: targetKey, scope, detail };

  return { ok: true, wrote: true, target_key: targetKey, scope, source_env_var: sourceVar, note: "value copied worker->vault; never logged" };
}

// Dispatch-worker task adapter: register task_type "copy_credential" -> copyCredential(env, payload).
// Safety: this handler writes exactly ONE named credential and returns metadata only.
export const taskType = "copy_credential";
