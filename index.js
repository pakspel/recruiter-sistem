require('dotenv').config();
const cron = require('node-cron');
const { startBot } = require('./bot');
const { startServer } = require('./server');
const storage = require('./storage');

startServer();
startBot();

// Every Monday at 12:00 — weekly burn
cron.schedule('0 12 * * 1', () => {
  console.log('⏳ Running weekly burn...');
  const results = storage.doWeeklyBurn();
  console.log(`Weekly burn done. Kicked: ${results.kicked.length}, Danger: ${results.burned.length}`);
});

console.log('🚀 Recruiter System started');
