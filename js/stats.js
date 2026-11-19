// Study statistics computed from local data (works offline).
import { parseTs, dayKey, startOfDay, addDays } from './util.js';
import { isDue } from './srs.js';

export function streak(reviews, today = new Date()) {
  const days = new Set(reviews.map((r) => dayKey(parseTs(r.reviewed_at))));
  let d = startOfDay(today);
  if (!days.has(dayKey(d))) d = addDays(d, -1); // today not studied yet: streak still alive
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

function accuracy(list) {
  if (!list.length) return null;
  return list.filter((r) => r.grade >= 2).length / list.length;
}

/** Per-deck mastery (% of cards with interval >= 21 days) and 7/30-day accuracy. */
export function deckStats(cards, progress, reviews, deckOrder, now = new Date()) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const t7 = now.getTime() - 7 * 86400000;
  const t30 = now.getTime() - 30 * 86400000;
  const rows = deckOrder.map((deck) => {
    const deckCards = cards.filter((c) => c.deck === deck);
    const mastered = deckCards.filter((c) => (progress.get(c.id)?.interval_days || 0) >= 21).length;
    const deckReviews = reviews.filter((r) => byId.get(r.card_id)?.deck === deck);
    const r7 = deckReviews.filter((r) => parseTs(r.reviewed_at).getTime() >= t7);
    const r30 = deckReviews.filter((r) => parseTs(r.reviewed_at).getTime() >= t30);
    return {
      deck, total: deckCards.length, mastered,
      mastery: deckCards.length ? mastered / deckCards.length : null,
      acc7: accuracy(r7), n7: r7.length, acc30: accuracy(r30), n30: r30.length
    };
  });
  return rows.filter((r) => r.total > 0);
}

/** Weakest subtopics over the last 30 days (min. 3 reviews), lowest accuracy first. */
export function weakest(cards, reviews, now = new Date(), limit = 5) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const t30 = now.getTime() - 30 * 86400000;
  const groups = new Map();
  for (const r of reviews) {
    const c = byId.get(r.card_id);
    if (!c || parseTs(r.reviewed_at).getTime() < t30) continue;
    const k = `${c.deck} › ${c.subtopic}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, n: list.length, acc: accuracy(list) }))
    .filter((g) => g.n >= 3)
    .sort((a, b) => a.acc - b.acc || b.n - a.n)
    .slice(0, limit);
}

export function dueCount(cards, progress, now = new Date()) {
  return cards.filter((c) => isDue(progress.get(c.id), now)).length;
}
