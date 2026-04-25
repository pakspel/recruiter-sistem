require('dotenv').config();
const cron = require('node-cron');
const { startBot } = require('./bot');
const { startServer } = require('./server');
const storage = require('./storage');

startServer();
startBot();

// Seed admin account on startup
try {
  storage.seedAdmin('PAKSPEL', '1203Anime');
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
