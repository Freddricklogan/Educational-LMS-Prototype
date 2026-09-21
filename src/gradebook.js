/** Weighted gradebook: categories with weights, optional drop-lowest, late penalties, letter grades. Every rule is explicit and tested. */

export const DEFAULT_SCALE = [['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]];

export function validateScheme(scheme) {
  const p = [];
  if (!Array.isArray(scheme.categories) || scheme.categories.length === 0) return ['scheme needs categories'];
  const total = scheme.categories.reduce((s, c) => s + (c.weight ?? 0), 0);
  if (Math.abs(total - 1) > 1e-9) p.push(`category weights sum to ${total.toFixed(3)}, not 1`);
  for (const c of scheme.categories) {
    if (!c.id || !c.label) p.push('every category needs id and label');
    if (!(c.weight >= 0 && c.weight <= 1)) p.push(`category "${c.id}": weight must be 0–1`);
    if (c.dropLowest !== undefined && !(Number.isInteger(c.dropLowest) && c.dropLowest >= 0)) p.push(`category "${c.id}": dropLowest must be a non-negative integer`);
  }
  if (scheme.latePenaltyPerDay !== undefined && !(scheme.latePenaltyPerDay >= 0 && scheme.latePenaltyPerDay <= 1)) p.push('latePenaltyPerDay must be 0–1');
  return p;
}

/** Days late, rounded up; 0 when on time or when either date is missing. */
export function daysLate(submittedAt, dueAt) {
  if (!submittedAt || !dueAt) return 0;
  const ms = Date.parse(submittedAt) - Date.parse(dueAt);
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

/** Applies the late rule to a fraction score: penalty per day, floored at zero, capped at maxLateDays (after which the score is zero). */
export function applyLate(fraction, late, scheme) {
  if (!late) return fraction;
  if (scheme.maxLateDays !== undefined && late > scheme.maxLateDays) return 0;
  return Math.max(0, fraction - late * (scheme.latePenaltyPerDay ?? 0));
}

/**
 * Computes the course grade. `entries` = [{ id, category, earned, points, submittedAt?, dueAt?, excused? }].
 * Missing (earned === null) counts as zero unless excused. Categories with no scored entries are omitted and
 * the remaining weights are renormalised, so a grade is defined from the first score.
 */
export function computeGrade(entries, scheme) {
  const cats = scheme.categories.map((c) => {
    const rows = entries.filter((e) => e.category === c.id && !e.excused).map((e) => {
      const late = daysLate(e.submittedAt, e.dueAt);
      const raw = e.earned === null || e.earned === undefined ? 0 : e.earned / e.points;
      return { ...e, late, fraction: applyLate(raw, late, scheme), missing: e.earned === null || e.earned === undefined };
    });
    const kept = [...rows].sort((a, b) => a.fraction - b.fraction).slice(Math.min(c.dropLowest ?? 0, Math.max(0, rows.length - 1)));
    const pts = kept.reduce((s, r) => s + r.points, 0);
    const earned = kept.reduce((s, r) => s + r.fraction * r.points, 0);
    return { id: c.id, label: c.label, weight: c.weight, rows, dropped: rows.length - kept.length, pct: pts ? (earned / pts) * 100 : null };
  });
  const scored = cats.filter((c) => c.pct !== null);
  const wsum = scored.reduce((s, c) => s + c.weight, 0);
  const pct = wsum ? scored.reduce((s, c) => s + c.pct * (c.weight / wsum), 0) : null;
  return { categories: cats, pct, letter: pct === null ? null : letterFor(pct, scheme.scale ?? DEFAULT_SCALE), renormalised: wsum < 1 - 1e-9 && wsum > 0 };
}

export function letterFor(pct, scale = DEFAULT_SCALE) {
  for (const [letter, min] of scale) if (pct >= min) return letter;
  return scale[scale.length - 1][0];
}

/** What average on the remaining points is needed to reach `targetPct` overall, given the scheme's weights. */
export function neededForTarget(entries, scheme, targetPct) {
  const perCat = scheme.categories.map((c) => {
    const rows = entries.filter((e) => e.category === c.id && !e.excused);
    const pts = rows.reduce((s, e) => s + e.points, 0);
    const donePts = rows.filter((e) => e.earned !== null && e.earned !== undefined).reduce((s, e) => s + e.points, 0);
    const earned = rows.filter((e) => e.earned !== null && e.earned !== undefined).reduce((s, e) => s + applyLate(e.earned / e.points, daysLate(e.submittedAt, e.dueAt), scheme) * e.points, 0);
    return { weight: c.weight, pts, donePts, earned };
  });
  const have = perCat.reduce((s, c) => s + (c.pts ? c.weight * (c.earned / c.pts) * 100 : 0), 0);
  const remainingWeight = perCat.reduce((s, c) => s + (c.pts ? c.weight * ((c.pts - c.donePts) / c.pts) : 0), 0);
  if (remainingWeight <= 1e-12) return { achievable: have >= targetPct, needed: null, remainingWeight: 0 };
  const needed = (targetPct - have) / remainingWeight;
  return { achievable: needed <= 100, needed: Math.max(0, needed), remainingWeight };
}

/** Parses a grades CSV: id,category,earned,points[,submittedAt,dueAt]. Bad rows are reported and dropped. */
export function parseGradesCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error('CSV is empty');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  for (const c of ['id', 'category', 'earned', 'points']) if (!head.includes(c)) throw new Error(`missing column: ${c}`);
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const entries = [];
  const warnings = [];
  lines.slice(1).forEach((l, n) => {
    const f = l.split(',').map((s) => s.trim());
    const points = Number(f[idx.points]);
    const earnedRaw = f[idx.earned];
    const earned = earnedRaw === '' ? null : Number(earnedRaw);
    if (!f[idx.id]) return warnings.push(`row ${n + 2}: missing id`);
    if (!(points > 0)) return warnings.push(`row ${n + 2}: points must be positive`);
    if (earned !== null && !(earned >= 0 && earned <= points)) return warnings.push(`row ${n + 2}: earned must be between 0 and points`);
    entries.push({ id: f[idx.id], category: f[idx.category], earned, points, submittedAt: f[idx.submittedat] || undefined, dueAt: f[idx.dueat] || undefined });
    return undefined;
  });
  return { entries, warnings };
}
