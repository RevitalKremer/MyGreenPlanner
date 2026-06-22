# Tier 2 — Electrical Design (Planning Doc)

> Status: brainstorm / spec. Not yet implemented.
> Context: product is evolving B2B → B2B+ (this doc) → B2C marketplace.

## Product context

Three tiers:

1. **B2B (today):** construction / mounting planning for EPCs (Steps 1–5).
2. **B2B+ (THIS DOC):** full PV system design — adds inverter selection, string plan, electrical BOM (Steps 6–10).
3. **B2C (future):** DIY end users + marketplace (pick EPC + constructor + electrician, pay for the package). Marketplace model = **we take a cut of the package**.

Marketplace services to be offered: **EPC**, **constructor** (construction plan approval), **electrician** (electrical plan approval).

The string plan + inverter sizing is the costing engine that makes a real BOM and price possible — it's what later unlocks B2C "pay for the package".

## Architecture decision: linear append, decoupled module

- Electrical is appended as **Steps 6–10** (NOT a branching/parallel wizard).
- Rationale: construction and electrical both depend only on Step 1 + Step 2 and are independent of each other. A branching wizard is the "correct" end-state UX but forces a risky stepper refactor now.
- **Must-do today:** keep electrical as a **self-contained module with its own state slice**, reading Step 1+2 as input and writing its own electrical output. This preserves a low-cost migration path to a branching wizard later.
- Confirmed: **no electrical without construction.** Steps 1 + 2 are mandatory for both paths.

## Full flow

The wizard is grouped into **named phases**, not a fixed step count. The number of steps is **open-ended** — future B2C phases (e.g. subcontractors) will be appended. The final step is named **"Final"** (not "the Final step") so it always represents "end of project" regardless of how many steps precede it.

| Step | Name | Phase | Notes |
|---|---|---|---|
| 1 | Roof Allocation | (shared input) | existing |
| 2 | Panel Placement | (shared input) | existing |
| 3 | Construction Planning | **Construction Planning** | existing |
| 4 | Plan Approval (constructor) | **Construction Planning** | existing |
| 5 | PDF Report | **Construction Planning** | existing — **kept as-is**, acts as exit point |
| 6 | Electrical Settings + Inverter Selection | **Electrical Planning** | params + catalog pick / auto-sizing |
| 7 | String Plan | **Electrical Planning** | auto-generate from settings → manual tweak → validate vs MPPT limits |
| 8 | Plan Approval (electrician) | **Electrical Planning** | external/async approval |
| 9 | Electrical BOM | **Electrical Planning** | cables, protection, grounding — needs string layout |
| Final | Summary | (closing) | all docs + project content, finish |

**Phase grouping (for the step bar):**
- Steps 1–2: shared input (roof + panel placement, mandatory for all paths).
- Steps 3–5: **Construction Planning**.
- Steps 6–9: **Electrical Planning**.
- **Final**: Summary / finish.

> Design note: do **not** hardcode the last step index or total step count anywhere. Treat "Final" as a semantic marker (e.g. `isFinal` flag or a phase enum), so additional phases/steps can be appended for B2C without breaking navigation, the step bar, or skip logic.

## The three user paths

### Path A — construction only (5 → Final skip)
- User wants construction planning only, no electrical.
- **Charge: 100 credits, REFUNDABLE.**
- the Final step summary shows **construction part only**.

### Path B — partial electrical (6 → Final skip)
- User continues to Step 6, adds details + selects inverters.
- On **Next (6 → 7)** → prompted with **200 credits, NON-REFUNDABLE** message.
  - **Cancel → stay on Step 6.** (No auto-jump.)
  - User can then actively press "Skip to last step" to go to the Final step.
- the Final step summary shows **construction + partial inverter/settings data (no string plan)**.

### Path C — full (no skip)
- User completes 6 → 7 → 8 → 9.
- the Final step summary shows **construction + full electrical**.

### Credit model summary
| Event | When | Credits | Refundable |
|---|---|---|---|
| Finish construction | 5 → Final skip | 100 | Yes |
| Unlock String Plan | Next 6 → 7 (explicit confirm) | 200 | No |

Refundable vs non-refundable lines up with reversible work (a report) vs committed work (engineering compute + electrician handoff).

## UI changes

- **Step bar** must reflect the active path / what's reachable (skip options visible).
- **Next** button → moves to next step (normal behavior).
- **New "Skip to last step" button** added on **Steps 5 and 6** (only when skip is enabled). Jumps to the Final step with whatever partial data exists.
- The 200-credit charge must fire on an **explicit confirm dialog** (reuse existing `confirmDialog` in `App.tsx`), never on accidental navigation — non-refundable means disputes otherwise.

## Step 6 — Electrical Settings + Inverter Selection (detail TBD)

- Electrical settings step captures the params that **drive string auto-generation** (param schema to be defined later).
- Inverter selection: pick from product catalog; auto-suggest sizing from total panel kWp (DC/AC ratio ~1.1–1.3); surface MPPT count + per-MPPT voltage/current limits.
- Mirrors how Step 3 works today: settings → auto-layout → manual override.

## Step 7 — String Plan (detail TBD)

- **Auto-generate strings from user-input params** (Step 6 settings), then allow manual tweak.
- Validate against inverter limits: string voltage (Voc × panels × temp factor) within MPPT window; string current within input limit.
- Visualize strings as colored panel groupings on the existing layout canvas.
- This is the core engineering logic and the riskiest part.

## Open architecture notes

1. **Async/external approvals (Steps 4 & 8):** the approving pro is NOT the logged-in user. Needs review links, status tracking, notifications. Touches both tracks.
2. **Partial BOM:** Path B (skip string plan) means Step 9 BOM is incomplete — a full BOM needs the string layout (cable runs, combiner sizing). Decide what the "lite"/partial output contains.
3. **Backend:** add `inverter` and `electrical_component` product types to the existing `products` catalog; persist string assignments + electrical settings per project.
4. **Reuse, don't duplicate:** existing credits/charge concept ("Get Quotation", "charged" tooltip) and `confirmDialog` in `App.tsx`; existing layout canvas for string visualization.

## Current codebase facts (verified)

- FE steps: `Step1RoofAllocation` … `Step5PdfReport` (5-step linear flow in `App.tsx`).
- **No** inverter / string / MPPT / electrical logic exists anywhere in FE or BE yet.
- BE already has a `products` router and `company` model — extend these.
