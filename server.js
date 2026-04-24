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

function requireAdmin(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  const session = storage.validateToken(token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  req.session = session;
  next();
}

function requireRecruiter(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  const session = storage.validateToken(token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (!['admin', 'recruiter'].includes(session.role)) return res.status(403).json({ error: 'Нет доступа' });
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

// Legacy: approve via API key
app.post('/api/auth/approve', requireApiKey, (req, res) => {
  const { login } = req.body;
  const ok = storage.approveUser(login);
  res.json({ ok });
});

// Legacy: pending via API key
app.get('/api/auth/pending', requireApiKey, (req, res) => {
  res.json(storage.getPendingUsers());
});

// ── Admin: Approvals panel (via token) ────────────────────

app.get('/api/admin/pending', requireAdmin, (req, res) => {
  res.json(storage.getPendingUsers());
});

app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { login, role } = req.body;
  if (!login) return res.status(400).json({ error: 'Укажи логин' });
  const ok = storage.approveUserWithRole(login, role || 'recruiter');
  res.json({ ok });
});

app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ error: 'Укажи логин' });
  const ok = storage.rejectUser(login);
  res.json({ ok });
});

app.get('/api/admin/recruiters', requireAdmin, (req, res) => {
  res.json(storage.getRecruiters());
});

// ── Admin: Tasks management ───────────────────────────────

app.get('/api/admin/tasks', requireAdmin, (req, res) => {
  res.json(storage.getAllTasks());
});

app.post('/api/admin/tasks', requireAdmin, (req, res) => {
  const { title, description, assignedTo } = req.body;
  if (!title) return res.status(400).json({ error: 'Укажи название задания' });
  const task = storage.createTask(title, description, assignedTo || 'all');
  res.json(task);
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  const ok = storage.deleteTask(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Задание не найдено' });
  res.json({ ok });
});

// ── Recruiter: Tasks ──────────────────────────────────────

app.get('/api/tasks', requireRecruiter, (req, res) => {
  const tasks = storage.getTasksForUser(req.session.login);
  res.json(tasks);
});

app.post('/api/tasks/:id/complete', requireRecruiter, (req, res) => {
  const task = storage.completeTask(req.params.id, req.session.login);
  if (!task) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(task);
});

app.post('/api/tasks/:id/uncomplete', requireRecruiter, (req, res) => {
  const task = storage.uncompleteTask(req.params.id, req.session.login);
  if (!task) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(task);
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

// ── Points editing ────────────────────────────────────────

app.post('/api/points', (req, res) => {
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

// ── Config / Admin via API key ────────────────────────────

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
