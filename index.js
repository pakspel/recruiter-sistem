require('dotenv').config();
const cron = require('node-cron');
const { startBot } = require('./bot');
const { startServer } = require('./server');
const storage = require('./storage');

startServer();
startBot();

// Seed superadmin account on startup
const SUPER_ADMIN_LOGIN    = process.env.SUPER_ADMIN_LOGIN;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

if (!SUPER_ADMIN_LOGIN || !SUPER_ADMIN_PASSWORD) {
  console.error('FATAL: SUPER_ADMIN_LOGIN и SUPER_ADMIN_PASSWORD должны быть заданы в .env');
  process.exit(1);
}

try {
  storage.seedAdmin(SUPER_ADMIN_LOGIN, SUPER_ADMIN_PASSWORD);
} catch (e) {
  console.error('seedAdmin error:', e.message);
}

// Every Monday at 12:00 — weekly burn
cron.schedule('0 12 * * 1', () => {
  console.log('⏳ Running weekly burn...');
  try {
    const results = storage.doWeeklyBurn();
    console.log(`Weekly burn done. Kicked: ${results.kicked.length}, Danger: ${results.burned.length}, Curators skipped: ${results.skippedCurators.length}`);
  } catch (e) {
    console.error('Weekly burn error:', e.message);
  }
});

console.log('🚀 Recruiter System started');

process.on('SIGTERM', () => {
  console.log('SIGTERM получен, завершаем...');
  process.exit(0);
});
