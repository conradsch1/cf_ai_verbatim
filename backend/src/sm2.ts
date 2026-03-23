/**
 * SM-2 spaced repetition (PROJECT_SPEC 3.D).
 * Quality scores: Fail=1, Hard=3, Medium=4, Easy=5.
 */

export type QualityScore = 1 | 3 | 4 | 5;

export interface SM2State {
  /** Easiness factor; spec: must not stay below 1.3 after updates. */
  easinessFactor: number;
  /** Current scheduled interval in days. */
  intervalDays: number;
  /** Successful repetitions in the current streak. */
  repetitions: number;
}

export const DEFAULT_SM2_STATE: SM2State = {
  easinessFactor: 2.5,
  intervalDays: 1,
  repetitions: 0,
};

/**
 * EF formula from spec: EF = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), then clamp EF >= 1.3.
 * Interval: if q < 3, reset; if q >= 3, classic SM-2 progression (1 → 6 → round(prev * EF)).
 */
export function calculateNextReview(
  state: SM2State,
  q: QualityScore
): SM2State {
  let ef =
    state.easinessFactor +
    (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.max(ef, 1.3);

  if (q < 3) {
    return {
      easinessFactor: ef,
      intervalDays: 1,
      repetitions: 0,
    };
  }

  const nextRepetitions = state.repetitions + 1;
  let intervalDays: number;

  if (nextRepetitions === 1) {
    intervalDays = 1;
  } else if (nextRepetitions === 2) {
    intervalDays = 6;
  } else {
    intervalDays = Math.max(1, Math.round(state.intervalDays * ef));
  }

  return {
    easinessFactor: ef,
    intervalDays,
    repetitions: nextRepetitions,
  };
}
