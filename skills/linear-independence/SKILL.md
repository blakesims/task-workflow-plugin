---
name: linear-independence
description: Use whenever you are presenting the user with questions or options to reduce cognitive load and complexity. You remove the dependence to cut to the essence.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/linear-independence/SKILL.md
---

When working with me, assume I am managing many agents at once and have limited bandwidth.

Before asking me anything, reduce all questions to the smallest possible set of independent decisions.

A question is worth asking me only if it changes one of these:
* product behaviour
* user experience
* business rules
* system architecture
* performance or scalability
* client/customer impact
* operational risk
* long-term maintenance cost

Do **not** ask me questions that can be answered by:

* reading the existing code
* following existing naming/schema/API patterns
* using standard implementation conventions
* choosing an internal technical detail with no product or architecture impact

If a question is purely technical, answer it yourself from the codebase and proceed.

If there are many related questions, compress them into the smallest linearly independent set: no question should be a duplicate, subset, or consequence of another.

When you ask me something, explain:

* the decision
* the tradeoff
* the cost of each option
* your recommendation

Use language about structure, logic, intent, and consequences. Avoid unnecessary coding terminology.
The user has a background in mathematics. They are an expert in Linear Algebra. You can rely on this framing to help here.


## Good Questions to Ask Me

### Business logic location

Bad:

* "Should I put this function in `webhookHandler.ts` or `pollerService.ts`?"

Good:

* "The webhook handler and poller both apply the same business rule. Should we centralise this rule so both paths behave identically, at the cost of creating a shared service?"

Why this is good:

* It is architectural.
* It affects bugs and maintenance.
* It identifies the real issue: duplicated business logic.


### API batching

Bad:

* "Should I use `Promise.all` or a loop?"

Good:

* "Should this API call prioritise speed by batching requests, or safety by processing them sequentially to reduce rate-limit risk?"

Why this is good:

* It maps the technical choice to performance and reliability.
* The user can reason about the tradeoff.


### Database column names

Bad:

* "Should the column be called `user_id`, `userId`, or `account_user_id`?"

Good:

* Do not ask. Follow the existing schema convention.

Why this is good:

* It is not a product or architecture decision.
* It can be answered from the code.


### UI behaviour

Bad:

* "Should I use a modal or drawer component?"

Good:

* "Should this action feel like a quick inline edit, or like a serious confirmation step before a potentially destructive change?"

Why this is good:

* It turns implementation into UX intent.


### Error handling

Bad:

* "Should I throw an exception here?"

Good:

* "If this external service fails, should the user see a hard failure, or should we save the request and retry in the background?"

Why this is good:

* It affects user experience and operational behaviour.


### Refactor scope

Bad:
* "Should I refactor these three files?"

Good:
* "There are two copies of the same rule. Option A fixes only the bug quickly. Option B centralises the rule and reduces future inconsistency. I recommend B unless speed is the priority."
Why this is good:
* It presents cost and consequence.
