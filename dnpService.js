const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

class DnpService {
  constructor() {
    this.sessionCookie = null;
    this.cookieExpires = 0;
    this.lastWatchResult = null;
    this.lastCheckedTime = null;
  }

  // Get or refresh PHPSESSID session
  async getSession() {
    const now = Date.now();
    if (this.sessionCookie && now < this.cookieExpires) {
      return this.sessionCookie;
    }

    try {
      const res = await axios.get('https://nps.dnp.go.th/hold.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        httpsAgent,
        timeout: 10000
      });

      const setCookies = res.headers['set-cookie'];
      if (setCookies) {
        for (const cookieStr of setCookies) {
          if (cookieStr.includes('PHPSESSID=')) {
            const match = cookieStr.match(/PHPSESSID=([^;]+)/);
            if (match) {
              this.sessionCookie = `PHPSESSID=${match[1]}`;
              this.cookieExpires = now + (20 * 60 * 1000); // 20 minutes
              return this.sessionCookie;
            }
          }
        }
      }
      return this.sessionCookie || '';
    } catch (err) {
      console.error('[DNP] Error getting session:', err.message);
      return this.sessionCookie || '';
    }
  }

  // Fetch calendar hold data from DNP
  async fetchCalendarHold(branch = '84', month = '10', year = '2026') {
    const cookie = await this.getSession();
    const url = 'https://nps.dnp.go.th/creation/module/booking/booking.inc.php?mode=LoadCalendarHold';
    
    // Format parameters
    const padMonth = String(month).padStart(2, '0');
    const strYear = String(year);
    const strBranch = String(branch);

    const params = new URLSearchParams();
    params.append('month', padMonth);
    params.append('year', strYear);
    params.append('branch', strBranch);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://nps.dnp.go.th',
      'Referer': 'https://nps.dnp.go.th/hold.php'
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    try {
      const res = await axios.post(url, params.toString(), {
        headers,
        httpsAgent,
        timeout: 12000
      });

      return this.parseAvailabilityData(res.data, {
        branch: strBranch,
        month: padMonth,
        year: strYear
      });
    } catch (err) {
      console.error('[DNP] Fetch error:', err.message);
      // Reset session cookie in case it expired or failed
      this.sessionCookie = null;
      throw err;
    }
  }

  // Parse and calculate availability
  parseAvailabilityData(data, queryInfo) {
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const thaiMonthsFull = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

    const area = data?.room?.area || {};
    const areaList = Array.isArray(area.data) ? area.data : [];
    const bookMap = area.book || {};

    const monthNum = parseInt(queryInfo.month, 10);
    const yearNum = parseInt(queryInfo.year, 10);
    const buddhistYear = yearNum + 543;

    // Number of days in this month
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    // Process each camping area/zone
    const zones = areaList.map(zone => {
      const zoneCode = String(zone.code);
      const capacity = parseInt(zone.quantity, 10) || 0;
      const zoneBookings = bookMap[zoneCode] || {};

      const days = [];
      let totalAvailableDays = 0;
      let totalFullDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const padDay = String(d).padStart(2, '0');
        const dateKey = `${yearNum}${queryInfo.month}${padDay}`;
        const isoDate = `${yearNum}-${queryInfo.month}-${padDay}`;
        const dateObj = new Date(yearNum, monthNum - 1, d);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // Sun=0, Sat=6

        const bookRecord = zoneBookings[dateKey];
        const bookedCount = bookRecord ? (parseInt(bookRecord.qty_date, 10) || 0) : 0;
        const availableCount = Math.max(0, capacity - bookedCount);
        const isFull = availableCount === 0 || bookedCount >= capacity;
        const isAvailable = !isFull && availableCount > 0;
        const percentBooked = capacity > 0 ? Math.min(100, Math.round((bookedCount / capacity) * 100)) : 100;

        let status = 'available';
        if (isFull) {
          status = 'full';
          totalFullDays++;
        } else {
          totalAvailableDays++;
          if (availableCount <= 20 || percentBooked >= 85) {
            status = 'warning';
          }
        }

        days.push({
          day: d,
          dateKey,
          isoDate,
          dayName: thaiDays[dayOfWeek],
          isWeekend,
          thaiDate: `${d} ${thaiMonths[monthNum - 1]} ${buddhistYear}`,
          capacity,
          booked: bookedCount,
          available: availableCount,
          percentBooked,
          status,
          isAvailable,
          isFull
        });
      }

      return {
        zoneCode,
        zoneName: zone.name_th || 'พื้นที่กางเต็นท์',
        shortDescription: zone.shortcontent_th || '',
        pricePerPerson: zone.price || '30',
        capacity,
        totalDays: daysInMonth,
        totalAvailableDays,
        totalFullDays,
        days
      };
    });

    return {
      success: true,
      timestamp: new Date().toISOString(),
      updatedAtText: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      branch: queryInfo.branch,
      month: queryInfo.month,
      year: queryInfo.year,
      buddhistYear,
      monthName: thaiMonthsFull[monthNum - 1],
      totalZones: zones.length,
      zones
    };
  }

  // Fetch multiple parks in parallel with concurrency limit
  async fetchMultiParks(parkList, month = '10', year = '2026') {
    const results = [];
    const batchSize = 6; // safe concurrency for DNP server

    for (let i = 0; i < parkList.length; i += batchSize) {
      const batch = parkList.slice(i, i + batchSize);
      const batchPromises = batch.map(async (p) => {
        try {
          const res = await this.fetchCalendarHold(p.code, month, year);
          if (res && res.zones && res.zones.length > 0) {
            return {
              ...res,
              parkCode: p.code,
              parkName: p.name
            };
          }
        } catch (e) {
          // ignore failed individual park
        }
        return null;
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(r => {
        if (r) results.push(r);
      });
    }

    return {
      success: true,
      isMulti: true,
      timestamp: new Date().toISOString(),
      updatedAtText: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      month,
      year,
      buddhistYear: parseInt(year, 10) + 543,
      totalParks: results.length,
      parks: results
    };
  }

  // Detect newly opened spots by comparing with previous snapshot
  checkDiff(previous, current) {
    if (!previous || !current || !previous.zones || !current.zones) {
      return { hasChanges: false, freedSpots: [] };
    }

    const freedSpots = [];

    current.zones.forEach(curZone => {
      const prevZone = previous.zones.find(z => z.zoneCode === curZone.zoneCode);
      if (!prevZone) return;

      curZone.days.forEach(curDay => {
        const prevDay = prevZone.days.find(d => d.day === curDay.day);
        if (!prevDay) return;

        // Was full, now available! OR slots increased significantly
        if (prevDay.isFull && curDay.isAvailable) {
          freedSpots.push({
            zoneName: curZone.zoneName,
            thaiDate: curDay.thaiDate,
            dayName: curDay.dayName,
            available: curDay.available,
            capacity: curDay.capacity,
            reason: 'จากเต็มกลายเป็นว่าง (หลุดจอง!)'
          });
        } else if (curDay.available > prevDay.available && prevDay.available < 10) {
          freedSpots.push({
            zoneName: curZone.zoneName,
            thaiDate: curDay.thaiDate,
            dayName: curDay.dayName,
            available: curDay.available,
            previousAvailable: prevDay.available,
            capacity: curDay.capacity,
            reason: `มีที่ว่างเพิ่มขึ้น (+${curDay.available - prevDay.available} ที่)`
          });
        }
      });
    });

    return {
      hasChanges: freedSpots.length > 0,
      freedSpots
    };
  }
}

module.exports = new DnpService();
