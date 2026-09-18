# Order lifecycle

The one description of what an order does. Everything else — the admin screens,
the job runner, the transactional emails — cites this file rather than
restating it. Four defects were traced to the lifecycle living as prose
fragments in several places at once, so `transitions.ts` is generated from this
table by hand and asserted against it in `transitions.test.ts`.

| State | Entered when | Capacity | Jobs enqueued | Email | Money |
|---|---|---|---|---|---|
| `pending_payment` | checkout created | held (soft, 30 min) | `expire_unpaid` (+30m) | — | deposit PaymentIntent created |
| `confirmed` | webhook `payment_intent.succeeded` | **locked** | `cooling_window_transfer` (+48h), `charge_balance` (event−14d) | order confirmed | deposit captured |
| `balance_due` | balance job starts | locked | — | — | off-session charge attempted |
| `action_required` | balance charge declined / needs 3DS | locked | `balance_grace_expiry` (+72h) | balance failed **with payment link** | none |
| `issue` | customer or admin flags a problem | locked | transfers **paused** | — | payouts held |
| `fulfilled` | admin or vendor marks done | consumed | `auto_complete_order` (event_end + 72h) | — | none |
| `completed` | auto-complete job | consumed | — | review unlocked | balance share transferred |
| `cancelled` | 48h cooling-window cancel, grace expiry, or admin | **released** | pending jobs cancelled | cancellation | refund per §8.3 |
| `refunded` | refund settles | released | pending jobs cancelled | refund issued | refund recorded |

## The moves, and only these

```
pending_payment → confirmed          deposit captured
pending_payment → cancelled          unpaid for 30 minutes, or an admin cancels

confirmed       → balance_due        the balance job starts
confirmed       → fulfilled          delivered
confirmed       → issue              a problem is raised
confirmed       → cancelled          inside the cooling window, or an admin cancels

balance_due     → confirmed          the balance was captured
balance_due     → action_required    declined, or the card wants a challenge
balance_due     → issue              a problem is raised
balance_due     → cancelled          an admin cancels

action_required → confirmed          paid through the emailed link
action_required → issue              a problem is raised
action_required → cancelled          the grace window expired

issue           → confirmed          resolved, and the booking stands
issue           → fulfilled          resolved, and it had already been delivered
issue           → cancelled          resolved by calling it off

fulfilled       → completed          auto-complete, event_end + 72h
fulfilled       → issue              a problem raised after delivery

completed       → refunded           a refund made in the provider dashboard settles
cancelled       → refunded           the refund settles
```

`refunded` is the end. Nothing leaves it.

## Why the edges that are missing are missing

**No `confirmed → pending_payment`.** Money that has been captured is not
un-captured by a state change; that is a refund, which is its own path.

**No `fulfilled → cancelled`.** A delivered booking that goes wrong is an
`issue`, and the resolution of an issue is where cancelling is decided. Keeping
the direct edge out means the record always says a human looked.

**No `completed → cancelled`.** The only thing that may still happen to a
finished order is money going back, which is `refunded`.

**`balance_due → confirmed` rather than a `paid_in_full` state.** Whether the
balance has been taken is a fact about the payment rows, not about the order:
adding a state for it would give the same booking two spellings of "waiting for
the event", and every screen would have to know both.

## Capacity

A booking holds a slot through `capacity_blocks`, whose exclusion constraint is
the actual double-booking guarantee. The state decides what the slot is doing:

| Effect | States | Block |
|---|---|---|
| `held` | `pending_payment` | active — soft, and released after 30 minutes if nothing is paid |
| `locked` | `confirmed`, `balance_due`, `action_required`, `issue` | active |
| `consumed` | `fulfilled`, `completed` | active — the date has been used |
| `released` | `cancelled`, `refunded` | inactive; the slot is free again |

Only `released` deactivates the block, and both states that release are
terminal. That is the property worth stating on its own: **every way an order
can end without being delivered frees the date it was holding.** The red team
found no phase that said where that happened, and a slot held by a cancelled
order is a date the vendor can never sell again.

## Jobs

Enqueued on entering, with the anchor each offset is measured from:

| Job | Enqueued on entering | Due |
|---|---|---|
| `expire_unpaid` | `pending_payment` | now + 30 minutes |
| `cooling_window_transfer` | `confirmed`, from `pending_payment` only | deposit capture + 48 hours |
| `charge_balance` | `confirmed`, from `pending_payment` only | event − 14 calendar days |
| `balance_grace_expiry` | `action_required` | now + 72 hours |
| `auto_complete_order` | `fulfilled` | event end + 72 hours |

`charge_balance` is enqueued only when the order **has** a balance. A
short-notice or small booking is paid in full at checkout, and scheduling a
balance charge for one is not merely redundant: its due date is `event − 14
days`, which for a short-notice booking is already in the past, so the job is
immediately due and fails every time the runner picks it up.

`cooling_window_transfer` and `charge_balance` are enqueued only on the first
entry into `confirmed` — the one from `pending_payment`. Coming back from
`balance_due` or `action_required` is the same booking continuing, and
re-enqueueing there would schedule a second balance charge for an order that
has just paid one. The jobs table's unique `(type, dedupe_key)` would refuse
the duplicate, but relying on a constraint to absorb a mistake the caller keeps
making is not the same as not making it.

Entering a terminal state cancels whatever is still queued for the order.

**Leaving `pending_payment` cancels `expire_unpaid`**, whichever state it leaves
for. That is not covered by the rule above — `pending_payment → confirmed` is
not an ending — and a job whose entire purpose is "cancel this if nobody has
paid" must not still be due against an order somebody has just paid for. The
handler checks the state as well; this is what stops it having to be the only
thing that does.

`expire_unpaid` is a seventh job type this file needs and that the enum shipped
without: the soft hold has to be released by something, and no other job does
it. It is added to `job_type` rather than worked around, because the
alternative is a capacity block that an abandoned cart holds for ever.

## Payment links

A link emailed to rescue a declined balance is payable only while the order is
waiting for one. **Leaving `action_required` retires it**, however it leaves,
and so does entering any terminal state.

That is the rule, not a detail of the balance path, and it closes two ways a
live link outlived its purpose. A balance that succeeded on a later attempt
moved the order back to `confirmed` and left the link payable for the rest of
its seventy-two hours — the customer could pay the whole balance a second time.
And an administrator cancelling an order that was still waiting left a link that
charges a booking nobody has any more; the webhook for that payment would then
find a `cancelled → confirmed` move the lifecycle refuses, and the provider
would retry that failure for days.

A link the customer used is **consumed**; one retired because the balance was
taken another way, or because the booking ended, is **expired**. Writing
"consumed" on a link nobody opened would be a claim about the customer.

## Event end

Events carry a date, an optional start time and a timezone; none of them carry
an end. `event_end` is therefore **local midnight at the end of the event's
day**, in the event's own timezone — the last instant that day could still be
in progress. Auto-complete at `event_end + 72h` then lands three days after the
event finished, whatever time of day it started and whichever side of a
daylight-saving boundary it falls on.
