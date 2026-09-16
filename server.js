const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const dnpService = require('./dnpService');

const app = express();
const PORT = process.env.PORT || 4000;
const SYNC_TARGET_URL = process.env.SYNC_TARGET_URL || null;

app.use(express.json({ limit: '15mb' }));
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

// Global state for polling, sync, and watch target
const state = {
  activeWatch: {
    branch: '84',
    month: '10',
    year: '2026'
  },
  latestData: null,
  multiData: null,
  multiDataTime: null,
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
    const parkObj = parksList.find(p => p.code === String(branch));
    if (parkObj) freshData.parkName = parkObj.name;
    
    // Check diff for newly freed spots
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

    // If SYNC_TARGET_URL is configured (e.g. on NAS), forward data to Render.com!
    if (SYNC_TARGET_URL) {
      pushSyncToRemote(freshData);
    }
  } catch (err) {
    console.error(`[POLLER] ❌ Error during poll:`, err.message);
  } finally {
    state.isPolling = false;
  }
}

// Background poller for multi-parks every 3 minutes (if on NAS)
setInterval(async () => {
  if (!SYNC_TARGET_URL) return; // only run on NAS
  try {
    const targetParks = parksList.slice(0, 25);
    const multi = await dnpService.fetchMultiParks(targetParks, state.activeWatch.month, state.activeWatch.year);
    state.multiData = multi;
    state.multiDataTime = Date.now();
    pushSyncToRemote(multi);
  } catch (e) {
    //
  }
}, 3 * 60 * 1000);

// Helper: Push data to Render.com
async function pushSyncToRemote(data) {
  if (!SYNC_TARGET_URL) return;
  const target = SYNC_TARGET_URL.replace(/\/+$/, '');
  try {
    await axios.post(`${target}/api/sync`, {
      branch: data.isMulti ? 'all' : state.activeWatch.branch,
      month: state.activeWatch.month,
      year: state.activeWatch.year,
      data,
      recentAlerts: state.recentAlerts
    }, { timeout: 15000 });
    console.log(`[SYNC] 🚀 Successfully pushed ${data.isMulti ? 'MULTI-PARK' : 'single'} data to ${target}/api/sync`);
  } catch (err) {
    console.error(`[SYNC] ❌ Failed to push data to ${target}:`, err.message);
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

// API: Ingest / Sync data from NAS (Used on Render)
app.post('/api/sync', (req, res) => {
  const { branch, month, year, data, recentAlerts } = req.body;
  if (!data) {
    return res.status(400).json({ success: false, error: 'No data payload' });
  }

  if (data.isMulti || branch === 'all') {
    state.multiData = data;
    state.multiDataTime = Date.now();
    console.log(`[SYNC] 📥 Received MULTI-PARK sync from NAS (${data.parks ? data.parks.length : 0} parks)`);
    return res.json({ success: true, timestamp: Date.now() });
  }

  state.activeWatch = {
    branch: String(branch || data.branch || '84'),
    month: String(month || data.month || '10').padStart(2, '0'),
    year: String(year || data.year || '2026')
  };
  state.latestData = data;
  state.lastPollTime = Date.now();
  state.nextPollSeconds = 60;
  if (Array.isArray(recentAlerts)) {
    state.recentAlerts = recentAlerts;
  }

  console.log(`[SYNC] 📥 Received sync from NAS at ${new Date().toLocaleTimeString('th-TH')} for Branch ${state.activeWatch.branch}`);
  res.json({ success: true, timestamp: Date.now() });
});

// API: Get Parks List
app.get('/api/parks', (req, res) => {
  res.json({ success: true, parks: parksList });
});

// API: Get Availability (with cache and graceful fallback for foreign hosts)
app.get('/api/availability', async (req, res) => {
  const branch = req.query.branch || state.activeWatch.branch;
  const month = req.query.month || state.activeWatch.month;
  const year = req.query.year || state.activeWatch.year;

  // Case 1: Multi-parks request
  if (branch === 'all') {
    if (
      state.multiData &&
      state.multiData.month === String(month).padStart(2, '0') &&
      state.multiData.year === String(year) &&
      Date.now() - (state.multiDataTime || 0) < 90000
    ) {
      return res.json({ ...state.multiData, fromCache: true });
    }

    try {
      const targetParks = parksList.slice(0, 25);
      const multi = await dnpService.fetchMultiParks(targetParks, month, year);
      state.multiData = multi;
      state.multiDataTime = Date.now();
      if (SYNC_TARGET_URL) pushSyncToRemote(multi);
      return res.json({ ...multi, fromCache: false });
    } catch (err) {
      if (state.multiData) {
        return res.json({ ...state.multiData, fromCache: true });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Case 2: Single park from cache
  if (
    state.latestData &&
    state.activeWatch.branch === String(branch) &&
    state.activeWatch.month === String(month).padStart(2, '0') &&
    state.activeWatch.year === String(year) &&
    Date.now() - (state.lastPollTime || 0) < 45000
  ) {
    return res.json({
      ...state.latestData,
      fromCache: true,
      nextPollSeconds: state.nextPollSeconds
    });
  }

  // Case 3: Live fetch from DNP
  try {
    const data = await dnpService.fetchCalendarHold(branch, month, year);
    const parkObj = parksList.find(p => p.code === String(branch));
    if (parkObj) data.parkName = parkObj.name;

    if (
      state.activeWatch.branch === String(branch) &&
      state.activeWatch.month === String(month).padStart(2, '0') &&
      state.activeWatch.year === String(year)
    ) {
      state.latestData = data;
      state.lastPollTime = Date.now();
      state.nextPollSeconds = 60;
      if (SYNC_TARGET_URL) pushSyncToRemote(data);
    }
    res.json({ ...data, fromCache: false, nextPollSeconds: state.nextPollSeconds });
  } catch (err) {
    if (state.latestData) {
      console.warn(`[API] Live fetch error (${err.message}), serving latest synced data from NAS`);
      return res.json({
        ...state.latestData,
        fromCache: true,
        fallbackNote: 'ข้อมูลล่าสุดจากการ Sync ผ่าน NAS',
        nextPollSeconds: state.nextPollSeconds
      });
    }
    res.status(500).json({
      success: false,
      error: `ไม่สามารถเชื่อมต่อ DNP ได้ (${err.message}) และยังไม่มีข้อมูลที่ Sync จาก NAS`
    });
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
    hasMulti: !!state.multiData,
    recentAlerts: state.recentAlerts,
    isSyncSender: !!SYNC_TARGET_URL
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

  // Trigger poll immediately for new target
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

// Start Server
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🌲 DNP Camping Tracker Server is running on port ${PORT}!`);
  if (SYNC_TARGET_URL) {
    console.log(`📡 Sync Target Mode: Forwarding data to ${SYNC_TARGET_URL}`);
  }
  console.log(`=======================================================`);
  
  // Initial poll on startup
  if (!state.latestData) {
    runPoll();
  }
});
