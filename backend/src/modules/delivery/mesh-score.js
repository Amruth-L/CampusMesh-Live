const pool = require('../../config/database');

// A transparent operational score, not a prediction of a student's character.
// Declines, expired offers and customer cancellations never lower this score.
function evaluateMeshScore({ email_verified, completed = 0, failed = 0 }) {
  completed = Number(completed);
  failed = Number(failed);
  const total = completed + failed;
  const score = total ? Math.round(100 * (completed + 2) / (total + 4)) : null;
  const provisional = total < 5;
  const eligible = Boolean(email_verified) && (provisional || score >= 50);
  const reason = !email_verified ? 'Verify your college email before delivering.'
    : !eligible ? 'Your delivery completion score is below 50. Contact Support to review failed deliveries before accepting new work.'
      : provisional ? 'New delivery partner: eligible for one delivery at a time. Your score becomes established after 5 finished tasks.'
        : 'Eligible for delivery. Go online to receive requests and choose which to accept.';
  return { score, completed, failed, total, provisional, eligible, reason,
    formula: '100 × (completed + 2) ÷ (completed + failed + 4)', minimumHistory: 5, minimumScore: 50 };
}

async function getMeshScore(userId, db = pool) {
  const { rows } = await db.query(`SELECT u.email_verified,
    COUNT(d.id) FILTER (WHERE d.status IN ('COMPLETED','DELIVERED'))::int completed,
    COUNT(d.id) FILTER (WHERE d.status='FAILED')::int failed
    FROM users u LEFT JOIN delivery_requests d ON d.courier_id=u.id
      AND d.status IN ('COMPLETED','DELIVERED','FAILED')
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.id=d.listing_id AND l.demo_slug IS NOT NULL)
    WHERE u.id=$1 GROUP BY u.id`, [userId]);
  if (!rows[0]) throw Object.assign(new Error('Courier account not found.'), { status: 404 });
  return evaluateMeshScore(rows[0]);
}

async function requireEligibleCourier(userId, db = pool) {
  const mesh = await getMeshScore(userId, db);
  if (!mesh.eligible) throw Object.assign(new Error(mesh.reason), { status: 403 });
  return mesh;
}

module.exports = { evaluateMeshScore, getMeshScore, requireEligibleCourier };
