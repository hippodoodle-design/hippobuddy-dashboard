# Wiring the credential copier (3 lines, this afternoon)

Plain version of what this does: a worker that ALREADY holds the GitHub token copies
it into HippoBuddy under the name hippobridge is asking for. Then propagation injects
it, hippobridge boots, churn stops. The token never touches Claude.

## To make it live (in a worker that holds GITHUB_TOKEN + HIPPOBRIDGE_BEARER)
1. Import: `import { copyCredential, taskType } from "./copy-credential.js";`
2. Register the task type in the dispatch handler switch:
   `if (task.task_type === "copy_credential") return copyCredential(process.env, task.payload);`
3. Ensure env has: GITHUB_TOKEN (the token to copy), HIPPOBRIDGE_BEARER, HIPPOBUDDY_BASE_URL.

## Then queue one job
```sql
insert into dispatch_queue (dispatch_id, status, task_type, safety_class, summary, payload, authorisation, source)
values (gen_random_uuid(), 'queued', 'copy_credential', 'confirm',
  'copy GITHUB_TOKEN env -> HippoBuddy as the name hippobridge requests',
  jsonb_build_object('source_env_var','GITHUB_TOKEN','target_key','<NAME_FROM_CC_DIAGNOSIS>','scope','hippobridge'),
  jsonb_build_object('method','amanda_confirm','rationale','owner copying own key into own vault'),
  'claude_app');
```

## The one unknown to fill first
`target_key` = the exact name hippobridge's preflight asks for. That is what the
diagnosis question to CC (cc-inbox dispatch ca787499) will return. Until then, leave
target_key as a placeholder. If the diagnosis shows the token is already in HippoBuddy
under another name, you do not even need this copier - it is a rename, not a copy.

## Honest note
This is staged in hippobuddy-dashboard (the repo the dispatch worker can write).
To run, it must be lifted into a worker that holds the token. ButlerDispatch is the
natural host - but adding the task type there needs an edit to the hippobutler-dispatch
repo, which the chat-seat connector cannot write. So this is built and waiting; the
lift is a laptop/clean-session step, or flip the connector to write and Claude does it.
