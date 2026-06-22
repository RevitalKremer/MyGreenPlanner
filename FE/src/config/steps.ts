// Single source of truth for the wizard flow.
//
// The wizard is grouped into named PHASES, not a fixed step count. The number
// of steps is open-ended: future phases (electrical, B2C subcontractors) are
// appended here and the step bar / navigation derive from this list. Do NOT
// hardcode the last step index or total step count anywhere else — use
// LAST_STEP_ID / isLastStep() / the `isFinal` marker instead.
//
// `nameKey` is an i18n key resolved with t(). `phase` groups steps for the
// step bar. `isFinal` marks the closing "Summary / finish" step (end of
// project) regardless of how many steps precede it.

export type Phase = 'sharedInput' | 'construction' | 'electrical' | 'closing'

export interface StepDef {
  id: number
  nameKey: string
  phase: Phase
  /** Semantic "end of project" marker — never a numeric index. */
  isFinal?: boolean
}

// Steps 1–2 are shared input (mandatory for all paths); 3–5 are Construction
// Planning. Electrical (6–9) + the closing Final step are appended in a later
// phase of the Tier 2 work.
export const STEPS: StepDef[] = [
  { id: 1, nameKey: 'step.1.name', phase: 'sharedInput' },
  { id: 2, nameKey: 'step.2.name', phase: 'sharedInput' },
  { id: 3, nameKey: 'step.3.name', phase: 'construction' },
  { id: 4, nameKey: 'step.4.name', phase: 'construction' },
  { id: 5, nameKey: 'step.5.name', phase: 'construction' },
  { id: 6, nameKey: 'step.6.name', phase: 'electrical' },
  { id: 7, nameKey: 'step.7.name', phase: 'electrical' },
  { id: 8, nameKey: 'step.8.name', phase: 'electrical' },
  { id: 9, nameKey: 'step.9.name', phase: 'electrical' },
  { id: 10, nameKey: 'step.final.name', phase: 'closing', isFinal: true },
]

/** Highest step id currently registered. Replaces the old hardcoded TOTAL_STEPS. */
export const LAST_STEP_ID = STEPS[STEPS.length - 1].id

export function getStep(id: number): StepDef | undefined {
  return STEPS.find(s => s.id === id)
}

/** The last step in the flow triggers the "Finish" action (today step 5; the
 *  Final summary step once it is appended). */
export function isLastStep(id: number): boolean {
  return id === LAST_STEP_ID
}

/** Semantic end-of-project marker. Falls back to the last step while no step
 *  is explicitly flagged `isFinal` (i.e. before the Final summary exists). */
export function isFinalStep(id: number): boolean {
  const flagged = STEPS.find(s => s.isFinal)
  return flagged ? flagged.id === id : isLastStep(id)
}

// ── High-level phase groups (for the compact step bar) ──────────────────────
// The steps roll up into user-facing groups so the bar isn't a long row of
// numbers. The closing "Summary" step is its own group (it's the end of the
// whole project, not part of electrical).
export type StepGroup = 'basic' | 'construction' | 'electricity' | 'summary'

const PHASE_TO_GROUP: Record<Phase, StepGroup> = {
  sharedInput: 'basic',
  construction: 'construction',
  electrical: 'electricity',
  closing: 'summary',
}

export interface StepGroupDef {
  key: StepGroup
  nameKey: string
  steps: StepDef[]
}

export const STEP_GROUPS: StepGroupDef[] = (['basic', 'construction', 'electricity', 'summary'] as StepGroup[]).map(key => ({
  key,
  nameKey: `phase.${key}`,
  steps: STEPS.filter(s => PHASE_TO_GROUP[s.phase] === key),
}))

/** Which group a step belongs to. */
export function groupOf(stepId: number): StepGroup | undefined {
  const s = getStep(stepId)
  return s ? PHASE_TO_GROUP[s.phase] : undefined
}
