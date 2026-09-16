// State
let rawData = null;
let countdown = 60;

// Elements
const parkSelect = document.getElementById('parkSelect');
const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');
const btnSearch = document.getElementById('btnSearch');
const btnRefresh = document.getElementById('btnRefresh');
const lastUpdateTime = document.getElementById('lastUpdateTime');
const countdownSec = document.getElementById('countdownSec');

const radioFilters = document.getElementsByName('filterMode');
const checkWeekendOnly = document.getElementById('checkWeekendOnly');
const inputMinSeats = document.getElementById('inputMinSeats');

const countAvailable = document.getElementById('countAvailable');
const countAll = document.getElementById('countAll');
const summaryText = document.getElementById('summaryText');
const alertBox = document.getElementById('alertBox');

const tableBody = document.getElementById('tableBody');
const stripTable = document.getElementById('stripTable');

// Load Parks
async function loadParks() {
  try {
    const res = await fetch('/api/parks');
    const data = await res.json();
    if (data.parks) {
      parkSelect.innerHTML = '';
      data.parks.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.code;
        opt.textContent = p.name;
        if (p.code === '84') opt.selected = true; // ภูสอยดาว
        parkSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error loading parks:', err);
  }
}

// Fetch Data
async function fetchData() {
  const branch = parkSelect.value;
  const month = monthSelect.value;
  const year = yearSelect.value;

  tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">กำลังดึงข้อมูลล่าสุดจาก DNP...</td></tr>`;

  try {
    const res = await fetch(`/api/availability?branch=${branch}&month=${month}&year=${year}`);
    const data = await res.json();

    if (data.success && data.zones) {
      rawData = data;
      lastUpdateTime.textContent = data.updatedAtText || new Date().toLocaleTimeString('th-TH');
      countdown = data.nextPollSeconds || 60;
      render();
    } else {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 20px;">${data.error || 'ไม่พบข้อมูลพื้นที่กางเต็นท์'}</td></tr>`;
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 20px;">เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}</td></tr>`;
  }
}

// Render Data
function render() {
  if (!rawData || !rawData.zones || rawData.zones.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">ไม่มีข้อมูลพื้นที่กางเต็นท์ในอุทยานนี้</td></tr>`;
    summaryText.textContent = 'ไม่มีข้อมูล';
    return;
  }

  const zone = rawData.zones[0];
  const totalDays = zone.days.length;
  const totalAvailable = zone.totalAvailableDays;
  const totalFull = zone.totalFullDays;

  countAll.textContent = totalDays;
  countAvailable.textContent = totalAvailable;

  summaryText.innerHTML = `
    <b>${zone.zoneName}</b> (${parkSelect.options[parkSelect.selectedIndex].text}) — 
    เดือน ${rawData.monthName} ${rawData.buddhistYear} | ความจุ: <b>${zone.capacity} คน</b> | 
    มีที่ว่าง: <b style="color: #059669;">${totalAvailable} วัน</b> | เต็มแล้ว: <b style="color: #dc2626;">${totalFull} วัน</b>
  `;

  // Get active filter
  let filterMode = 'available';
  for (const r of radioFilters) {
    if (r.checked) filterMode = r.value;
  }
  const weekendOnly = checkWeekendOnly.checked;
  const minSeats = parseInt(inputMinSeats.value, 10) || 1;

  // Filter rows
  const filtered = zone.days.filter(d => {
    if (weekendOnly && !d.isWeekend) return false;
    if (filterMode === 'available') {
      return d.isAvailable && d.available >= minSeats;
    }
    return true; // 'all'
  });

  // Render Main Table
  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: #666;">ไม่พบวันที่ตรงตามเงื่อนไขตัวกรอง (ลองเลือก "แสดงทุกวัน" หรือลดจำนวนที่ว่างขั้นต่ำ)</td></tr>`;
  } else {
    tableBody.innerHTML = filtered.map(d => {
      const rowClass = d.isFull ? 'row-full' : 'row-available';
      const weekendClass = d.isWeekend ? 'row-weekend' : '';
      
      let badge = `<span class="badge badge-green">ว่าง</span>`;
      let numDisplay = `<span class="num-available">ว่าง ${d.available} ที่</span>`;

      if (d.isFull) {
        badge = `<span class="badge badge-red">เต็มแล้ว</span>`;
        numDisplay = `<span class="num-full">0 ที่ (เต็ม)</span>`;
      } else if (d.status === 'warning') {
        badge = `<span class="badge badge-yellow">ใกล้เต็ม</span>`;
        numDisplay = `<span class="num-available" style="color: #d97706;">ว่าง ${d.available} ที่</span>`;
      }

      return `
        <tr class="${rowClass} ${weekendClass}">
          <td><b>${d.thaiDate}</b></td>
          <td class="col-day">วัน${d.dayName} ${d.isWeekend ? '(ส.-อา.)' : ''}</td>
          <td>${badge}</td>
          <td>${numDisplay}</td>
          <td>จองแล้ว <b>${d.booked}</b> / ${d.capacity} คน</td>
          <td>${zone.zoneName}</td>
          <td>
            ${d.isFull 
              ? '<span style="color:#aaa; font-size: 0.8rem;">-</span>' 
              : '<a href="https://nps.dnp.go.th/reservation.php?option=area" target="_blank" class="btn-book">จอง ➔</a>'}
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Horizontal Strip (Like DNP screenshot)
  renderDnpStrip(zone);
}

// Render Horizontal Strip like DNP table
function renderDnpStrip(zone) {
  let htmlHeader = '<tr><th style="font-weight: 600; text-align: left; padding: 5px 8px; background: #e2e8f0;">กำลังจอง+จองแล้ว/ทั้งหมด</th>';
  let htmlRow = `<tr><td style="text-align: left; padding: 5px 8px; font-weight: 600; background: #f8fafc;">${zone.zoneName}</td>`;

  zone.days.forEach(d => {
    const isWk = d.isWeekend;
    const headerClass = isWk ? 'weekend-header' : '';
    htmlHeader += `
      <th class="${headerClass}">
        <b>${d.day}</b><br>
        <span style="color: ${isWk ? '#d97706' : '#dc2626'};">${rawData.monthName.substring(0, 4)}</span><br>
        <span style="font-size: 0.72rem; color: #888;">${rawData.buddhistYear}</span>
      </th>
    `;

    const cellClass = d.isFull ? 'cell-red' : 'cell-green';
    htmlRow += `
      <td class="${cellClass}" title="${d.thaiDate}: จองแล้ว ${d.booked} / ทั้งหมด ${d.capacity} (ว่าง ${d.available})">
        ${d.booked}/${d.capacity}
      </td>
    `;
  });

  htmlHeader += '</tr>';
  htmlRow += '</tr>';
  stripTable.innerHTML = htmlHeader + htmlRow;
}

// 1-minute poller tick
setInterval(() => {
  if (countdown > 0) {
    countdown--;
    countdownSec.textContent = countdown;
  } else {
    // Poll now!
    countdown = 60;
    countdownSec.textContent = countdown;
    fetchData();
  }
}, 1000);

// Check for server-side alert diffs every 4 seconds
setInterval(async () => {
  try {
    const res = await fetch('/api/poll');
    const poll = await res.json();
    if (poll.recentAlerts && poll.recentAlerts.length > 0) {
      const a = poll.recentAlerts[0];
      const spotList = a.spots.map(s => `${s.thaiDate} (${s.dayName}): ว่าง ${s.available} ที่`).join(' | ');
      alertBox.innerHTML = `🔔 <b>พบที่ว่างหลุดจองล่าสุด (${a.timeText} น.):</b> ${spotList} <a href="https://nps.dnp.go.th/reservation.php?option=area" target="_blank" style="margin-left: 10px; font-weight: bold; color: #005c9c;">กดจองทันที ➔</a>`;
      alertBox.style.display = 'block';
    }
  } catch (e) {}
}, 4000);

// Event Listeners
btnSearch.addEventListener('click', () => {
  fetchData();
});

btnRefresh.addEventListener('click', () => {
  countdown = 60;
  countdownSec.textContent = countdown;
  fetchData();
});

for (const r of radioFilters) {
  r.addEventListener('change', render);
}
checkWeekendOnly.addEventListener('change', render);
inputMinSeats.addEventListener('input', render);

// Init
(async function init() {
  await loadParks();
  fetchData();
})();
