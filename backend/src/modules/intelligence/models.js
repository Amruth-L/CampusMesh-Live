const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
function forecastDemand(daily) {
  const values = daily.slice(-28).map((n) => Math.max(0, Number(n) || 0));
  const recent = sum(values.slice(-7)),
    previous = sum(values.slice(-14, -7)),
    total = sum(values);
  const enough = values.length === 28 && total >= 10 && values.filter((n) => n > 0).length >= 5;
  const expected = recent * 0.6 + previous * 0.3 + sum(values.slice(0, 14)) * 0.05;
  const spread = 1.96 * Math.sqrt(expected + 1);
  return {
    method: 'recency_weighted_weekly',
    observations: total,
    recentWeek: recent,
    previousWeek: previous,
    trendPercent: previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null,
    nextWeek: enough ? Math.round(expected * 10) / 10 : null,
    range: enough ? [Math.max(0, Math.floor(expected - spread)), Math.ceil(expected + spread)] : null,
    confidence: enough ? (total >= 50 ? 'moderate' : 'low') : 'insufficient',
    note: enough
      ? 'Planning estimate from 28 days of paid rentals; range is approximate.'
      : 'At least 10 paid rentals across 5 days are needed. Demo activity is excluded.',
  };
}
function trustEstimate(completed, onTime) {
  const n = Math.max(0, Number(completed) || 0),
    ok = clamp(Number(onTime) || 0, 0, n);
  if (n < 5)
    return {
      method: 'smoothed_return_history',
      completed: n,
      onTime: ok,
      estimate: null,
      range: null,
      confidence: 'insufficient',
      label: 'Building history',
      note: 'No negative rating for a new account. Five completed non-demo rentals are needed.',
    };
  const p = ok / n,
    z = 1.96,
    den = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / den,
    margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return {
    method: 'smoothed_return_history',
    completed: n,
    onTime: ok,
    estimate: Math.round(((ok + 1) / (n + 2)) * 100),
    range: [Math.round((center - margin) * 100), Math.round((center + margin) * 100)],
    confidence: n >= 30 ? 'moderate' : 'low',
    label: 'Return reliability',
    note: 'Estimate from completed returns only, not a guarantee or a general judgement of the person. Never automatically blocks a rental.',
  };
}
const baseline = (m) => Math.max(2, m / 78 + 4);
function fitLine(rows) {
  const n = rows.length,
    mx = sum(rows.map((r) => r.meters)) / n,
    my = sum(rows.map((r) => r.minutes)) / n;
  const denominator = sum(rows.map((r) => (r.meters - mx) ** 2));
  if (denominator < 1) return null;
  const slope = sum(rows.map((r) => (r.meters - mx) * (r.minutes - my))) / denominator,
    intercept = my - slope * mx;
  return slope > 0 && slope < 0.2 && intercept >= 0 && intercept < 30 ? { slope, intercept } : null;
}
function trainEta(samples) {
  const rows = samples.filter(
    (r) =>
      Number.isFinite(r.meters) &&
      Number.isFinite(r.minutes) &&
      r.meters >= 25 &&
      r.meters <= 5000 &&
      r.minutes >= 1 &&
      r.minutes <= 120,
  );
  const fallback = { method: 'route_baseline', sampleCount: rows.length, mae: null, model: null };
  if (rows.length < 20) return fallback;
  const split = Math.floor(rows.length * 0.8),
    train = rows.slice(0, split),
    validation = rows.slice(split),
    line = fitLine(train);
  if (!line) return fallback;
  const mae =
    sum(validation.map((r) => Math.abs(r.minutes - (line.intercept + line.slope * r.meters)))) /
    validation.length;
  const baselineMae =
    sum(validation.map((r) => Math.abs(r.minutes - baseline(r.meters)))) / validation.length;
  if (mae >= baselineMae)
    return {
      ...fallback,
      validationMae: Math.round(mae * 10) / 10,
      baselineMae: Math.round(baselineMae * 10) / 10,
    };
  const model = fitLine(rows);
  if (!model) return fallback;
  return {
    method: 'validated_linear_regression',
    sampleCount: rows.length,
    mae: Math.round(mae * 10) / 10,
    baselineMae: Math.round(baselineMae * 10) / 10,
    model,
    minMeters: Math.min(...rows.map((r) => r.meters)),
    maxMeters: Math.max(...rows.map((r) => r.meters)),
  };
}
function predictEta(meters, trained = { method: 'route_baseline', sampleCount: 0 }) {
  if (!Number.isFinite(meters) || meters < 0) return null;
  const learned = trained.model && meters >= trained.minMeters && meters <= trained.maxMeters;
  const minutes = clamp(
    learned ? trained.model.intercept + trained.model.slope * meters : baseline(meters),
    2,
    120,
  );
  const uncertainty = learned ? Math.max(2, trained.mae * 2) : Math.max(3, minutes * 0.35);
  return {
    minutes: Math.ceil(minutes),
    lower: Math.max(1, Math.floor(minutes - uncertainty)),
    upper: Math.ceil(minutes + uncertainty),
    method: learned ? 'validated_linear_regression' : 'route_baseline',
    sampleCount: trained.sampleCount || 0,
    validationMae: learned ? trained.mae : null,
    scope: 'pickup_to_handover',
  };
}
module.exports = { forecastDemand, trustEstimate, trainEta, predictEta };
