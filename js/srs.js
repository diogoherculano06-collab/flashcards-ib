// Simplified SM-2 scheduler.
// Grades: 0 = Errei, 1 = Difícil, 2 = Bom, 3 = Fácil.
import { startOfDay, addDays, endOfDay, parseTs } from './util.js';

export const GRADE_LABELS = ['Errei', 'Difícil', 'Bom', 'Fácil'];
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;

export function newProgress(cardId) {
  return { card_id: cardId, ease: 2.5, interval_days: 0, due_at: null, reps: 0, lapses: 0, last_grade: null, updated_at: null };
}

const round1 = (x) => Math.round(x * 10) / 10;

/** Returns the next interval (days) and ease for a grade, without side effects. */
export function nextState(p, grade) {
  let { ease, interval_days: iv, reps, lapses } = p;
  if (grade === 0) {
    return { ease: Math.max(MIN_EASE, round1(ease - 0.2)), interval_days: 0, reps: 0, lapses: lapses + 1 };
  }
  if (grade === 1) {
    iv = Math.max(1, iv * 1.2);
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === 2) {
    iv = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, iv) * ease;
  } else {
    iv = Math.max(1, iv) * ease * 1.3;
    ease = ease + 0.15;
  }
  return { ease: Math.round(ease * 100) / 100, interval_days: round1(Math.min(MAX_INTERVAL, iv)), reps: reps + 1, lapses };
}

export function schedule(p, grade, now = new Date()) {
  const s = nextState(p, grade);
  const due = s.interval_days === 0 ? now : addDays(startOfDay(now), Math.max(1, Math.round(s.interval_days)));
  return { ...p, ...s, due_at: due.toISOString(), last_grade: grade, updated_at: now.toISOString() };
}

/** Short label for the interval a grade would produce, e.g. "3d". */
export function previewLabel(p, grade) {
  const s = nextState(p, grade);
  if (s.interval_days === 0) return 'agora';
  const d = Math.max(1, Math.round(s.interval_days));
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}m`;
  return `${(d / 365).toFixed(1)}a`;
}

export function isDue(p, now = new Date()) {
  return !!(p && p.due_at && parseTs(p.due_at) <= endOfDay(now));
}
