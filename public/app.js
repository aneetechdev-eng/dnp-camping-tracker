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

const dateFromSelect = document.getElementById('dateFromSelect');
const dateToSelect = document.getElementById('dateToSelect');
const nightsSelect = document.getElementById('nightsSelect');
const btnResetDates = document.getElementById('btnResetDates');

const radioFilters = document.getElementsByName('filterMode');
const checkWeekendOnly = document.getElementById('checkWeekendOnly');
const inputMinSeats = document.getElementById('inputMinSeats');

const countAvailable = document.getElementById('countAvailable');
const countAll = document.getElementById('countAll');
const summaryText = document.getElementById('summaryText');
const alertBox = document.getElementById('alertBox');

const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const dnpStripBox = document.getElementById('dnpStripBox');
const stripTable = document.getElementById('stripTable');

// Populate Date Options (1 - 31)
function populateDateDropdowns(month, year) {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  const daysInMonth = new Date(y, m, 0).getDate();

  const prevFrom = dateFromSelect.value;
  const prevTo = dateToSelect.value;

  dateFromSelect.innerHTML = '<option value="">-- วันเริ่มต้น --</option>';
  dateToSelect.innerHTML = '<option value="">-- วันสิ้นสุด --</option>';

  for (let d = 1; d <= daysInMonth; d++) {
    const optFrom = document.createElement('option');
    optFrom.value = String(d);
    optFrom.textContent = `วันที่ ${d}`;
    if (String(d) === prevFrom) optFrom.selected = true;
    dateFromSelect.appendChild(optFrom);

    const optTo = document.createElement('option');
    optTo.value = String(d);
    optTo.textContent = `วันที่ ${d}`;
    if (String(d) === prevTo) optTo.selected = true;
    dateToSelect.appendChild(optTo);
  }
}

// Load Parks
async function loadParks() {
  try {
    const res = await fetch('/api/parks');
    const data = await res.json();
    if (data.parks) {
      parkSelect.innerHTML = '<option value="all">⭐ อุทยานแห่งชาติทั้งหมด (ค้นหาทุกอุทยาน)</option>';
      data.parks.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.code;
        opt.textContent = p.name;
        if (p.code === '84') opt.selected = true; // ภูสอยดาว default
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

  populateDateDropdowns(month, year);

  if (!rawData) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px;">กำลังโหลดข้อมูลล่าสุด...</td></tr>`;
  }

  try {
    const res = await fetch(`/api/availability?branch=${branch}&month=${month}&year=${year}`);
    const data = await res.json();

    if (data.success) {
      rawData = data;
      lastUpdateTime.textContent = data.updatedAtText || new Date().toLocaleTimeString('th-TH');
      countdown = data.nextPollSeconds || 60;
      render();
    } else {
      // Check poll fallback
      const pollRes = await fetch('/api/poll');
      const pollData = await pollRes.json();
      if (pollData.latestData && (pollData.latestData.zones || pollData.latestData.parks)) {
        rawData = pollData.latestData;
        lastUpdateTime.textContent = rawData.updatedAtText || new Date().toLocaleTimeString('th-TH');
        countdown = pollData.nextPollSeconds || 60;
        render();
      } else {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #b91c1c; padding: 20px;">${data.error || 'กำลังรอข้อมูล Sync รอบแรกจาก NAS...'}</td></tr>`;
      }
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #b91c1c; padding: 20px;">เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}</td></tr>`;
  }
}

// Helper: Check consecutive nights availability
function isConsecutiveAvailable(daysList, startIndex, nights, minSeats) {
  if (startIndex + nights > daysList.length) return false;
  for (let i = 0; i < nights; i++) {
    const day = daysList[startIndex + i];
    if (!day.isAvailable || day.available < minSeats) {
      return false;
    }
  }
  return true;
}

// Helper: Format consecutive stay details
function formatRowDetails(d, allDays, idx, nights, monthName, buddhistYear) {
  if (nights <= 1 || !d.isAvailable) {
    let badge = `<span class="badge badge-green">ว่าง</span>`;
    let numDisplay = `<span class="num-available">ว่าง ${d.available} ที่</span>`;

    if (d.isFull) {
      badge = `<span class="badge badge-red">เต็มแล้ว</span>`;
      numDisplay = `<span class="num-full">0 ที่ (เต็ม)</span>`;
    } else if (d.status === 'warning') {
      badge = `<span class="badge badge-yellow">ใกล้เต็ม</span>`;
      numDisplay = `<span class="num-available" style="color: #d97706;">ว่าง ${d.available} ที่</span>`;
    }

    return {
      badge,
      dateHtml: `<b>${d.thaiDate}</b>`,
      dayHtml: `วัน${d.dayName} ${d.isWeekend ? '(ส.-อา.)' : ''}`,
      numHtml: numDisplay,
      bookedHtml: `จองแล้ว <b>${d.booked}</b> / ${d.capacity} คน`
    };
  }

  // Consecutive nights formatting
  const stayDays = allDays.slice(idx, idx + nights);
  const minAvailable = Math.min(...stayDays.map(s => s.available));
  const checkoutDayObj = allDays[idx + nights];
  const checkoutDayNum = checkoutDayObj ? checkoutDayObj.day : (d.day + nights);
  const checkoutDayName = checkoutDayObj ? `วัน${checkoutDayObj.dayName}` : '';
  const mName = monthName || 'ต.ค.';

  const badge = `<span class="badge badge-green">ว่าง ${nights} คืน ✓</span>`;

  const dateHtml = `
    <div style="font-size: 0.92rem; font-weight: 700; color: #0f172a; white-space: nowrap;">
      เข้า ${d.day} ➔ ออก ${checkoutDayNum} ${mName}
    </div>
    <div style="font-size: 0.75rem; color: #0284c7; font-weight: 600; margin-top: 2px;">
      (พัก ${nights} คืน)
    </div>
  `;

  const dayHtml = `
    <div style="font-weight: 600; color: #1e293b;">วัน${d.dayName}</div>
    <div style="font-size: 0.72rem; color: #64748b;">ถึง ${checkoutDayName}</div>
  `;

  const breakdownLines = stayDays.map((st, i) => 
    `<div style="font-size: 0.75rem; color: #334155; line-height: 1.35;">• <b>คืน ${i + 1} (${st.day} ${mName}):</b> ว่าง <span style="color: #059669; font-weight: 700;">${st.available}</span> ที่</div>`
  ).join('');

  const numHtml = `
    <div class="num-available" style="font-size: 0.92rem;">ว่างขั้นต่ำ <b>${minAvailable}</b> ที่</div>
    <div style="margin-top: 4px; padding: 4px 6px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; text-align: left;">
      ${breakdownLines}
    </div>
  `;

  const bookedHtml = `
    <div style="font-size: 0.75rem; color: #475569; text-align: left;">
      ${stayDays.map((st, i) => `<div>• คืน ${i+1}: ${st.booked}/${st.capacity}</div>`).join('')}
    </div>
  `;

  return {
    badge,
    dateHtml,
    dayHtml,
    numHtml,
    bookedHtml
  };
}

// Main Render Logic
function render() {
  if (!rawData) return;

  const isMulti = rawData.isMulti || Array.isArray(rawData.parks);
  const minSeats = parseInt(inputMinSeats.value, 10) || 1;
  const nights = parseInt(nightsSelect.value, 10) || 1;
  const fromDay = dateFromSelect.value ? parseInt(dateFromSelect.value, 10) : null;
  const toDay = dateToSelect.value ? parseInt(dateToSelect.value, 10) : null;

  let filterMode = 'available';
  for (const r of radioFilters) {
    if (r.checked) filterMode = r.value;
  }
  const weekendOnly = checkWeekendOnly.checked;

  // Dynamically update table headers when nights > 1
  const thDate = document.querySelector('#tableHead th:nth-child(2)');
  const thSeats = document.querySelector('#tableHead th:nth-child(5)');
  if (thDate && thSeats) {
    if (nights > 1) {
      thDate.innerHTML = `ช่วงวันพัก (${nights} คืน)<br><span style="font-size: 0.72rem; font-weight: normal; color: #475569;">เข้า ➔ ออก</span>`;
      thSeats.innerHTML = `ที่ว่างต่อเนื่อง<br><span style="font-size: 0.72rem; font-weight: normal; color: #475569;">(ต่ำสุด / รายคืน)</span>`;
    } else {
      thDate.textContent = 'วันที่';
      thSeats.textContent = 'จำนวนที่ว่าง';
    }
  }

  if (isMulti) {
    renderMultiParks(rawData.parks, { filterMode, weekendOnly, minSeats, nights, fromDay, toDay });
    dnpStripBox.style.display = 'none';
  } else {
    renderSinglePark(rawData, { filterMode, weekendOnly, minSeats, nights, fromDay, toDay });
    dnpStripBox.style.display = 'block';
  }
}

// Render Single Park
function renderSinglePark(data, filters) {
  const { filterMode, weekendOnly, minSeats, nights, fromDay, toDay } = filters;
  const zone = data.zones && data.zones[0];
  if (!zone) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;">ไม่มีข้อมูลพื้นที่กางเต็นท์ในอุทยานนี้</td></tr>`;
    summaryText.textContent = 'ไม่มีข้อมูล';
    return;
  }

  const parkName = data.parkName || (parkSelect.options[parkSelect.selectedIndex] ? parkSelect.options[parkSelect.selectedIndex].text : 'อุทยานแห่งชาติ');
  const allDays = zone.days;

  // Filter days
  const filtered = [];
  allDays.forEach((d, idx) => {
    // Date range filter
    if (fromDay !== null && d.day < fromDay) return;
    if (toDay !== null && d.day > toDay) return;

    // Weekend filter
    if (weekendOnly && !d.isWeekend) return;

    // Min seats & available mode
    if (filterMode === 'available') {
      if (!d.isAvailable || d.available < minSeats) return;
      // Consecutive nights check
      if (nights > 1 && !isConsecutiveAvailable(allDays, idx, nights, minSeats)) {
        return;
      }
    }

    filtered.push({ day: d, idx });
  });

  countAll.textContent = allDays.length;
  countAvailable.textContent = zone.totalAvailableDays;

  // Summary Text
  let rangeDesc = '';
  if (fromDay && toDay) {
    rangeDesc = ` | กรองช่วง: <b>วันที่ ${fromDay} - ${toDay} ${data.monthName}</b>`;
  } else if (fromDay) {
    rangeDesc = ` | ตั้งแต่วันที่: <b>${fromDay} ${data.monthName} เป็นต้นไป</b>`;
  } else if (toDay) {
    rangeDesc = ` | ถึงวันที่: <b>${toDay} ${data.monthName}</b>`;
  }

  let stayDesc = nights > 1 ? ` | พักต่อเนื่อง: <b>${nights} คืน</b>` : '';

  summaryText.innerHTML = `
    <b>${parkName}</b> — <b>${zone.zoneName}</b> (ความจุ: ${zone.capacity} คน) | 
    เดือน ${data.monthName} ${data.buddhistYear} | 
    มีที่ว่าง: <b style="color: #059669;">${zone.totalAvailableDays} วัน</b> | 
    เต็มแล้ว: <b style="color: #dc2626;">${zone.totalFullDays} วัน</b>
    ${rangeDesc}${stayDesc}
  `;

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: #666;">ไม่พบวันที่ตรงตามเงื่อนไข (ลองเปลี่ยนช่วงวัน หรือลดจำนวนคืนที่พัก)</td></tr>`;
  } else {
    tableBody.innerHTML = filtered.map(({ day: d, idx }) => {
      const rowClass = d.isFull ? 'row-full' : 'row-available';
      const weekendClass = d.isWeekend ? 'row-weekend' : '';
      const formatted = formatRowDetails(d, allDays, idx, nights, data.monthName, data.buddhistYear);

      return `
        <tr class="${rowClass} ${weekendClass}">
          <td><b>${parkName}</b></td>
          <td>${formatted.dateHtml}</td>
          <td class="col-day">${formatted.dayHtml}</td>
          <td>${formatted.badge}</td>
          <td>${formatted.numHtml}</td>
          <td>${formatted.bookedHtml}</td>
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

  renderDnpStrip(zone);
}

// Render Multi Parks
function renderMultiParks(parks, filters) {
  const { filterMode, weekendOnly, minSeats, nights, fromDay, toDay } = filters;

  const rows = [];
  let totalAvailableSlots = 0;

  parks.forEach(p => {
    const parkName = p.parkName || p.branch;
    if (!p.zones) return;

    p.zones.forEach(zone => {
      const allDays = zone.days;
      allDays.forEach((d, idx) => {
        // Date range
        if (fromDay !== null && d.day < fromDay) return;
        if (toDay !== null && d.day > toDay) return;

        // Weekend
        if (weekendOnly && !d.isWeekend) return;

        // Min seats & available
        if (filterMode === 'available') {
          if (!d.isAvailable || d.available < minSeats) return;
          if (nights > 1 && !isConsecutiveAvailable(allDays, idx, nights, minSeats)) return;
        }

        if (d.isAvailable) totalAvailableSlots++;

        rows.push({
          parkName,
          zoneName: zone.zoneName,
          capacity: zone.capacity,
          day: d,
          allDays,
          idx
        });
      });
    });
  });

  countAll.textContent = rows.length;
  countAvailable.textContent = totalAvailableSlots;

  summaryText.innerHTML = `
    ⭐ <b>ค้นหาทุกอุทยานแห่งชาติ</b> (พบพื้นที่กางเต็นท์ใน ${parks.length} อุทยาน) | 
    ผลการค้นหาตามเงื่อนไข: <b style="color: #059669;">${rows.length} รายการ</b> 
    ${nights > 1 ? `| พักต่อเนื่อง: <b>${nights} คืน</b>` : ''}
    ${fromDay && toDay ? `| ช่วงวันที่: <b>${fromDay} - ${toDay}</b>` : ''}
  `;

  if (rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: #666;">ไม่พบอุทยานที่ว่างตามเงื่อนไขที่เลือก (ลองเปลี่ยนช่วงวัน หรือลดจำนวนคืนที่พัก)</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map(r => {
    const d = r.day;
    const rowClass = d.isFull ? 'row-full' : 'row-available';
    const weekendClass = d.isWeekend ? 'row-weekend' : '';
    const formatted = formatRowDetails(d, r.allDays, r.idx, nights, (rawData && rawData.monthName) || 'ต.ค.', (rawData && rawData.buddhistYear) || '2569');

    return `
      <tr class="${rowClass} ${weekendClass}">
        <td><b style="color: #005c9c;">${r.parkName}</b></td>
        <td>${formatted.dateHtml}</td>
        <td class="col-day">${formatted.dayHtml}</td>
        <td>${formatted.badge}</td>
        <td>${formatted.numHtml}</td>
        <td>${formatted.bookedHtml}</td>
        <td>${r.zoneName}</td>
        <td>
          ${d.isFull 
            ? '<span style="color:#aaa; font-size: 0.8rem;">-</span>' 
            : '<a href="https://nps.dnp.go.th/reservation.php?option=area" target="_blank" class="btn-book">จอง ➔</a>'}
        </td>
      </tr>
    `;
  }).join('');
}

// Render DNP Strip Table
function renderDnpStrip(zone) {
  let htmlHeader = '<tr><th style="font-weight: 600; text-align: left; padding: 5px 8px; background: #e2e8f0;">กำลังจอง+จองแล้ว/ทั้งหมด</th>';
  let htmlRow = `<tr><td style="text-align: left; padding: 5px 8px; font-weight: 600; background: #f8fafc;">${zone.zoneName}</td>`;

  const mName = (rawData && rawData.monthName) ? rawData.monthName.substring(0, 4) : 'ต.ค.';
  const bYear = (rawData && rawData.buddhistYear) ? rawData.buddhistYear : '2569';

  zone.days.forEach(d => {
    const isWk = d.isWeekend;
    const headerClass = isWk ? 'weekend-header' : '';
    htmlHeader += `
      <th class="${headerClass}">
        <b>${d.day}</b><br>
        <span style="color: ${isWk ? '#d97706' : '#dc2626'};">${mName}</span><br>
        <span style="font-size: 0.72rem; color: #888;">${bYear}</span>
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
    countdown = 60;
    countdownSec.textContent = countdown;
    fetchData();
  }
}, 1000);

// Alert checker
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
btnSearch.addEventListener('click', fetchData);
btnRefresh.addEventListener('click', () => {
  countdown = 60;
  countdownSec.textContent = countdown;
  fetchData();
});

parkSelect.addEventListener('change', () => {
  fetchData();
});

monthSelect.addEventListener('change', () => {
  populateDateDropdowns(monthSelect.value, yearSelect.value);
  fetchData();
});

yearSelect.addEventListener('change', () => {
  populateDateDropdowns(monthSelect.value, yearSelect.value);
  fetchData();
});

dateFromSelect.addEventListener('change', render);
dateToSelect.addEventListener('change', render);
nightsSelect.addEventListener('change', render);

btnResetDates.addEventListener('click', () => {
  dateFromSelect.value = '';
  dateToSelect.value = '';
  nightsSelect.value = '1';
  render();
});

for (const r of radioFilters) {
  r.addEventListener('change', render);
}
checkWeekendOnly.addEventListener('change', render);
inputMinSeats.addEventListener('input', render);

// Init
(async function init() {
  populateDateDropdowns('10', '2026');
  await loadParks();
  fetchData();
})();
