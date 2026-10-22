const pool = require('../../config/database');
const { campusPayload, routeFor } = require('./campus.service');

exports.getCampus = (_req, res) => res.json(campusPayload());
exports.getLocations = async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM campus_locations ORDER BY building_name, floor_name, room_name');
  res.json(rows);
};
exports.getRoute = async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to campus location IDs are required.' });
  const { rows } = await pool.query('SELECT * FROM campus_locations WHERE id = ANY($1)', [[from, to]]);
  const byId = Object.fromEntries(rows.map(location => [location.id, location]));
  if (!byId[from] || !byId[to]) return res.status(404).json({ error: 'Campus location not found.' });
  const route = routeFor(byId[from], byId[to]);
  if (!route) return res.status(422).json({ error: 'No walking route is available.' });
  res.json({ ...route, from, to, travelMode: req.query.mode || 'WALK' });
};

