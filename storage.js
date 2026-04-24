const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');

const CURATOR_MIN = 2000;

const DEFAULT_DATA = {
  recruiters: {},
  users: {},
  tokens: {},
  config: {
    weeklyBurn: 5,
    startingBuffer: 20,
    scoring: {
      accepted: 5,
      rejected: 3,
      candidateLeft: -3,
      manualBonus: 0
    },
    ranks: [
      { name: 'Стажёр',  emoji: '🔰', min: 0    },
      { name: 'Рекрут',  emoji: '🎯', min: 30   },
      { name: 'Агент',   emoji: '⚡', min: 75   },
      { name: 'Элита',   emoji: '👑', min: 150  },
      { name: 'Куратор', emoji: '🛡', min: 2000 }
    ],
    watchChannelId: null,
    otherBotId: null,
    adminRoleId: null,
    leaderboardChannelId: null
  },
  lastWeeklyBurn: null
};

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!d.users)  d.users  = {};
    if (!d.tokens) d.tokens = {};
    return d;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function isCurator(points) {
  return points >= CURATOR_MIN;
}

// ── Recruiter helpers ──────────────────────────────────────

function getAll() {
  return load().recruiters;
}

function get(userId) {
  return load().recruiters[userId] || null;
}

function register(userId, username, displayName) {
  const data = load();
  if (!data.recruiters[userId]) {
    data.recruiters[userId] = {
      discordId: userId,
      username,
      displayName: displayName || username,
      points: data.config.startingBuffer,
      totalEarned: 0,
      weeklyActivity: [],
      joinedAt: new Date().toISOString(),
      status: 'active',
      history: []
    };
    save(data);
  }
  return data.recruiters[userId];
}

function addPoints(userId, amount, reason, actorId = null) {
  const data = load();
  if (!data.recruiters[userId]) return null;

  const rec = data.recruiters[userId];
  rec.points = Math.max(0, rec.points + amount);
  if (amount > 0) rec.totalEarned = (rec.totalEarned || 0) + amount;

  rec.history = rec.history || [];
  rec.history.unshift({ date: new Date().toISOString(), action: reason, delta: amount, actorId });
  rec.history = rec.history.slice(0, 50);

  // Curator — no status changes from points
  if (!isCurator(rec.points)) {
    if (rec.points <= 0)       rec.status = 'kicked';
    else if (rec.points <= 5)  rec.status = 'danger';
    else if (rec.points <= 10) rec.status = 'warning';
    else                        rec.status = 'active';
  } else {
    rec.status = 'curator';
  }

  save(data);
  return rec;
}

function remove(userId) {
  const data = load();
  delete data.recruiters[userId];
  save(data);
}

function getConfig() {
  return load().config;
}

function setConfig(updates) {
  const data = load();
  data.config = { ...data.config, ...updates };
  save(data);
  return data.config;
}

function getRank(points, config) {
  const ranks = config.ranks;
  let rank = ranks[0];
  for (const r of ranks) {
    if (points >= r.min) rank = r;
  }
  return rank;
}

function doWeeklyBurn() {
  const data = load();
  const burn = data.config.weeklyBurn || 5;
  const results = { burned: [], kicked: [], skippedCurators: [] };

  for (const [id, rec] of Object.entries(data.recruiters)) {
    if (rec.status === 'kicked') continue;

    // Кураторы — пропускаем списание
    if (isCurator(rec.points) || rec.status === 'curator') {
      results.skippedCurators.push(id);
      continue;
    }

    const wasActive = rec.totalEarned !== (rec._prevEarned || 0);
    rec.weeklyActivity = [wasActive, ...(rec.weeklyActivity || [])].slice(0, 8);
    rec._prevEarned = rec.totalEarned;

    rec.points = Math.max(0, rec.points - burn);
    rec.history = rec.history || [];
    rec.history.unshift({
      date: new Date().toISOString(),
      action: `Еженедельное списание (-${burn})`,
      delta: -burn,
      actorId: 'system'
    });
    rec.history = rec.history.slice(0, 50);

    if (rec.points <= 0)       { rec.status = 'kicked';  results.kicked.push(id); }
    else if (rec.points <= 5)  { rec.status = 'danger';  results.burned.push(id); }
    else if (rec.points <= 10) { rec.status = 'warning'; }
    else                        { rec.status = 'active';  }
  }

  data.lastWeeklyBurn = new Date().toISOString();
  save(data);
  return results;
}

// ── Auth helpers ──────────────────────────────────────────

function seedAdmin(login, password) {
  const data = load();
  if (!data.users[login.toLowerCase()]) {
    data.users[login.toLowerCase()] = {
      login: login,
      passwordHash: hashPassword(password),
      approved: true,
      role: 'admin',
      createdAt: new Date().toISOString()
    };
    save(data);
    console.log(`✅ Admin user "${login}" created`);
  }
}

function registerUser(login, password) {
  const data = load();
  const key = login.toLowerCase();
  if (data.users[key]) return { ok: false, error: 'Пользователь уже существует' };
  data.users[key] = {
    login,
    passwordHash: hashPassword(password),
    approved: false,
    role: 'user',
    createdAt: new Date().toISOString()
  };
  save(data);
  return { ok: true };
}

function loginUser(login, password) {
  const data = load();
  const user = data.users[login.toLowerCase()];
  if (!user) return { ok: false, error: 'Неверный логин или пароль' };
  if (user.passwordHash !== hashPassword(password)) return { ok: false, error: 'Неверный логин или пароль' };
  if (!user.approved) return { ok: false, error: 'pending', pending: true };

  // Generate session token
  const token = crypto.randomBytes(32).toString('hex');
  data.tokens[token] = { login: user.login, role: user.role, createdAt: Date.now() };
  save(data);
  return { ok: true, token, login: user.login, role: user.role };
}

function validateToken(token) {
  if (!token) return null;
  const data = load();
  const t = data.tokens[token];
  if (!t) return null;
  // Token expires in 30 days
  if (Date.now() - t.createdAt > 30 * 24 * 60 * 60 * 1000) {
    delete data.tokens[token];
    save(data);
    return null;
  }
  return t;
}

function approveUser(login) {
  const data = load();
  const user = data.users[login.toLowerCase()];
  if (!user) return false;
  user.approved = true;
  save(data);
  return true;
}

function getPendingUsers() {
  const data = load();
  return Object.values(data.users).filter(u => !u.approved).map(u => ({ login: u.login, createdAt: u.createdAt }));
}

function changePassword(login, oldPassword, newPassword) {
  const data = load();
  const user = data.users[login.toLowerCase()];
  if (!user) return { ok: false, error: 'Пользователь не найден' };
  if (user.passwordHash !== hashPassword(oldPassword)) return { ok: false, error: 'Неверный старый пароль' };
  user.passwordHash = hashPassword(newPassword);
  save(data);
  return { ok: true };
}

module.exports = {
  load, save, getAll, get, register, addPoints, remove,
  getConfig, setConfig, getRank, doWeeklyBurn, isCurator,
  seedAdmin, registerUser, loginUser, validateToken, approveUser,
  getPendingUsers, changePassword, hashPassword
};
