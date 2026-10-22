const { issueCredential, verifyCredential } = require('./handover.service');
const evidence = require('./handover-evidence');

exports.uploadPhoto = async (req, res) => {
  res.status(201).json(await evidence.upload(req.params.id, req.user.id, String(req.body.stage || '').toUpperCase(), req.body.image));
};
exports.listPhotos = async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await evidence.list(req.params.id, req.user.id));
};

exports.getHandover = async (req, res) => {
  const result = await issueCredential(req.params.id, String(req.params.stage).toUpperCase(), req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
};

exports.verifyHandover = async (req, res) => {
  const { stage, method, value } = req.body;
  if (!stage || !['QR', 'OTP'].includes(String(method).toUpperCase()) || value == null) return res.status(400).json({ error: 'stage, method (QR or OTP), and value are required.' });
  try { res.json(await verifyCredential(req.params.id, req.user.id, { stage: String(stage).toUpperCase(), method: String(method).toUpperCase(), value })); }
  catch (error) { res.status(error.status || 500).json({ error: error.message || 'Handover verification failed.' }); }
};

