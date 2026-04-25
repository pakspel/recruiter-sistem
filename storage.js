/**
 * storage.js — SQLite backend
 * DB path: DATA_PATH env var (defaults to ./data.db)
 * On Railway: set DATA_PATH=/data/recruiter.db and mount a volume at /data
 */

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');

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
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS recruiters (
    user_id         TEXT PRIMARY KEY,
    username        TEXT NOT NULL,
    display_name    TEXT,
    points          INTEGER DEFAULT 0,
    total_earned    INTEGER DEFAULT 0,
    total_accepted  INTEGER DEFAULT 0,
    total_rejected  INTEGER DEFAULT 0,
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
    created_at     TEXT,
    discord_id     TEXT DEFAULT NULL
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

  -- Relational history: replaces JSON history column
  CREATE TABLE IF NOT EXISTS points_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    delta      INTEGER NOT NULL,
    action     TEXT NOT NULL,
    actor_id   TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ph_user ON points_history(user_id, created_at DESC);

  -- Relational completions: replaces JSON completed_by column
  CREATE TABLE IF NOT EXISTS task_completions (
    task_id      TEXT NOT NULL,
    discord_id   TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (task_id, discord_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tc_discord ON task_completions(discord_id);

  -- One-time codes for Discord account linking (TTL = 5 min)
  CREATE TABLE IF NOT EXISTS link_codes (
    code       TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Soft migrations for existing DBs
try { db.exec("ALTER TABLE users ADD COLUMN discord_id TEXT DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE recruiters ADD COLUMN total_accepted INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE recruiters ADD COLUMN total_rejected INTEGER DEFAULT 0"); } catch (_) {}

// One-time data migration: JSON columns -> relational tables
(function migrateJsonToRelational() {
  const migrated = db.prepare("SELECT value FROM meta WHERE key='json_migrated'").get();
  if (migrated) return;

  db.transaction(() => {
    const insertH = db.prepare(
      'INSERT OR IGNORE INTO points_history (user_id, delta, action, actor_id, created_at) VALUES (?,?,?,?,?)'
    );
    for (const row of db.prepare('SELECT user_id, history FROM recruiters').all()) {
      try {
        const entries = JSON.parse(row.history || '[]');
        for (const e of entries)
          insertH.run(row.user_id, e.delta ?? 0, e.action ?? '', e.actorId ?? null, e.date ?? new Date().toISOString());
      } catch (_) {}
    }

    const insertC = db.prepare(
      'INSERT OR IGNORE INTO task_completions (task_id, discord_id, completed_at) VALUES (?,?,?)'
    );
    const now = new Date().toISOString();
    for (const row of db.prepare('SELECT task_id, completed_by FROM tasks').all()) {
      try {
        const ids = JSON.parse(row.completed_by || '[]');
        for (const id of ids) insertC.run(row.task_id, id, now);
      } catch (_) {}
    }

    db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('json_migrated','1')").run();
  })();
  console.log('Migration: JSON columns -> relational tables complete');
})();

if (!db.prepare("SELECT 1 FROM config WHERE key='main'").get())
  db.prepare("INSERT INTO config (key,value) VALUES ('main',?)").run(JSON.stringify(DEFAULT_CONFIG));

// ── Helpers ───────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

function hashPassword(pw) { return bcrypt.hashSync(pw, BCRYPT_ROUNDS); }

function verifyPassword(pw, stored) {
  if (stored.startsWith('$2')) return bcrypt.compareSync(pw, stored);
  return crypto.createHash('sha256').update(pw).digest('hex') === stored;
}

function isCurator(points) { return points >= CURATOR_MIN; }

function computeStatus(points) {
  if (isCurator(points)) return 'curator';
  if (points <= 0)        return 'kicked';
  if (points <= 5)        return 'danger';
  if (points <= 10)       return 'warning';
  return 'active';
}

const stmtHistory = db.prepare(
  'SELECT delta, action, actor_id AS actorId, created_at AS date FROM points_history WHERE user_id=? ORDER BY created_at DESC LIMIT 50'
);
const stmtCompletions = db.prepare(
  'SELECT discord_id FROM task_completions WHERE task_id=?'
);

function rowToRecruiter(row, { includeHistory = true } = {}) {
  if (!row) return null;
  return {
    discordId:      row.user_id,
    username:       row.username,
    displayName:    row.display_name || row.username,
    points:         row.points,
    totalEarned:    row.total_earned,
    totalAccepted:  row.total_accepted || 0,
    totalRejected:  row.total_rejected || 0,
    weeklyActivity: JSON.parse(row.weekly_activity || '[]'),
    joinedAt:       row.joined_at,
    status:         row.status,
    history:        includeHistory ? stmtHistory.all(row.user_id) : [],
    _prevEarned:    row.prev_earned
  };
}

function rowToTask(row) {
  const completedBy = stmtCompletions.all(row.task_id).map(r => r.discord_id);
  return {
    id:          row.task_id,
    title:       row.title,
    description: row.description,
    assignedTo:  row.assigned_to,
    createdAt:   row.created_at,
    completedBy
  };
}

// ── Recruiters ────────────────────────────────────────────

function getAll() {
  const result = {};
  for (const row of db.prepare('SELECT * FROM recruiters').all()) {
    const r = rowToRecruiter(row, { includeHistory: false });
    result[r.discordId] = r;
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

function addPoints(userId, amount, reason, actorId = null, type = null) {
  const row = db.prepare('SELECT * FROM recruiters WHERE user_id=?').get(userId);
  if (!row) return null;

  const newPoints   = Math.max(0, row.points + amount);
  const newEarned   = amount > 0 ? (row.total_earned || 0) + amount : (row.total_earned || 0);
  const newStatus   = computeStatus(newPoints);
  const acceptedInc = type === 'accepted' ? 1 : 0;
  const rejectedInc = type === 'rejected' ? 1 : 0;
  const now         = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`UPDATE recruiters
      SET points=?, total_earned=?, status=?,
          total_accepted = COALESCE(total_accepted,0) + ?,
          total_rejected = COALESCE(total_rejected,0) + ?
      WHERE user_id=?`)
      .run(newPoints, newEarned, newStatus, acceptedInc, rejectedInc, userId);
    db.prepare('INSERT INTO points_history (user_id, delta, action, actor_id, created_at) VALUES (?,?,?,?,?)')
      .run(userId, amount, reason || 'Ручное начисление', actorId, now);
  })();

  return get(userId);
}

function remove(userId) { db.prepare('DELETE FROM recruiters WHERE user_id=?').run(userId); }

// ── Points history ────────────────────────────────────────

function getPointsHistory(userId, limit = 100, offset = 0) {
  const rows = db.prepare(
    'SELECT id, delta, action, actor_id AS actorId, created_at AS date FROM points_history WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(userId, limit, offset);
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM points_history WHERE user_id=?').get(userId);
  return { rows, total };
}

function getAllPointsHistory({ userId, dateFrom, dateTo, limit = 100, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (userId)   { conditions.push('ph.user_id=?');    params.push(userId); }
  if (dateFrom) { conditions.push('ph.created_at>=?'); params.push(dateFrom); }
  if (dateTo)   { conditions.push('ph.created_at<=?'); params.push(dateTo); }
  const where = conditions.join(' AND ');

  const rows = db.prepare(
    `SELECT ph.id, ph.user_id, r.display_name AS displayName,
            ph.delta, ph.action, ph.actor_id AS actorId, ph.created_at AS date
     FROM points_history ph
     LEFT JOIN recruiters r ON r.user_id = ph.user_id
     WHERE ${where} ORDER BY ph.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM points_history ph WHERE ${where}`
  ).get(...params);

  return { rows, total };
}

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
  const burn    = getConfig().weeklyBurn || 5;
  const results = { burned: [], kicked: [], skippedCurators: [] };
  const now     = new Date().toISOString();

  const stmtUpd  = db.prepare('UPDATE recruiters SET points=?,status=?,weekly_activity=?,prev_earned=? WHERE user_id=?');
  const stmtInsH = db.prepare('INSERT INTO points_history (user_id, delta, action, actor_id, created_at) VALUES (?,?,?,?,?)');

  db.transaction(() => {
    for (const row of db.prepare('SELECT * FROM recruiters').all()) {
      if (row.status === 'kicked') continue;
      const rec = rowToRecruiter(row, { includeHistory: false });
      if (isCurator(rec.points)) { results.skippedCurators.push(row.user_id); continue; }

      const wasActive   = rec.totalEarned !== (rec._prevEarned || 0);
      const newActivity = [wasActive, ...rec.weeklyActivity].slice(0, 8);
      const prevEarned  = rec.totalEarned;
      const newPoints   = Math.max(0, rec.points - burn);
      const newStatus   = computeStatus(newPoints);

      stmtUpd.run(newPoints, newStatus, JSON.stringify(newActivity), prevEarned, row.user_id);
      stmtInsH.run(row.user_id, -burn, `Еженедельное списание (-${burn})`, 'system', now);

      if (newStatus === 'kicked')       results.kicked.push(row.user_id);
      else if (newStatus === 'danger')  results.burned.push(row.user_id);
    }
  })();

  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('lastWeeklyBurn',?)").run(now);
  return results;
}

// ── Auth ──────────────────────────────────────────────────

function seedAdmin(login, password) {
  const key = login.toLowerCase();
  if (!db.prepare('SELECT 1 FROM users WHERE login=?').get(key)) {
    db.prepare(`INSERT INTO users (login,original_login,password_hash,approved,role,created_at) VALUES (?,?,?,1,'admin',?)`)
      .run(key, login, hashPassword(password), new Date().toISOString());
    console.log(`Admin user "${login}" created`);
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
  const key  = login.toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE login=?').get(key);
  if (!user) return { ok: false, error: 'Неверный логин или пароль' };
  if (!verifyPassword(password, user.password_hash)) return { ok: false, error: 'Неверный логин или пароль' };
  if (!user.approved) return { ok: false, error: 'pending', pending: true };

  if (!user.password_hash.startsWith('$2'))
    db.prepare('UPDATE users SET password_hash=? WHERE login=?').run(hashPassword(password), key);

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

function logoutUser(token) {
  db.prepare('DELETE FROM tokens WHERE token=?').run(token);
  return { ok: true };
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
  if (!verifyPassword(oldPassword, user.password_hash)) return { ok: false, error: 'Неверный старый пароль' };
  db.prepare('UPDATE users SET password_hash=? WHERE login=?').run(hashPassword(newPassword), login.toLowerCase());
  db.prepare('DELETE FROM tokens WHERE login=?').run(user.original_login);
  return { ok: true };
}

// ── Superadmin ────────────────────────────────────────────

function getAllUsersForAdmin() {
  return db.prepare("SELECT original_login as login, role, created_at FROM users WHERE approved=1 ORDER BY created_at").all()
    .map(r => ({ login: r.login, role: r.role, createdAt: r.created_at }));
}

function setUserRole(login, role) {
  const key     = login.toLowerCase();
  const userRow = db.prepare('SELECT original_login FROM users WHERE login=?').get(key);
  if (!userRow) return false;
  db.prepare('UPDATE users SET role=? WHERE login=?').run(role, key);
  db.prepare('UPDATE tokens SET role=? WHERE login=?').run(role, userRow.original_login);
  return true;
}

// ── Tasks ─────────────────────────────────────────────────

/**
 * Нормализует assignedTo: логин -> discordId, чтобы устранить
 * путаницу login vs discordId при назначении заданий из веб-панели.
 */
function resolveAssignedTo(assignedTo) {
  if (!assignedTo || assignedTo === 'all') return 'all';
  if (/^\d{15,20}$/.test(assignedTo)) return assignedTo;
  const discordId = getDiscordIdByLogin(assignedTo);
  return discordId || assignedTo;
}

function createTask(title, description, assignedTo) {
  const id         = crypto.randomBytes(8).toString('hex');
  const now        = new Date().toISOString();
  const normalised = resolveAssignedTo(assignedTo);
  db.prepare(`INSERT INTO tasks (task_id,title,description,assigned_to,created_at,completed_by) VALUES (?,?,?,?,?,'[]')`)
    .run(id, title, description || '', normalised, now);
  return { id, title, description: description || '', assignedTo: normalised, createdAt: now, completedBy: [] };
}

function getAllTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(rowToTask);
}

function getTasksForUser(discordId, login) {
  if (login) {
    return db.prepare(
      "SELECT * FROM tasks WHERE assigned_to='all' OR assigned_to=? OR assigned_to=? ORDER BY created_at DESC"
    ).all(discordId, login.toLowerCase()).map(rowToTask);
  }
  return db.prepare("SELECT * FROM tasks WHERE assigned_to='all' OR assigned_to=? ORDER BY created_at DESC").all(discordId).map(rowToTask);
}

function completeTask(taskId, discordId) {
  const row = db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId);
  if (!row) return null;
  db.prepare('INSERT OR IGNORE INTO task_completions (task_id, discord_id, completed_at) VALUES (?,?,?)')
    .run(taskId, discordId, new Date().toISOString());
  return rowToTask(row);
}

function uncompleteTask(taskId, discordId) {
  const row = db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId);
  if (!row) return null;
  db.prepare('DELETE FROM task_completions WHERE task_id=? AND discord_id=?').run(taskId, discordId);
  return rowToTask(row);
}

function deleteTask(taskId) {
  db.transaction(() => {
    db.prepare('DELETE FROM task_completions WHERE task_id=?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE task_id=?').run(taskId);
  })();
  return true;
}

// ── Discord linking ───────────────────────────────────────

function linkDiscordToUser(login, discordId) {
  const existing = db.prepare("SELECT original_login FROM users WHERE discord_id=? AND login!=?")
    .get(discordId, login.toLowerCase());
  if (existing) return { ok: false, error: `Discord уже привязан к аккаунту ${existing.original_login}` };
  db.prepare("UPDATE users SET discord_id=? WHERE login=?").run(discordId, login.toLowerCase());
  return { ok: true };
}

function unlinkDiscord(login) {
  db.prepare("UPDATE users SET discord_id=NULL WHERE login=?").run(login.toLowerCase());
  return { ok: true };
}

function getUserByDiscordId(discordId) {
  return db.prepare("SELECT original_login as login, role, discord_id FROM users WHERE discord_id=? AND approved=1").get(discordId) || null;
}

function getDiscordIdByLogin(login) {
  const row = db.prepare("SELECT discord_id FROM users WHERE login=?").get(login.toLowerCase());
  return row ? row.discord_id : null;
}

// ── Discord linking via one-time code ─────────────────────

/**
 * Бот вызывает эту функцию при /привязать.
 * Возвращает { ok: true, code } или { ok: false, error }.
 * Код действует 5 минут, одноразовый.
 */
function generateLinkCode(discordId) {
  db.prepare('DELETE FROM link_codes WHERE expires_at < ? OR discord_id = ?').run(Date.now(), discordId);
  const existing = getUserByDiscordId(discordId);
  if (existing) return { ok: false, alreadyLinked: true, login: existing.login };

  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  db.prepare('INSERT INTO link_codes (code, discord_id, expires_at) VALUES (?,?,?)').run(code, discordId, expiresAt);
  return { ok: true, code };
}

/**
 * Пользователь вводит 6-значный код на сайте.
 * Код удаляется сразу после использования.
 */
function consumeLinkCode(login, code) {
  db.prepare('DELETE FROM link_codes WHERE expires_at < ?').run(Date.now());
  const row = db.prepare('SELECT * FROM link_codes WHERE code=?').get(String(code).trim());
  if (!row) return { ok: false, error: 'Код не найден или истёк. Запроси новый командой /привязать в боте.' };
  const discordId = row.discord_id;
  db.prepare('DELETE FROM link_codes WHERE code=?').run(String(code).trim());
  return linkDiscordToUser(login, discordId);
}

// ── Admin: recruiter management ───────────────────────────

function adminAddRecruiter(discordId, displayName, adminLogin) {
  if (!discordId || !/^\d{15,20}$/.test(discordId))
    return { ok: false, error: 'Некорректный Discord ID (17–19 цифр)' };
  if (db.prepare('SELECT 1 FROM recruiters WHERE user_id=?').get(discordId))
    return { ok: false, error: 'Рекрут с таким Discord ID уже существует' };
  const name   = (displayName || '').trim() || `user_${discordId.slice(-4)}`;
  const config = getConfig();
  db.prepare(`INSERT INTO recruiters (user_id,username,display_name,points,total_earned,weekly_activity,joined_at,status,history,prev_earned)
    VALUES (?,?,?,?,0,'[]',?,'active','[]',0)`)
    .run(discordId, name, name, config.startingBuffer, new Date().toISOString());
  return { ok: true, recruiter: get(discordId) };
}

function renameRecruiter(discordId, newName) {
  if (!newName || !newName.trim()) return { ok: false, error: 'Введи имя' };
  const trimmed = newName.trim().slice(0, 40);
  const changes = db.prepare("UPDATE recruiters SET display_name=? WHERE user_id=?").run(trimmed, discordId).changes;
  if (!changes) return { ok: false, error: 'Рекрут не найден' };
  return { ok: true, recruiter: get(discordId) };
}

// ── Superadmin: orphaned accounts ─────────────────────────

/**
 * Возвращает аккаунты личных кабинетов, чей рекрут был удалён из системы.
 * «Мёртвый» аккаунт — это запись в таблице users, у которой:
 *   - discord_id IS NOT NULL (был создан ботом и привязан)
 *   - И этого discord_id нет в таблице recruiters
 * Либо:
 *   - discord_id IS NULL (зарегистрирован вручную, но никогда не привязан и не имеет рекрута)
 *   И нет совпадающего рекрута по username
 */
function getOrphanedUsers() {
  // Аккаунты с привязанным Discord ID, которого нет среди рекрутов
  const linkedOrphans = db.prepare(`
    SELECT u.original_login AS login, u.role, u.created_at AS createdAt,
           u.discord_id AS discordId, 'no_recruiter' AS reason
    FROM users u
    WHERE u.discord_id IS NOT NULL
      AND u.discord_id NOT IN (SELECT user_id FROM recruiters)
      AND u.role != 'admin'
  `).all();

  // Аккаунты без Discord ID, чей логин не совпадает ни с одним username рекрута
  const unlinkedOrphans = db.prepare(`
    SELECT u.original_login AS login, u.role, u.created_at AS createdAt,
           NULL AS discordId, 'never_linked' AS reason
    FROM users u
    WHERE u.discord_id IS NULL
      AND u.role = 'recruiter'
      AND LOWER(u.login) NOT IN (SELECT LOWER(username) FROM recruiters)
  `).all();

  return [...linkedOrphans, ...unlinkedOrphans];
}

/**
 * Удаляет аккаунт личного кабинета (и все его токены).
 * Нельзя удалить admin / superadmin через этот метод.
 */
function deleteUser(login) {
  const key  = login.toLowerCase();
  const user = db.prepare('SELECT role, original_login FROM users WHERE login=?').get(key);
  if (!user)                   return { ok: false, error: 'Пользователь не найден' };
  if (user.role === 'admin')   return { ok: false, error: 'Нельзя удалить администратора' };

  db.transaction(() => {
    db.prepare('DELETE FROM tokens WHERE login=?').run(user.original_login);
    db.prepare('DELETE FROM users  WHERE login=?').run(key);
  })();
  return { ok: true };
}

// ── Compat shim ───────────────────────────────────────────

function load() {
  const lwb = db.prepare("SELECT value FROM meta WHERE key='lastWeeklyBurn'").get();
  return { recruiters: getAll(), config: getConfig(), lastWeeklyBurn: lwb ? lwb.value : null };
}

module.exports = {
  load, getAll, get, register, addPoints, remove,
  getConfig, setConfig, getRank, doWeeklyBurn, isCurator,
  seedAdmin, registerUser, loginUser, logoutUser, validateToken,
  approveUser, approveUserWithRole, rejectUser,
  getPendingUsers, getRecruiters, changePassword, hashPassword,
  createTask, getAllTasks, getTasksForUser, completeTask, uncompleteTask, deleteTask,
  getAllUsersForAdmin, setUserRole,
  linkDiscordToUser, unlinkDiscord, getUserByDiscordId, getDiscordIdByLogin,
  adminAddRecruiter, renameRecruiter,
  generateLinkCode, consumeLinkCode,
  getPointsHistory, getAllPointsHistory,
  getOrphanedUsers, deleteUser,
};
