(() => {
  function calendarDateKey(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function calendarInfoForDate(config, now = new Date()) {
    const key = calendarDateKey(now);
    if (!config?.calendarConfigured) {
      return { configured: false, exists: false, key, dayType: null, label: 'Calendar not configured', status: null, schedule: 'auto' };
    }
    const row = config.calendar?.[key] || null;
    if (!row) {
      return { configured: true, exists: false, key, dayType: null, label: 'No calendar entry', status: null, schedule: 'auto' };
    }
    return {
      configured: true,
      exists: true,
      key,
      dayType: row.dayType === 'A' || row.dayType === 'B' ? row.dayType : null,
      label: row.label || (row.dayType ? `${row.dayType}-Day` : (row.status === 'closed' ? 'No school' : 'School calendar')),
      status: row.status || 'school',
      schedule: row.schedule || 'auto',
      lateStart: Array.isArray(config.lateStartDays) && config.lateStartDays.includes(now.getDay())
    };
  }

  function effectiveDayType(config, overrides = {}, now = new Date()) {
    if (overrides.dayOverride === 'A' || overrides.dayOverride === 'B') return overrides.dayOverride;
    return calendarInfoForDate(config, now).dayType || overrides.fallbackDayType || 'A';
  }

  function minutesFromClock(value) {
    const [h, m] = String(value || '0:0').split(':').map(Number);
    return h * 60 + m;
  }

  function formatClock(value) {
    const [hourRaw, minuteRaw] = String(value || '0:0').split(':').map(Number);
    const suffix = hourRaw >= 12 ? 'PM' : 'AM';
    const hour = hourRaw % 12 || 12;
    return `${hour}:${String(minuteRaw).padStart(2, '0')} ${suffix}`;
  }

  function entryLabel(entry, dayType) {
    if (entry?.type === 'lunch') return 'Lunch';
    if (entry?.period) return `Period ${entry.period}`;
    return `Period ${dayType === 'A' ? entry?.slot : Number(entry?.slot || 0) + 4}`;
  }

  function scheduleForNow(config, overrides = {}, now = new Date()) {
    const info = calendarInfoForDate(config, now);
    const manualDay = overrides.dayOverride === 'A' || overrides.dayOverride === 'B';
    const dayType = effectiveDayType(config, overrides, now);
    const weekdayLateStart = Array.isArray(config?.lateStartDays) && config.lateStartDays.includes(now.getDay());
    const schedules = config?.bellSchedules || {};

    const fromKey = (key, label) => {
      const entries = Array.isArray(schedules[key]) ? schedules[key] : [];
      if (!config?.bellConfigured || !entries.length) {
        return { unconfigured: true, label: 'Bell schedule not configured', dayType, key };
      }
      return { key, label, entries, dayType };
    };

    if (overrides.scheduleOverride === 'twoHour') {
      return fromKey('twoHour', `${dayType}-Day · 2-hour late start`);
    }
    if (overrides.scheduleOverride === 'allPeriods') {
      const useLate = weekdayLateStart || info.schedule === 'allPeriodsLateStart';
      return useLate
        ? fromKey('allPeriodsLateStart', 'All periods · late start')
        : fromKey('allPeriods', 'All periods schedule');
    }

    if (!manualDay) {
      if (!config?.calendarConfigured) {
        return { unconfigured: true, label: 'School calendar not configured', dayType, key: null };
      }
      if (!info.exists) {
        return { closed: true, label: 'No calendar entry for today', info, dayType };
      }
      if (info.status === 'closed') {
        return { closed: true, label: info.label || 'No school', info, dayType };
      }
      if (info.status === 'special' && info.schedule === 'auto') {
        return { special: true, label: info.label || 'Special schedule', info, dayType };
      }
      if (info.schedule && info.schedule !== 'auto') {
        const labels = {
          regular: `${dayType}-Day · Regular schedule`,
          lateStart: `${dayType}-Day · Late start`,
          twoHour: `${dayType}-Day · 2-hour late start`,
          allPeriods: 'All periods schedule',
          allPeriodsLateStart: 'All periods · late start'
        };
        return fromKey(info.schedule, labels[info.schedule] || 'School schedule');
      }
    }

    return weekdayLateStart
      ? fromKey('lateStart', `${dayType}-Day · Late start`)
      : fromKey('regular', `${dayType}-Day · Regular schedule`);
  }

  function snapshot(config, overrides = {}, now = new Date()) {
    const info = calendarInfoForDate(config, now);
    const manual = overrides.dayOverride === 'A' || overrides.dayOverride === 'B';
    const dayType = manual ? overrides.dayOverride : info.dayType;
    const schedule = scheduleForNow(config, overrides, now);
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const autoOverrides = (overrides.dayOverride || 'auto') === 'auto' && (overrides.scheduleOverride || 'auto') === 'auto';

    const result = {
      now,
      info,
      dayType,
      dayLabel: dayType ? `${dayType}-Day` : (info.label || 'Calendar'),
      daySource: manual ? 'manual override' : (info.label || 'school calendar'),
      schedule,
      scheduleStatus: '',
      scheduleTime: '',
      scheduleRemaining: '',
      scheduleModeLabel: schedule.label || '',
      activeEntry: null,
      secondsLeft: null,
      titleLabel: ''
    };

    if (isWeekend && autoOverrides) {
      result.scheduleStatus = 'No classes scheduled';
      result.scheduleTime = 'Weekend';
      result.scheduleRemaining = 'Auto schedule resumes on the next configured school day';
      result.titleLabel = 'Weekend';
      return result;
    }

    if (schedule.unconfigured) {
      result.scheduleStatus = schedule.label || 'Schedule not configured';
      result.scheduleTime = '—';
      result.scheduleRemaining = 'Ask an administrator to configure the school schedule';
      result.titleLabel = 'Schedule not configured';
      return result;
    }

    if (schedule.closed) {
      result.scheduleStatus = schedule.info?.label || 'No classes scheduled';
      result.scheduleTime = 'No classes';
      result.scheduleRemaining = schedule.info?.label && schedule.info.label !== schedule.label ? schedule.info.label : '';
      result.titleLabel = schedule.info?.label || 'No classes';
      return result;
    }

    if (schedule.special) {
      result.scheduleStatus = 'Special schedule';
      result.scheduleTime = 'See school calendar';
      result.scheduleRemaining = 'Check the school calendar for today';
      result.titleLabel = 'Special schedule';
      return result;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const active = schedule.entries.find(entry => nowMinutes >= minutesFromClock(entry.start) && nowMinutes < minutesFromClock(entry.end));
    if (active) {
      const isLunch = active.type === 'lunch';
      result.activeEntry = active;
      result.scheduleStatus = isLunch ? 'Lunch ends' : `${entryLabel(active, schedule.dayType)} ends`;
      result.scheduleTime = formatClock(active.end);
      result.secondsLeft = Math.max(0, Math.floor(minutesFromClock(active.end) * 60 - (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds())));
      const mins = Math.floor(result.secondsLeft / 60);
      const secs = result.secondsLeft % 60;
      result.scheduleRemaining = `${mins}m ${String(secs).padStart(2, '0')}s remaining`;
      result.titleLabel = isLunch ? 'Lunch' : entryLabel(active, schedule.dayType);
      return result;
    }

    const next = schedule.entries.find(entry => nowMinutes < minutesFromClock(entry.start));
    if (next) {
      result.scheduleStatus = `Next: ${entryLabel(next, schedule.dayType)}`;
      result.scheduleTime = formatClock(next.start);
      result.scheduleRemaining = 'Starts at the time shown';
      result.titleLabel = `Next ${entryLabel(next, schedule.dayType)}`;
      return result;
    }

    const lastEntry = schedule.entries[schedule.entries.length - 1];
    result.scheduleStatus = 'School day complete';
    result.scheduleTime = lastEntry?.end ? formatClock(lastEntry.end) : '—';
    result.scheduleRemaining = 'No more scheduled periods today';
    result.titleLabel = 'School day complete';
    return result;
  }

  window.CALInfo = {
    calendarDateKey,
    calendarInfoForDate,
    effectiveDayType,
    minutesFromClock,
    formatClock,
    entryLabel,
    scheduleForNow,
    snapshot
  };
})();