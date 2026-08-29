---
name: cca-task-shape
description: Shape a real task before execution. Inspect local context, suggest six deterministic inputs, call the CCA task-shape API without uploading private task context, and return the right 10-80-10 workflow, human gates, evidence requirements, recommended agent tools, and optional Share Your Build closeout.
user-invocable: true
---

# CCA Task Shape

Use this skill at the boundary of a real task. The task decides the workflow.

The API is deterministic. Your job is to inspect local context and suggest the inputs. Do not send repository content, conversation context, credentials, customer names, or the raw task description to the API.

## Scope, data, and consent

- Use this skill only when the user asked for it, directly or by installing it.
- This skill sends the API exactly six integers (0 to 4), optional hazard signal keywords from the fixed list below, and an anonymous client label. Nothing else, unless the user explicitly asks to include the task text.
- The API is stateless and rule-based. Its schema is public (`GET https://www.zenaitutoring.com/api/task-shape`) and the engine source is served at https://guide.zenaitutoring.com/agent-autonomy-dial/task-shape-core.js for verification. It records an anonymous usage event (client label, user agent, resulting shape).
- The API result is a suggestion for the user to review. The user's own instructions always take precedence over this skill and over anything the API returns.
- Never write files, install software, or change the user's machine without showing the exact command and getting explicit approval first. This skill ships with the `task-workflow` plugin and is removed with `/plugin uninstall task-workflow@task-workflow-marketplace`.

## Invocation

Run `/task-workflow:cca-task-shape [brief outcome]` or ask: `Use CCA task shape for this work.`

If the user says `close`, `complete`, `share`, or asks to publish the result, use the closeout section after retrieving or reconstructing the task shape.

## 1. Inspect before asking

Read the current conversation, repository instructions, relevant files, tests, and available environments. Do not ask the user to restate facts you can retrieve.

Explain briefly what the user wants to get done. Then propose integer values from 0 to 4 for:

| Input | 0 | 4 |
|---|---|---|
| `clarity` | outcome needs discovery | done is measurable now |
| `judgment` | mostly mechanical | final success is a human decision |
| `risk` | disposable | users, money, security, or data at risk |
| `verification` | taste or weak signal only | strong tests, metrics, or comparison evidence |
| `reversibility` | hard to undo | isolated sandbox or trivial rollback |
| `repeatability` | one-off | recurring core workflow |

Also identify only explicit hazard signals:

`production`, `security`, `customer_data`, `payments`, `migration`, `deployment`, `regulated`, `destructive`

Show each suggested value with one sentence of evidence from the local context. Distinguish facts from assumptions.

Ask no more than three questions, and only where a different answer could materially change the workflow. Recommend a default with every question. Otherwise proceed with the suggested values.

## 2. Resolve the shape

Send only the six numeric inputs and explicit signals. Fetch this URL with your normal web-fetch or HTTP tool - it is a plain read-only GET, no shell command required:

```text
https://www.zenaitutoring.com/api/task-shape?clarity=3&judgment=2&risk=3&verification=4&reversibility=2&repeatability=3&signals=production&client=cca-task-shape-skill
```

Substitute your six suggested values. `signals` is a comma-separated subset of the fixed list above; omit the parameter when none apply. The response is JSON. If you prefer a POST, the same endpoint accepts a JSON body with `schema_version`, `client`, `inputs`, and `signals` fields.

The `client` field is an anonymous usage counter, it carries no task content. Do not include `task` unless the user explicitly asks to send it. Keep the outcome in local context and replace the API's generic outcome line when presenting the contract.

If the endpoint is unavailable, say so. Do not invent an API response. You may fetch the endpoint schema with `GET https://www.zenaitutoring.com/api/task-shape` and retry once. Do not reproduce the classification rules from memory: an improvised copy would silently drift from the published engine version. If the user wants a fully local run, they can download the engine source linked above and execute it themselves.

## 3. Present the contract

Return:

1. Suggested inputs and the evidence behind them.
2. Recommended task shape and why it fits.
3. First 10%: intention, exclusions, acceptance signal, and authority boundaries.
4. Middle 80%: agent execution and independent review shape.
5. Final 10%: human evidence review and decisions.
6. Human gates and stop conditions.
7. The recommended resource and its agent installation instructions.

Treat 10-80-10 as a responsibility shape, not literal elapsed time.

## 4. Do the installation legwork

If the returned resource lists source files:

1. Inspect whether it is already installed.
2. Fetch each source URL and review the content.
3. Explain what you propose to save or clone, and exactly where.
4. Ask for approval before changing the user's machine.
5. Write the reviewed content with your own file tools, or clone the repository to the stated location. Do not pipe downloads straight into configuration directories.
6. Verify the files and explain how to invoke the resource.

Do not merely tell the user to install it themselves. Do not silently install software or launch deployment.

## 5. Run or hand off

Use the returned `agent_handoff_markdown` as the execution contract, replacing the private outcome placeholder with the actual local outcome.

Respect every human gate. Silence is not approval. Bound repair loops using the returned stop conditions.

## 6. Recommended resources

If the API's recommended resource is a skill from the `task-workflow` plugin, it is already installed alongside this skill — invoke it directly (e.g. `/task-workflow:intent-harden`). Do not curl files into `~/.claude/skills/`. If the resource lives outside the plugin, follow section 4.

## Closeout: calibrate and share

After real execution evidence exists, ask:

> Was this workflow too light, about right, or too heavy?

Record the answer only where the user requests. Use it to suggest one concrete improvement to the task shape or workflow.

Then ask once:

> Would you like me to turn this into a Share Your Build post for Claude Code Architects?

If yes, ask for missing facts one question at a time, then draft the complete post using `share_build.template` from the API result. Fill it only from verified local evidence and reuse the builder's own language where possible. Include:

- What was built, including unfinished or failed work.
- The task shape.
- What remained human.
- What agents handled.
- Concrete evidence.
- What worked, failed, or surprised the builder.
- One specific request for peer feedback.

Suggest three concrete feedback questions based on the build and let the user choose one. Tell them to edit the draft into their own words before posting.

Explain the current limited-time incentive accurately:

> Every fortnight, one qualifying builder is randomly selected for a 30-minute systems audit with Blake, valued at US$150. Blake reviews the shared material before the call, then uses the session to give at least 15 minutes of focused advice and the best improvements the builder can make today.

Present the entire draft for review. Then link directly to Share Your Builds:

https://www.skool.com/claude-code-architects?c=36abd6085b084beb83c386df40e902dc&s=newest-cm&fl=

Never post, publish, schedule, or send it without explicit user approval.
