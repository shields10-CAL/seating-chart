import { db } from './db.js';

export const DEFAULT_SCHOOL_CONFIG = Object.freeze({
  version: 1,
  bellSchedules: {},
  calendar: {},
  lateStartDays: [3],
  bellConfigured: false,
  calendarConfigured: false,
  bellUpdatedAt: null,
  calendarUpdatedAt: null,
  lateStartUpdatedAt: null
});

const SCHEDULE_ALIASES = new Map([
  ['regular', 'regular'],
  ['late_start', 'lateStart'],
  ['late-start', 'lateStart'],
  ['latestart', 'lateStart'],
  ['two_hour', 'twoHour'],
  ['two-hour', 'twoHour'],
  ['twohour', 'twoHour'],
  ['all_periods', 'allPeriods'],
  ['all-periods', 'allPeriods'],
  ['allperiods', 'allPeriods'],
  ['all_periods_late_start', 'allPeriodsLateStart'],
  ['all-periods-late-start', 'allPeriodsLateStart'],
  ['allperiodslatestart', 'allPeriodsLateStart']
]);

const CALENDAR_SCHEDULE_ALIASES = new Map([
  ['auto', 'auto'],
  ['regular', 'regular'],
  ['late_start', 'lateStart'],
  ['late-start', 'lateStart'],
  ['latestart', 'lateStart'],
  ['two_hour', 'twoHour'],
  ['two-hour', 'twoHour'],
  ['twohour', 'twoHour'],
  ['all_periods', 'allPeriods'],
  ['all-periods', 'allPeriods'],
  ['allperiods', 'allPeriods'],
  ['all_periods_late_start', 'allPeriodsLateStart'],
  ['all-periods-late-start', 'allPeriodsLateStart'],
  ['allperiodslatestart', 'allPeriodsLateStart']
]);

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_SCHOOL_CONFIG));
}

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function readSchoolConfig() {
  const row = db.prepare('SELECT config_json FROM school_config WHERE id = 1').get();
  if (!row?.config_json) return cloneDefault();
  const parsed = safeParse(row.config_json, cloneDefault());
  return normalizeSchoolConfig(parsed);
}

export function normalizeSchoolConfig(candidate) {
  const base = cloneDefault();
  if (!candidate || typeof candidate !== 'object') return base;
  const bellSchedules = candidate.bellSchedules && typeof candidate.bellSchedules === 'object'
    ? candidate.bellSchedules : {};
  const calendar = candidate.calendar && typeof candidate.calendar === 'object'
    ? candidate.calendar : {};
  return {
    version: 1,
    bellSchedules,
    calendar,
    lateStartDays: Array.isArray(candidate.lateStartDays)
      ? [...new Set(candidate.lateStartDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [3],
    bellConfigured: Boolean(candidate.bellConfigured),
    calendarConfigured: Boolean(candidate.calendarConfigured),
    bellUpdatedAt: candidate.bellUpdatedAt || null,
    calendarUpdatedAt: candidate.calendarUpdatedAt || null,
    lateStartUpdatedAt: candidate.lateStartUpdatedAt || null
  };
}

export function writeSchoolConfig(config) {
  const normalized = normalizeSchoolConfig(config);
  db.prepare(`
    INSERT INTO school_config (id, config_json, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(normalized));
  return normalized;
}

export function schoolConfigSummary(config = readSchoolConfig()) {
  const calendarRows = Object.keys(config.calendar || {}).length;
  const scheduleKeys = Object.keys(config.bellSchedules || {});
  const bellRows = scheduleKeys.reduce((sum, key) => sum + (Array.isArray(config.bellSchedules[key]) ? config.bellSchedules[key].length : 0), 0);
  return {
    ...config,
    counts: { calendarRows, bellRows, scheduleCount: scheduleKeys.length }
  };
}

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n') {
      row.push(cell.trim()); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else if (char !== '\r') cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function rowsAsObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one data row.');
  const headers = rows[0].map(header => header.trim().toLowerCase());
  return rows.slice(1).map((values, index) => ({
    line: index + 2,
    data: Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']))
  }));
}

function parseTime(value, field, line) {
  const text = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(`Line ${line}: ${field} must use 24-hour HH:MM format.`);
  return text;
}

function minutes(value) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function parseBellScheduleCsv(text) {
  const rows = rowsAsObjects(text);
  const schedules = {};
  for (const { line, data } of rows) {
    const rawSchedule = String(data.schedule || data.schedule_type || '').trim().toLowerCase();
    const key = SCHEDULE_ALIASES.get(rawSchedule.replaceAll(' ', '_'));
    if (!key) throw new Error(`Line ${line}: unknown schedule "${rawSchedule}".`);
    const type = String(data.entry_type || data.type || 'period').trim().toLowerCase();
    if (!['period', 'lunch'].includes(type)) throw new Error(`Line ${line}: entry_type must be period or lunch.`);
    const start = parseTime(data.start, 'start', line);
    const end = parseTime(data.end, 'end', line);
    if (minutes(end) <= minutes(start)) throw new Error(`Line ${line}: end must be later than start.`);
    const entry = { start, end };
    if (type === 'lunch') {
      entry.type = 'lunch';
      entry.label = String(data.label || 'Lunch').trim() || 'Lunch';
    } else {
      const number = Number(data.number);
      if (!Number.isInteger(number) || number < 1 || number > 20) throw new Error(`Line ${line}: period number must be a whole number.`);
      if (key === 'allPeriods' || key === 'allPeriodsLateStart') entry.period = number;
      else entry.slot = number;
    }
    schedules[key] ||= [];
    schedules[key].push(entry);
  }
  for (const entries of Object.values(schedules)) entries.sort((a, b) => minutes(a.start) - minutes(b.start));
  if (!schedules.regular?.length) throw new Error('Bell schedule must include at least one regular schedule row.');
  if (!schedules.lateStart?.length) throw new Error('Bell schedule must include at least one late_start schedule row.');
  return schedules;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseCalendarCsv(text) {
  const rows = rowsAsObjects(text);
  const calendar = {};
  for (const { line, data } of rows) {
    const date = String(data.date || '').trim();
    if (!validIsoDate(date)) throw new Error(`Line ${line}: date must use YYYY-MM-DD.`);
    if (calendar[date]) throw new Error(`Line ${line}: duplicate date ${date}.`);
    const rawDayType = String(data.day_type || data.day || '').trim().toUpperCase();
    if (rawDayType && !['A', 'B'].includes(rawDayType)) throw new Error(`Line ${line}: day_type must be A, B, or blank.`);
    const status = String(data.status || 'school').trim().toLowerCase();
    if (!['school', 'closed', 'special'].includes(status)) throw new Error(`Line ${line}: status must be school, closed, or special.`);
    const rawSchedule = String(data.schedule || 'auto').trim().toLowerCase().replaceAll(' ', '_');
    const schedule = CALENDAR_SCHEDULE_ALIASES.get(rawSchedule);
    if (!schedule) throw new Error(`Line ${line}: unknown schedule "${data.schedule}".`);
    calendar[date] = {
      dayType: rawDayType || null,
      status,
      schedule,
      label: String(data.label || '').trim()
    };
  }
  return calendar;
}
