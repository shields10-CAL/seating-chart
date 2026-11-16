import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use an isolated SQLite database, never the deployment database.
const originalCwd = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'seating-chart-test-'));
process.chdir(temp);
const { db } = await import('../db.js');
const {
  parseCsv, parseBellScheduleCsv, parseCalendarCsv,
  normalizeSchoolConfig, readSchoolConfig, writeSchoolConfig
} = await import('../school-config.js');
after(() => {
  db.close();
  process.chdir(originalCwd);
  rmSync(temp, { recursive: true, force: true });
});

const template = name => readFileSync(new URL('../public/templates/' + name, import.meta.url), 'utf8');

test('CSV supports quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('name,label\r\nA,"Hello, ""world"""\r\n'), [
    ['name', 'label'], ['A', 'Hello, "world"']
  ]);
});

test('bell schedule template imports regular and late-start schedules', () => {
  const result = parseBellScheduleCsv(template('bell-schedule-template.csv'));
  assert.equal(result.regular[0].start, '08:00');
  assert.equal(result.regular[0].slot, 1);
  assert.equal(result.lateStart[0].start, '09:00');
  assert.ok(result.regular.some(entry => entry.type === 'lunch'));
});

test('bell schedule rejects invalid time ranges', () => {
  assert.throws(() => parseBellScheduleCsv('schedule,entry_type,number,label,start,end\nregular,period,1,,09:00,08:00'), /end must be later/);
});

test('A/B calendar template imports school and closed dates', () => {
  const result = parseCalendarCsv(template('ab-calendar-template.csv'));
  assert.equal(result['2026-08-31'].status, 'closed');
  assert.ok(Object.values(result).some(day => day.dayType === 'A' && day.status === 'school'));
  assert.ok(Object.values(result).some(day => day.dayType === 'B' && day.status === 'school'));
});

test('calendar rejects invalid dates and duplicate rows', () => {
  assert.throws(() => parseCalendarCsv('date,day_type\n2026-02-30,A'), /date must use/);
  assert.throws(() => parseCalendarCsv('date,day_type\n2026-09-15,A\n2026-09-15,B'), /duplicate date/);
});

test('late-start days are normalized and school configuration persists', () => {
  assert.deepEqual(normalizeSchoolConfig({ lateStartDays: [3, '3', 5, -1, 8] }).lateStartDays, [3, 5]);
  const written = writeSchoolConfig({ lateStartDays: [1, 4], bellConfigured: true });
  assert.deepEqual(readSchoolConfig(), written);
});
