const express = require('express');
const path = require('path');
const fs = require('fs');
const dnpService = require('./dnpService');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load parks list
let parksList = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'parks.json'), 'utf-8');
  parksList = JSON.parse(raw);
} catch (e) {
  console.warn('Warning: Could not load parks.json, using fallback');
  parksList = [{ code: '84', name: 'อช.ภูสอยดาว' }];
}

// Global state for polling and watch target
const state = {
  activeWatch: {
    branch: '84',
    month: '10',
    year: '2026'
  },
  latestData: null,
  previousData: null,
  lastPollTime: null,
  nextPollSeconds: 60,
  pollIntervalMs: 60 * 1000, // 1 minute
  recentAlerts: [],
  isPolling: false
};

// Polling execution
async function runPoll() {
  if (state.isPolling) return;
  state.isPolling = true;

  const { branch, month, year } = state.activeWatch;
  console.log(`[POLLER] 🔄 Polling DNP at ${new Date().toLocaleTimeString('th-TH')} for Branch: ${branch}, ${month}/${year}`);

  try {
    const freshData = await dnpService.fetchCalendarHold(branch, month, year);
    
    // Check diff for newly freed slots
    if (state.latestData) {
      const diff = dnpService.checkDiff(state.latestData, freshData);
      if (diff.hasChanges) {
        console.log(`[ALERT] 🔔 FOUND FREED SPOTS!`, diff.freedSpots);
        const alertItem = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          timeText: new Date().toLocaleTimeString('th-TH'),
          spots: diff.freedSpots
        };
        state.recentAlerts.unshift(alertItem);
        if (state.recentAlerts.length > 20) state.recentAlerts.pop();
      }
    }

    state.previousData = state.latestData;
    state.latestData = freshData;
    state.lastPollTime = Date.now();
    state.nextPollSeconds = 60;
  } catch (err) {
    console.error(`[POLLER] ❌ Error during poll:`, err.message);
  } finally {
    state.isPolling = false;
  }
}

// Start background poller every 60s
setInterval(runPoll, state.pollIntervalMs);

// Countdown timer ticker for client sync
setInterval(() => {
  if (state.lastPollTime) {
    const elapsedSec = Math.floor((Date.now() - state.lastPollTime) / 1000);
    state.nextPollSeconds = Math.max(0, 60 - elapsedSec);
  }
}, 1000);

// API: Get Parks List
app.get('/api/parks', (req, res) => {
  res.json({ success: true, parks: parksList });
});

// API: Get Live / Filtered Availability on-demand
app.get('/api/availability', async (req, res) => {
  const branch = req.query.branch || state.activeWatch.branch;
  const month = req.query.month || state.activeWatch.month;
  const year = req.query.year || state.activeWatch.year;

  // If matches currently watched target and is fresh (< 30s old), return cached
  if (
    state.latestData &&
    state.activeWatch.branch === String(branch) &&
    state.activeWatch.month === String(month).padStart(2, '0') &&
    state.activeWatch.year === String(year) &&
    Date.now() - (state.lastPollTime || 0) < 30000
  ) {
    return res.json({
      ...state.latestData,
      fromCache: true,
      nextPollSeconds: state.nextPollSeconds
    });
  }

  try {
    const data = await dnpService.fetchCalendarHold(branch, month, year);
    // If user queried the current active watch, update state
    if (
      state.activeWatch.branch === String(branch) &&
      state.activeWatch.month === String(month).padStart(2, '0') &&
      state.activeWatch.year === String(year)
    ) {
      state.latestData = data;
      state.lastPollTime = Date.now();
      state.nextPollSeconds = 60;
    }
    res.json({ ...data, fromCache: false, nextPollSeconds: state.nextPollSeconds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get Poll Status
app.get('/api/poll', (req, res) => {
  res.json({
    success: true,
    activeWatch: state.activeWatch,
    lastPollTime: state.lastPollTime,
    nextPollSeconds: state.nextPollSeconds,
    latestData: state.latestData,
    recentAlerts: state.recentAlerts
  });
});

// API: Update Watch Target
app.post('/api/watch', async (req, res) => {
  const { branch, month, year } = req.body;
  if (!branch || !month || !year) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

  state.activeWatch = {
    branch: String(branch),
    month: String(month).padStart(2, '0'),
    year: String(year)
  };
  state.latestData = null;
  state.recentAlerts = [];

  // Run poll immediately for new target
  await runPoll();

  res.json({
    success: true,
    activeWatch: state.activeWatch,
    latestData: state.latestData
  });
});

// API: Force instant refresh
app.post('/api/refresh', async (req, res) => {
  await runPoll();
  res.json({
    success: true,
    latestData: state.latestData,
    nextPollSeconds: 60
  });
});

// API: Clear alert history
app.post('/api/alerts/clear', (req, res) => {
  state.recentAlerts = [];
  res.json({ success: true });
});

// Start Server and trigger initial poll
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🌲 DNP Camping Tracker Server is running!`);
  console.log(`🌐 Local Web Dashboard: http://localhost:${PORT}`);
  console.log(`⏰ Polling interval: every 1 minute (60 seconds)`);
  console.log(`=======================================================`);
  
  // Initial poll on startup
  runPoll();
});
