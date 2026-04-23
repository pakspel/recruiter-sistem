const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  recruiters: {},
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
      { name: 'Стажёр',  emoji: '🔰', min: 0   },
      { name: 'Рекрут',  emoji: '🎯', min: 30  },
      { name: 'Агент',   emoji: '⚡', min: 75  },
      { name: 'Элита',   emoji: '👑', min: 150 }
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
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Recruiter helpers ---

function getAll() {
  const data = load();
  return data.recruiters;
}

function get(userId) {
  const data = load();
  return data.recruiters[userId] || null;
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

  const recruiter = data.recruiters[userId];
  recruiter.points = Math.max(0, recruiter.points + amount);
  if (amount > 0) recruiter.totalEarned = (recruiter.totalEarned || 0) + amount;

  recruiter.history = recruiter.history || [];
  recruiter.history.unshift({
    date: new Date().toISOString(),
    action: reason,
    delta: amount,
    actorId
  });
  // Keep last 50 events
  recruiter.history = recruiter.history.slice(0, 50);

  // Update status
  if (recruiter.points <= 0) {
    recruiter.status = 'kicked';
  } else if (recruiter.points <= 5) {
    recruiter.status = 'danger';
  } else if (recruiter.points <= 10) {
    recruiter.status = 'warning';
  } else {
    recruiter.status = 'active';
  }

  save(data);
  return recruiter;
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
  const results = { burned: [], kicked: [] };

  for (const [id, rec] of Object.entries(data.recruiters)) {
    if (rec.status === 'kicked') continue;

    // Mark week activity
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

    if (rec.points <= 0) {
      rec.status = 'kicked';
      results.kicked.push(id);
    } else if (rec.points <= 5) {
      rec.status = 'danger';
      results.burned.push(id);
    } else if (rec.points <= 10) {
      rec.status = 'warning';
    } else {
      rec.status = 'active';
    }
  }

  data.lastWeeklyBurn = new Date().toISOString();
  save(data);
  return results;
}

module.exports = {
  load, save, getAll, get, register, addPoints, remove,
  getConfig, setConfig, getRank, doWeeklyBurn
};
