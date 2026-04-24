const express = require('express');
const path = require('path');
const storage = require('./storage');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────

function requireToken(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  const session = storage.validateToken(token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  req.session = session;
  next();
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key && key === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth endpoints ────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Укажи логин и пароль' });
  if (login.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const result = storage.registerUser(login, password);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Укажи логин и пароль' });
  const result = storage.loginUser(login, password);
  if (!result.ok) return res.status(result.pending ? 403 : 401).json(result);
  res.json(result);
});

app.get('/api/auth/me', requireToken, (req, res) => {
  res.json({ login: req.session.login, role: req.session.role });
});

app.post('/api/auth/change-password', requireToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const result = storage.changePassword(req.session.login, oldPassword, newPassword);
  res.json(result);
});

// Admin: approve user (via API key)
app.post('/api/auth/approve', requireApiKey, (req, res) => {
  const { login } = req.body;
  const ok = storage.approveUser(login);
  res.json({ ok });
});

// Admin: list pending users (via API key)
app.get('/api/auth/pending', requireApiKey, (req, res) => {
  res.json(storage.getPendingUsers());
});

// ── Leaderboard ───────────────────────────────────────────

app.get('/api/leaderboard', (req, res) => {
  const recruiters = storage.getAll();
  const config = storage.getConfig();

  const list = Object.values(recruiters)
    .filter(r => r.status !== 'kicked' || req.query.all === '1')
    .map(r => ({
      ...r,
      rank: storage.getRank(r.points, config),
      isCurator: storage.isCurator(r.points),
      history: undefined
    }))
    .sort((a, b) => b.points - a.points);

  res.json({ recruiters: list, config, lastBurn: storage.load().lastWeeklyBurn });
});

app.get('/api/recruiter/:id', (req, res) => {
  const r = storage.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// ── Points editing (requires token) ──────────────────────

app.post('/api/points', (req, res) => {
  // Accept either token auth OR api key auth
  const token = req.headers['x-token'];
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const session = token ? storage.validateToken(token) : null;
  const isApiKey = apiKey && apiKey === process.env.API_KEY;

  if (!session && !isApiKey) return res.status(401).json({ error: 'Не авторизован' });

  const { userId, amount, reason } = req.body;
  if (!userId || amount === undefined) return res.status(400).json({ error: 'Укажи userId и amount' });

  const actorId = session ? session.login : 'api';
  const r = storage.addPoints(userId, amount, reason || 'Ручное начисление', actorId);
  if (!r) return res.status(404).json({ error: 'Рекрут не найден' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// ── Admin endpoints ───────────────────────────────────────

app.get('/api/config', (req, res) => res.json(storage.getConfig()));

app.post('/api/config', requireApiKey, (req, res) => {
  const cfg = storage.setConfig(req.body);
  res.json(cfg);
});

app.post('/api/register', requireApiKey, (req, res) => {
  const { userId, username, displayName } = req.body;
  if (!userId || !username) return res.status(400).json({ error: 'Missing userId or username' });
  const r = storage.register(userId, username, displayName);
  res.json(r);
});

app.delete('/api/recruiter/:id', requireApiKey, (req, res) => {
  storage.remove(req.params.id);
  res.json({ ok: true });
});

app.post('/api/weekly-burn', requireApiKey, (req, res) => {
  const results = storage.doWeeklyBurn();
  res.json(results);
});

function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));
}

module.exports = { startServer };
