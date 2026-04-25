/**
 * storage.js — SQLite backend
 * DB path: DATA_PATH env var (defaults to ./data.db)
 * On Railway: set DATA_PATH=/data/recruiter.db and mount a volume at /data
 */

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

const DB_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, 'data.db');

const CURATOR_MIN = 2000;

const DEFAULT_CONFIG = {
  weeklyBurn: 5,
  startingBuffer: 20,
  scoring: { accepted: 5, rejected: 3, candidateLeft: -3, manualBonus: 0 },
  ranks: [
    { name: 'Стажёр',  emoji: '🔰', min: 0    },
    { name: 'Рекрут',  emoji: '🎯', min: 30   },
    { name: 'Агент',   emoji: '⚡', min: 75   },
    { name: 'Элита',   emoji: '👑', min: 150  },
    { name: 'Куратор', emoji: '🛡', min: 2000 }
  ],
  watchChannelId: null, otherBotId: null,
  adminRoleId: null, leaderboardChannelId: null
};

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS recruiters (
    user_id         TEXT PRIMARY KEY,
    username        TEXT NOT NULL,
    display_name    TEXT,
    points          INTEGER DEFAULT 0,
    total_earned    INTEGER DEFAULT 0,
    weekly_activity TEXT DEFAULT '[]',
    joined_at       TEXT,
    status          TEXT DEFAULT 'active',
    history         TEXT DEFAULT '[]',
    prev_earned     INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS users (
    login          TEXT PRIMARY KEY,
    original_login TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    approved       INTEGER DEFAULT 0,
    role           TEXT DEFAULT 'recruiter',
    created_at     TEXT
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token      TEXT PRIMARY KEY,
    login      TEXT NOT NULL,
    role       TEXT NOT NULL,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tasks (
    task_id      TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    assigned_to  TEXT DEFAULT 'all',
    created_at   TEXT,
    completed_by TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY, value TEXT
  );
`);

if (!db.prepare("SELECT 1 FROM config WHERE key='main'").get())
  db.prepare("INSERT INTO config (key,value) VALUES ('main',?)").run(JSON.stringify(DEFAULT_CONFIG));

// ── Helpers ───────────────────────────────────────────────

function hashPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function isCurator(points) { return points >= CURATOR_MIN; }

function rowToRecruiter(row) {
  if (!row) return null;
  return {
    discordId:      row.user_id,
    username:       row.username,
    displayName:    row.display_name || row.username,
    points:         row.points,
    totalEarned:    row.total_earned,
    weeklyActivity: JSON.parse(row.weekly_activity || '[]'),
    joinedAt:       row.joined_at,
    status:         row.status,
    history:        JSON.parse(row.history || '[]'),
    _prevEarned:    row.prev_earned
  };
}

function rowToTask(row) {
  return { id: row.task_id, title: row.title, description: row.description,
           assignedTo: row.assigned_to, createdAt: row.created_at,
           completedBy: JSON.parse(row.completed_by || '[]') };
}

// ── Recruiters ────────────────────────────────────────────

function getAll() {
  const result = {};
  for (const row of db.prepare('SELECT * FROM recruiters').all()) {
    const r = rowToRecruiter(row); result[r.discordId] = r;
  }
  return result;
}

function get(userId) {
  return rowToRecruiter(db.prepare('SELECT * FROM recruiters WHERE user_id=?').get(userId));
}

function register(userId, username, displayName) {
  const config = getConfig();
  if (!db.prepare('SELECT 1 FROM recruiters WHERE user_id=?').get(userId))
    db.prepare(`INSERT INTO recruiters (user_id,username,display_name,points,total_earned,weekly_activity,joined_at,status,history,prev_earned) VALUES (?,?,?,?,0,'[]',?,'active','[]',0)`)
      .run(userId, username, displayName || username, config.startingBuffer, new Date().toISOString());
  return get(userId);
}

function addPoints(userId, amount, reason, actorId = null) {
  const row = db.prepare('SELECT * FROM recruiters WHERE user_id=?').get(userId);
  if (!row) return null;
  const rec = rowToRecruiter(row);
  rec.points = Math.max(0, rec.points + amount);
  if (amount > 0) rec.totalEarned = (rec.totalEarned || 0) + amount;
  rec.history.unshift({ date: new Date().toISOString(), action: reason, delta: amount, actorId });
  rec.history = rec.history.slice(0, 50);
  if (!isCurator(rec.points)) {
    if (rec.points <= 0)       rec.status = 'kicked';
    else if (rec.points <= 5)  rec.status = 'danger';
    else if (rec.points <= 10) rec.status = 'warning';
    else                        rec.status = 'active';
  } else { rec.status = 'curator'; }
  db.prepare('UPDATE recruiters SET points=?,total_earned=?,history=?,status=? WHERE user_id=?')
    .run(rec.points, rec.totalEarned, JSON.stringify(rec.history), rec.status, userId);
  return rec;
}

function remove(userId) { db.prepare('DELETE FROM recruiters WHERE user_id=?').run(userId); }

// ── Config ────────────────────────────────────────────────

function getConfig() {
  const row = db.prepare("SELECT value FROM config WHERE key='main'").get();
  return row ? JSON.parse(row.value) : DEFAULT_CONFIG;
}

function setConfig(updates) {
  const merged = { ...getConfig(), ...updates };
  db.prepare("INSERT OR REPLACE INTO config (key,value) VALUES ('main',?)").run(JSON.stringify(merged));
  return merged;
}

function getRank(points, config) {
  let rank = config.ranks[0];
  for (const r of config.ranks) { if (points >= r.min) rank = r; }
  return rank;
}

function doWeeklyBurn() {
  const burn = getConfig().weeklyBurn || 5;
  const results = { burned: [], kicked: [], skippedCurators: [] };
  const upd = db.prepare('UPDATE recruiters SET points=?,status=?,history=?,weekly_activity=?,prev_earned=? WHERE user_id=?');
  db.transaction(() => {
    for (const row of db.prepare('SELECT * FROM recruiters').all()) {
      if (row.status === 'kicked') continue;
      const rec = rowToRecruiter(row);
      if (isCurator(rec.points) || rec.status === 'curator') { results.skippedCurators.push(row.user_id); continue; }
      const wasActive = rec.totalEarned !== (rec._prevEarned || 0);
      rec.weeklyActivity = [wasActive, ...rec.weeklyActivity].slice(0, 8);
      const prevEarned = rec.totalEarned;
      rec.points = Math.max(0, rec.points - burn);
      rec.history.unshift({ date: new Date().toISOString(), action: `Еженедельное списание (-${burn})`, delta: -burn, actorId: 'system' });
      rec.history = rec.history.slice(0, 50);
      if (rec.points <= 0)       { rec.status = 'kicked';  results.kicked.push(row.user_id); }
      else if (rec.points <= 5)  { rec.status = 'danger';  results.burned.push(row.user_id); }
      else if (rec.points <= 10)   rec.status = 'warning';
      else                          rec.status = 'active';
      upd.run(rec.points, rec.status, JSON.stringify(rec.history), JSON.stringify(rec.weeklyActivity), prevEarned, row.user_id);
    }
  })();
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('lastWeeklyBurn',?)").run(new Date().toISOString());
  return results;
}

// ── Auth ──────────────────────────────────────────────────

function seedAdmin(login, password) {
  const key = login.toLowerCase();
  if (!db.prepare('SELECT 1 FROM users WHERE login=?').get(key)) {
    db.prepare(`INSERT INTO users (login,original_login,password_hash,approved,role,created_at) VALUES (?,?,?,1,'admin',?)`)
      .run(key, login, hashPassword(password), new Date().toISOString());
    console.log(`✅ Admin user "${login}" created`);
  }
}

function registerUser(login, password) {
  const key = login.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE login=?').get(key))
    return { ok: false, error: 'Пользователь уже существует' };
  db.prepare(`INSERT INTO users (login,original_login,password_hash,approved,role,created_at) VALUES (?,?,?,0,'recruiter',?)`)
    .run(key, login, hashPassword(password), new Date().toISOString());
  return { ok: true };
}

function loginUser(login, password) {
  const key = login.toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE login=?').get(key);
  if (!user) return { ok: false, error: 'Неверный логин или пароль' };
  if (user.password_hash !== hashPassword(password)) return { ok: false, error: 'Неверный логин или пароль' };
  if (!user.approved) return { ok: false, error: 'pending', pending: true };
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO tokens (token,login,role,created_at) VALUES (?,?,?,?)')
    .run(token, user.original_login, user.role, Date.now());
  return { ok: true, token, login: user.original_login, role: user.role };
}

function validateToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM tokens WHERE token=?').get(token);
  if (!row) return null;
  if (Date.now() - row.created_at > 30 * 24 * 60 * 60 * 1000) {
    db.prepare('DELETE FROM tokens WHERE token=?').run(token); return null;
  }
  return { login: row.login, role: row.role };
}

function approveUser(login) {
  return db.prepare("UPDATE users SET approved=1 WHERE login=?").run(login.toLowerCase()).changes > 0;
}
function approveUserWithRole(login, role) {
  return db.prepare("UPDATE users SET approved=1,role=? WHERE login=?").run(role || 'recruiter', login.toLowerCase()).changes > 0;
}
function rejectUser(login) {
  return db.prepare('DELETE FROM users WHERE login=?').run(login.toLowerCase()).changes > 0;
}
function getPendingUsers() {
  return db.prepare("SELECT original_login as login, created_at FROM users WHERE approved=0").all()
    .map(r => ({ login: r.login, createdAt: r.created_at }));
}
function getRecruiters() {
  return db.prepare("SELECT original_login as login, created_at FROM users WHERE approved=1 AND role='recruiter'").all()
    .map(r => ({ login: r.login, createdAt: r.created_at }));
}
function changePassword(login, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE login=?').get(login.toLowerCase());
  if (!user) return { ok: false, error: 'Пользователь не найден' };
  if (user.password_hash !== hashPassword(oldPassword)) return { ok: false, error: 'Неверный старый пароль' };
  db.prepare('UPDATE users SET password_hash=? WHERE login=?').run(hashPassword(newPassword), login.toLowerCase());
  return { ok: true };
}

// ── Superadmin ────────────────────────────────────────────

function getAllUsersForAdmin() {
  return db.prepare("SELECT original_login as login, role, created_at FROM users WHERE approved=1 ORDER BY created_at").all()
    .map(r => ({ login: r.login, role: r.role, createdAt: r.created_at }));
}

function setUserRole(login, role) {
  const key = login.toLowerCase();
  const userRow = db.prepare('SELECT original_login FROM users WHERE login=?').get(key);
  if (!userRow) return false;
  db.prepare('UPDATE users SET role=? WHERE login=?').run(role, key);
  db.prepare('UPDATE tokens SET role=? WHERE login=?').run(role, userRow.original_login);
  return true;
}

// ── Tasks ─────────────────────────────────────────────────

function createTask(title, description, assignedTo) {
  const id = crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO tasks (task_id,title,description,assigned_to,created_at,completed_by) VALUES (?,?,?,?,?,'[]')`)
    .run(id, title, description || '', assignedTo || 'all', now);
  return { id, title, description: description || '', assignedTo: assignedTo || 'all', createdAt: now, completedBy: [] };
}
function getAllTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(rowToTask);
}
function getTasksForUser(login) {
  return db.prepare("SELECT * FROM tasks WHERE assigned_to='all' OR assigned_to=? ORDER BY created_at DESC").all(login).map(rowToTask);
}
function completeTask(taskId, login) {
  const row = db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId);
  if (!row) return null;
  const completedBy = JSON.parse(row.completed_by || '[]');
  if (!completedBy.includes(login)) { completedBy.push(login); db.prepare('UPDATE tasks SET completed_by=? WHERE task_id=?').run(JSON.stringify(completedBy), taskId); }
  return rowToTask({ ...row, completed_by: JSON.stringify(completedBy) });
}
function uncompleteTask(taskId, login) {
  const row = db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId);
  if (!row) return null;
  const completedBy = JSON.parse(row.completed_by || '[]').filter(l => l !== login);
  db.prepare('UPDATE tasks SET completed_by=? WHERE task_id=?').run(JSON.stringify(completedBy), taskId);
  return rowToTask({ ...row, completed_by: JSON.stringify(completedBy) });
}
function deleteTask(taskId) {
  return db.prepare('DELETE FROM tasks WHERE task_id=?').run(taskId).changes > 0;
}

// ── Discord linking ───────────────────────────────────────

// Добавляем колонку discord_id если её ещё нет (миграция)
try {
  db.exec("ALTER TABLE users ADD COLUMN discord_id TEXT DEFAULT NULL");
} catch (_) { /* уже существует */ }

/** Привязать Discord ID к аккаунту пользователя */
function linkDiscordToUser(login, discordId) {
  // Проверяем — не привязан ли этот Discord к другому аккаунту
  const existing = db.prepare("SELECT original_login FROM users WHERE discord_id=? AND login!=?").get(discordId, login.toLowerCase());
  if (existing) return { ok: false, error: `Discord уже привязан к аккаунту ${existing.original_login}` };
  db.prepare("UPDATE users SET discord_id=? WHERE login=?").run(discordId, login.toLowerCase());
  return { ok: true };
}

/** Отвязать Discord от аккаунта */
function unlinkDiscord(login) {
  db.prepare("UPDATE users SET discord_id=NULL WHERE login=?").run(login.toLowerCase());
  return { ok: true };
}

/** Получить логин пользователя по Discord ID */
function getUserByDiscordId(discordId) {
  return db.prepare("SELECT original_login as login, role, discord_id FROM users WHERE discord_id=? AND approved=1").get(discordId) || null;
}

/** Получить Discord ID пользователя по логину */
function getDiscordIdByLogin(login) {
  const row = db.prepare("SELECT discord_id FROM users WHERE login=?").get(login.toLowerCase());
  return row ? row.discord_id : null;
}

// ── Управление рекрутами (admin) ──────────────────────────

/** Добавить рекрута по Discord ID вручную (без регистрации) */
function adminAddRecruiter(discordId, displayName, adminLogin) {
  if (!discordId || !/^\d{15,20}$/.test(discordId))
    return { ok: false, error: 'Некорректный Discord ID (17–19 цифр)' };
  if (db.prepare('SELECT 1 FROM recruiters WHERE user_id=?').get(discordId))
    return { ok: false, error: 'Рекрут с таким Discord ID уже существует' };
  const name = (displayName || '').trim() || `user_${discordId.slice(-4)}`;
  const config = getConfig();
  db.prepare(`INSERT INTO recruiters (user_id,username,display_name,points,total_earned,weekly_activity,joined_at,status,history,prev_earned)
    VALUES (?,?,?,?,0,'[]',?,'active','[]',0)`)
    .run(discordId, name, name, config.startingBuffer, new Date().toISOString());
  return { ok: true, recruiter: get(discordId) };
}

/** Переименовать рекрута */
function renameRecruiter(discordId, newName) {
  if (!newName || !newName.trim()) return { ok: false, error: 'Введи имя' };
  const trimmed = newName.trim().slice(0, 40);
  const changes = db.prepare("UPDATE recruiters SET display_name=? WHERE user_id=?").run(trimmed, discordId).changes;
  if (!changes) return { ok: false, error: 'Рекрут не найден' };
  return { ok: true, recruiter: get(discordId) };
}

// ── Compat shim ───────────────────────────────────────────

function load() {
  const lwb = db.prepare("SELECT value FROM meta WHERE key='lastWeeklyBurn'").get();
  return { recruiters: getAll(), config: getConfig(), lastWeeklyBurn: lwb ? lwb.value : null };
}

module.exports = {
  load, getAll, get, register, addPoints, remove,
  getConfig, setConfig, getRank, doWeeklyBurn, isCurator,
  seedAdmin, registerUser, loginUser, validateToken,
  approveUser, approveUserWithRole, rejectUser,
  getPendingUsers, getRecruiters, changePassword, hashPassword,
  createTask, getAllTasks, getTasksForUser, completeTask, uncompleteTask, deleteTask,
  getAllUsersForAdmin, setUserRole,
  linkDiscordToUser, unlinkDiscord, getUserByDiscordId, getDiscordIdByLogin,
  adminAddRecruiter, renameRecruiter
};
