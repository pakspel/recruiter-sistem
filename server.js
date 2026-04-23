const express = require('express');
const path = require('path');
const storage = require('./storage');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple API key auth middleware for write endpoints
function requireAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key && key === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// GET /api/leaderboard
app.get('/api/leaderboard', (req, res) => {
  const recruiters = storage.getAll();
  const config = storage.getConfig();

  const list = Object.values(recruiters)
    .filter(r => r.status !== 'kicked' || req.query.all === '1')
    .map(r => ({
      ...r,
      rank: storage.getRank(r.points, config),
      history: undefined // Don't send history in leaderboard
    }))
    .sort((a, b) => b.points - a.points);

  res.json({ recruiters: list, config, lastBurn: storage.load().lastWeeklyBurn });
});

// GET /api/recruiter/:id
app.get('/api/recruiter/:id', (req, res) => {
  const r = storage.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json(storage.getConfig());
});

// POST /api/config (admin)
app.post('/api/config', requireAuth, (req, res) => {
  const cfg = storage.setConfig(req.body);
  res.json(cfg);
});

// POST /api/points (admin)
app.post('/api/points', requireAuth, (req, res) => {
  const { userId, amount, reason } = req.body;
  if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing userId or amount' });
  const r = storage.addPoints(userId, amount, reason || 'Ручное начисление', 'api');
  if (!r) return res.status(404).json({ error: 'Recruiter not found' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// POST /api/register (admin)
app.post('/api/register', requireAuth, (req, res) => {
  const { userId, username, displayName } = req.body;
  if (!userId || !username) return res.status(400).json({ error: 'Missing userId or username' });
  const r = storage.register(userId, username, displayName);
  res.json(r);
});

// DELETE /api/recruiter/:id (admin)
app.delete('/api/recruiter/:id', requireAuth, (req, res) => {
  storage.remove(req.params.id);
  res.json({ ok: true });
});

// POST /api/weekly-burn (admin/manual)
app.post('/api/weekly-burn', requireAuth, (req, res) => {
  const results = storage.doWeeklyBurn();
  res.json(results);
});

function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });
}

module.exports = { startServer };
