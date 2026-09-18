---
name: audit-rules
description: Audits CLAUDE.md files to suggest high-signal, concise rules based on recent changes or a general audit.
---

# Codebase Rule Auditor

Your goal is to curate `CLAUDE.md` files that are **high-signal** and **low-noise**.

## Phase 1: Discovery
1. Run `find . -name "CLAUDE.md" -not -path "*/node_modules/*"` to identify rule scopes.
2. Read all found `CLAUDE.md` files.
3. Analyze the recent conversation/modifications to understand the "Lesson Learned."

## Phase 2: Distillation & Quality Control
Draft rules based on your findings, but filter them through this **Rule Style Guide**:

1.  **Risk-Based:** State the concrete failure a rule prevents and its scope. Do not turn optional style/tooling preferences into universal blockers.
2.  **Grep-able:** Use specific function names or file patterns (e.g., `useDateRangeData` vs "date hooks").
3.  **No Fluff:** Remove words like "ensure," "please," "make sure to," "it is recommended."
4.  **Concise, not lossy:** Prefer a short rule with a `docs/` pointer for detail. Preserve substantive safety conditions; no line or word quota.

*Example of Distillation:*
*   *Draft:* "When fixing the timezone bug, we realized we should use local time."
*   *Final:* "UI Dates: Use `formatDateLocal`. Ban `toISOString`."

## Phase 3: The Report
Output your recommendations.
Give your confidence and reasoning for each recommendation.


### 1. 🆕 Proposed Additions (Concise)
| Scope | Rule Text (Markdown) | Rationale (Do not add to file) |
| :--- | :--- | :--- |
| `client/CLAUDE.md` | `- Dates: Use `formatDateLocal` (prevents UTC off-by-one errors)` | Fixes DayGridView timezone bug |

### 2. ✂️ Pruning & Compacting
*Identify rules that can be shortened or removed.*
| Scope | Original (Bloated) | Proposed (Concise) |
| :--- | :--- | :--- |
| `tasks/CLAUDE.md` | "When you are creating a task, you should move it to..." | "Status Change: Move folder `planning/` → `active/` → `completed/`" |

---
**Final Check:** Remove repetition, preserve material safety and approved requirements, and separate necessary corrections from nonblocking suggestions. On follow-up, review changed rules and affected scopes rather than repeating the entire audit.

Once confirmed with the user you can then update the rule files.

