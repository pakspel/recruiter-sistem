const express    = require('express');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const storage    = require('./storage');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ─────────────────────────────────────────

/** Логин: 10 попыток за 15 минут с одного IP */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуй через 15 минут.' }
});

/** Регистрация: 5 аккаунтов за час с одного IP */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много регистраций с этого IP. Попробуй через час.' }
});

// ── Middleware ────────────────────────────────────────────

function requireToken(req, res, next) {
  const session = storage.validateToken(req.headers['x-token'] || req.query.token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  req.session = session; next();
}

function requireAdmin(req, res, next) {
  const session = storage.validateToken(req.headers['x-token'] || req.query.token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  req.session = session; next();
}

/** Доступ для кураторов (2000+ баллов) и администраторов */
function requireCuratorOrAdmin(req, res, next) {
  const session = storage.validateToken(req.headers['x-token'] || req.query.token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (session.role === 'admin') { req.session = session; return next(); }
  // Проверяем баллы рекрута
  const discordId = storage.getDiscordIdByLogin(session.login);
  if (discordId) {
    const rec = storage.get(discordId);
    if (rec && storage.isCurator(rec.points)) { req.session = session; return next(); }
  }
  return res.status(403).json({ error: 'Нет доступа — требуется роль куратора или администратора' });
}

function requireRecruiter(req, res, next) {
  const session = storage.validateToken(req.headers['x-token'] || req.query.token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (!['admin', 'recruiter'].includes(session.role)) return res.status(403).json({ error: 'Нет доступа' });
  req.session = session; next();
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key && key === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/** Only the superadmin (SUPER_ADMIN_LOGIN) can use superadmin routes */
function requireSuperAdmin(req, res, next) {
  const session = storage.validateToken(req.headers['x-token'] || req.query.token);
  if (!session) return res.status(401).json({ error: 'Не авторизован' });
  if (session.login !== process.env.SUPER_ADMIN_LOGIN) return res.status(403).json({ error: 'Только суперадмин' });
  req.session = session; next();
}

// ── Auth ──────────────────────────────────────────────────

app.post('/api/auth/register', registerLimiter, (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Укажи логин и пароль' });
  if (login.length < 3)    return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  res.json(storage.registerUser(login, password));
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Укажи логин и пароль' });
  const result = storage.loginUser(login, password);
  if (!result.ok) return res.status(result.pending ? 403 : 401).json(result);
  res.json(result);
});

app.get('/api/auth/me', requireToken, (req, res) => {
  res.json({ login: req.session.login, role: req.session.role });
});

app.post('/api/auth/logout', requireToken, (req, res) => {
  const token = req.headers['x-token'] || req.query.token;
  res.json(storage.logoutUser(token));
});

app.post('/api/auth/change-password', requireToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  res.json(storage.changePassword(req.session.login, oldPassword, newPassword));
});

// Legacy API-key endpoints
app.post('/api/auth/approve', requireApiKey, (req, res) => {
  res.json({ ok: storage.approveUser(req.body.login) });
});
app.get('/api/auth/pending', requireApiKey, (req, res) => {
  res.json(storage.getPendingUsers());
});

// ── Admin: approvals / tasks ──────────────────────────────

app.get('/api/admin/pending',  requireAdmin, (req, res) => res.json(storage.getPendingUsers()));
app.get('/api/admin/recruiters', requireAdmin, (req, res) => res.json(storage.getRecruiters()));

app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { login, role } = req.body;
  if (!login) return res.status(400).json({ error: 'Укажи логин' });
  res.json({ ok: storage.approveUserWithRole(login, role || 'recruiter') });
});

app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ error: 'Укажи логин' });
  res.json({ ok: storage.rejectUser(login) });
});

app.get('/api/admin/tasks', requireAdmin, (req, res) => res.json(storage.getAllTasks()));

app.post('/api/admin/tasks', requireAdmin, (req, res) => {
  const { title, description, assignedTo } = req.body;
  if (!title) return res.status(400).json({ error: 'Укажи название задания' });
  res.json(storage.createTask(title, description, assignedTo || 'all'));
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  if (!storage.deleteTask(req.params.id))
    return res.status(404).json({ error: 'Задание не найдено' });
  res.json({ ok: true });
});

// ── Recruiter: tasks ──────────────────────────────────────

app.get('/api/tasks', requireRecruiter, (req, res) => {
  const discordId = storage.getDiscordIdByLogin(req.session.login);
  // BUG FIX: без привязки Discord задания не показываем — нельзя отмечать выполнение
  if (!discordId) return res.json([]);
  res.json(storage.getTasksForUser(discordId, req.session.login));
});

app.post('/api/tasks/:id/complete', requireRecruiter, (req, res) => {
  const discordId = storage.getDiscordIdByLogin(req.session.login);
  if (!discordId) return res.status(400).json({ error: 'Привяжи Discord в кабинете' });
  const task = storage.completeTask(req.params.id, discordId);
  if (!task) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(task);
});

app.post('/api/tasks/:id/uncomplete', requireRecruiter, (req, res) => {
  const discordId = storage.getDiscordIdByLogin(req.session.login);
  if (!discordId) return res.status(400).json({ error: 'Привяжи Discord в кабинете' });
  const task = storage.uncompleteTask(req.params.id, discordId);
  if (!task) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(task);
});

// ── Leaderboard ───────────────────────────────────────────

app.get('/api/leaderboard', (req, res) => {
  const config = storage.getConfig();
  const list = Object.values(storage.getAll())
    .filter(r => r.status !== 'kicked' || req.query.all === '1')
    .map(r => ({ ...r, rank: storage.getRank(r.points, config), isCurator: storage.isCurator(r.points), history: undefined }))
    .sort((a, b) => b.points - a.points);
  res.json({ recruiters: list, config, lastBurn: storage.load().lastWeeklyBurn });
});

app.get('/api/recruiter/:id', (req, res) => {
  const r = storage.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// ── Points — ADMIN ONLY ───────────────────────────────────
// 🔒 FIX: рекруты больше не могут менять баллы через сайт.
//    Принимаются только: токен администратора ИЛИ API-ключ (для бота).

app.post('/api/points', (req, res) => {
  const token  = req.headers['x-token'];
  const apiKey = req.headers['x-api-key'];
  const session  = token  ? storage.validateToken(token)               : null;
  const isApiKey = apiKey && apiKey === process.env.API_KEY;

  if (!session && !isApiKey) return res.status(401).json({ error: 'Не авторизован' });

  // Рекрут пытается сам себе менять баллы — запрещено
  if (session && session.role !== 'admin') return res.status(403).json({ error: 'Только администраторы могут изменять баллы' });

  const { userId, amount, reason } = req.body;
  if (!userId || amount === undefined) return res.status(400).json({ error: 'Укажи userId и amount' });

  const actorId = session ? session.login : 'api';
  const r = storage.addPoints(userId, amount, reason || 'Ручное начисление', actorId);
  if (!r) return res.status(404).json({ error: 'Рекрут не найден' });
  const config = storage.getConfig();
  res.json({ ...r, rank: storage.getRank(r.points, config) });
});

// ── Superadmin — только PAKSPEL ──────────────────────────

/** GET /api/superadmin/users — список всех одобренных пользователей */
app.get('/api/superadmin/users', requireSuperAdmin, (req, res) => {
  res.json(storage.getAllUsersForAdmin());
});

/** POST /api/superadmin/users/:login/role — сменить роль пользователя */
app.post('/api/superadmin/users/:login/role', requireSuperAdmin, (req, res) => {
  const { role } = req.body;
  if (!['recruiter', 'admin'].includes(role))
    return res.status(400).json({ error: 'Роль должна быть recruiter или admin' });
  if (req.params.login === process.env.SUPER_ADMIN_LOGIN)
    return res.status(400).json({ error: 'Нельзя изменить роль суперадмина' });
  const ok = storage.setUserRole(req.params.login, role);
  if (!ok) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ ok: true });
});

// ── Admin: управление рекрутами ───────────────────────────

/** Список всех рекрутов в системе рейтинга */
app.get('/api/admin/recruiters-list', requireAdmin, (req, res) => {
  const config = storage.getConfig();
  const list = Object.values(storage.getAll())
    .map(r => ({ discordId: r.discordId, displayName: r.displayName, username: r.username, points: r.points, status: r.status, joinedAt: r.joinedAt }))
    .sort((a, b) => b.points - a.points);
  res.json(list);
});

/** Добавить рекрута по Discord ID */
app.post('/api/admin/recruiters/add', requireAdmin, (req, res) => {
  const { discordId, displayName } = req.body;
  if (!discordId) return res.status(400).json({ error: 'Укажи Discord ID' });
  res.json(storage.adminAddRecruiter(discordId.trim(), displayName, req.session.login));
});

/** Переименовать рекрута */
app.post('/api/admin/recruiters/:id/rename', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажи новое имя' });
  res.json(storage.renameRecruiter(req.params.id, name));
});

// ── Discord привязка ──────────────────────────────────────

/** Привязать Discord ID к своему аккаунту */
app.post('/api/auth/link-discord', requireToken, (req, res) => {
  const { discordId } = req.body;
  if (!discordId || !/^\d{15,20}$/.test(discordId.trim()))
    return res.status(400).json({ error: 'Некорректный Discord ID. Должен состоять из 17–19 цифр.' });
  res.json(storage.linkDiscordToUser(req.session.login, discordId.trim()));
});

/** Отвязать Discord */
app.post('/api/auth/unlink-discord', requireToken, (req, res) => {
  res.json(storage.unlinkDiscord(req.session.login));
});

/** Получить текущий привязанный Discord ID */
app.get('/api/auth/discord-status', requireToken, (req, res) => {
  const discordId = storage.getDiscordIdByLogin(req.session.login);
  res.json({ discordId: discordId || null, linked: !!discordId });
});

/**
 * Привязать Discord через одноразовый код из бота (/привязать).
 * Тело: { code: "123456" }
 */
app.post('/api/auth/link-discord-code', requireToken, (req, res) => {
  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(String(code).trim()))
    return res.status(400).json({ error: 'Укажи 6-значный код из Discord-бота.' });
  res.json(storage.consumeLinkCode(req.session.login, code));
});

/**
 * Бот вызывает этот эндпоинт, чтобы сгенерировать код для пользователя.
 * Требует API-ключ. Тело: { discordId: "..." }
 */
app.post('/api/auth/generate-link-code', requireApiKey, (req, res) => {
  const { discordId } = req.body;
  if (!discordId || !/^\d{15,20}$/.test(discordId))
    return res.status(400).json({ error: 'Некорректный discordId' });
  res.json(storage.generateLinkCode(discordId));
});

/** Задания по Discord ID — для бота */
app.get('/api/tasks/by-discord/:discordId', requireApiKey, (req, res) => {
  const user = storage.getUserByDiscordId(req.params.discordId);
  if (!user) return res.status(404).json({ error: 'Discord не привязан ни к одному аккаунту' });
  const tasks = storage.getTasksForUser(user.login);
  res.json({ login: user.login, tasks });
});



app.get('/api/config', (req, res) => res.json(storage.getConfig()));
app.post('/api/config', requireApiKey, (req, res) => res.json(storage.setConfig(req.body)));

// ── История баллов ────────────────────────────────────────

/** История баллов одного рекрута (для кабинета) */
app.get('/api/recruiter/:id/history', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const result = storage.getPointsHistory(req.params.id, limit, offset);
  res.json(result);
});

/** История баллов всех рекрутов с фильтрами (для страницы /history) */
app.get('/api/history', requireAdmin, (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset   = parseInt(req.query.offset) || 0;
  const userId   = req.query.userId   || undefined;
  const dateFrom = req.query.dateFrom || undefined;
  const dateTo   = req.query.dateTo   || undefined;
  res.json(storage.getAllPointsHistory({ userId, dateFrom, dateTo, limit, offset }));
});

/** Статистика приёма — кто принял сколько людей (для кураторов и выше) */
app.get('/api/admin/accepted-stats', requireCuratorOrAdmin, (req, res) => {
  res.json(storage.getAcceptedStats());
});

app.post('/api/register', requireApiKey, (req, res) => {
  const { userId, username, displayName } = req.body;
  if (!userId || !username) return res.status(400).json({ error: 'Missing userId or username' });
  res.json(storage.register(userId, username, displayName));
});

app.delete('/api/recruiter/:id', requireApiKey, (req, res) => {
  storage.remove(req.params.id); res.json({ ok: true });
});

app.post('/api/weekly-burn', requireApiKey, (req, res) => {
  res.json(storage.doWeeklyBurn());
});

function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));
}

module.exports = { startServer };
