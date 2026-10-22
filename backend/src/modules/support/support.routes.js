const router = require('express').Router();
const auth = require('../../middleware/authMiddleware');
const pool = require('../../config/database');
const support = require('./support.service');
router.use(auth);
router.get('/', async (req, res) => {
  const [turns, tickets] = await Promise.all([
    pool.query(
      'SELECT id,question,answer,mode,sources,created_at FROM support_turns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id],
    ),
    pool.query(
      'SELECT id,subject,status,created_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id],
    ),
  ]);
  res.json({
    turns: turns.rows.reverse(),
    tickets: tickets.rows,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  });
});
router.post('/chat', async (req, res) => {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int n FROM support_turns WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute'",
    [req.user.id],
  );
  if (rows[0].n >= 10)
    return res.status(429).json({ error: 'Please wait a minute before sending more questions.' });
  res.json(await support.answer(req.user.id, req.body.message));
});
router.post('/tickets', async (req, res) => {
  const { subject, details } = req.body;
  if (
    typeof subject !== 'string' ||
    !subject.trim() ||
    subject.length > 150 ||
    typeof details !== 'string' ||
    !details.trim() ||
    details.length > 3000
  )
    return res
      .status(400)
      .json({ error: 'Add a subject (150 characters maximum) and details (3000 maximum).' });
  const recent = await pool.query(
    "SELECT COUNT(*)::int n FROM support_tickets WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 day'",
    [req.user.id],
  );
  if (recent.rows[0].n >= 5)
    return res.status(429).json({ error: 'You already have five support requests today.' });
  const { rows } = await pool.query(
    'INSERT INTO support_tickets(user_id,subject,details) VALUES($1,$2,$3) RETURNING id,status,created_at',
    [req.user.id, support.redact(subject.trim()), support.redact(details.trim(), 3000)],
  );
  res.status(201).json(rows[0]);
});
module.exports = router;
