export interface Sm2State {
  easeFactor: number;
  interval: number;
  repetitions: number;
  dueAt: number;
  updatedAt: number;
}

export function createInitialSm2State(now = Date.now()): Sm2State {
  return {
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    dueAt: now,
    updatedAt: now,
  };
}

export function reviewSm2(current: Sm2State, quality: number, now = Date.now()): Sm2State {
  const normalizedQuality = Math.max(0, Math.min(5, Math.round(quality)));
  let repetitions = current.repetitions;
  let interval = current.interval;
  let easeFactor = current.easeFactor;

  if (normalizedQuality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    easeFactor = Math.max(
      1.3,
      easeFactor + (0.1 - (5 - normalizedQuality) * (0.08 + (5 - normalizedQuality) * 0.02)),
    );
  }

  return {
    easeFactor,
    interval,
    repetitions,
    dueAt: now + interval * 24 * 60 * 60 * 1000,
    updatedAt: now,
  };
}
