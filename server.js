import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import { db } from './db.js';
import { readSchoolConfig, writeSchoolConfig, schoolConfigSummary, parseBellScheduleCsv, parseCalendarCsv } from './school-config.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve('public');

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Better Auth must receive the request before Express parses the body.
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '2mb' }));
app.use('/static', (req, res, next) => {
  if (req.path.endsWith('.html')) return res.status(404).end();
  next();
}, express.static(publicDir, {
  index: false,
  maxAge: 0,
  etag: false,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store, max-age=0'); }
}));

function emptyState() {
  return {
    version: 7,
    theme: 'light',
    dayType: 'A',
    dayOverride: 'auto',
    scheduleOverride: 'auto',
    sidebarWidth: 292,
    activeClassId: '',
    attendanceStatus: { dismissedPeriodKey: '' },
    classes: {}
  };
}

async function sessionFor(req) {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

async function requireAuth(req, res, next) {
  try {
    const session = await sessionFor(req);
    if (!session?.user) return res.status(401).json({ error: 'Authentication required.' });
    req.authSession = session;
    next();
  } catch (error) {
    console.error('Authentication check failed:', error);
    res.status(500).json({ error: 'Could not verify the current session.' });
  }
}

function isAdminUser(user) {
  return String(user?.role || '').split(',').map(value => value.trim()).includes('admin');
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!isAdminUser(req.authSession.user)) return res.status(403).json({ error: 'Administrator access required.' });
    next();
  });
}

async function requirePageAuth(req, res, next) {
  try {
    const session = await sessionFor(req);
    if (!session?.user) return res.redirect('/login');
    req.authSession = session;
    next();
  } catch {
    res.redirect('/login');
  }
}

async function requireAdminPage(req, res, next) {
  await requirePageAuth(req, res, () => {
    if (!isAdminUser(req.authSession.user)) return res.redirect('/');
    next();
  });
}

app.get('/login', async (req, res) => {
  const session = await sessionFor(req).catch(() => null);
  if (session?.user) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/', requirePageAuth, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/draw-chart', requirePageAuth, (req, res) => res.sendFile(path.join(publicDir, 'draw-chart', 'index.html')));
app.get('/admin', requireAdminPage, (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const user = req.authSession.user;
  const row = db.prepare('SELECT state_json FROM user_state WHERE user_id = ?').get(user.id);
  let state = emptyState();
  if (row?.state_json) {
    try { state = JSON.parse(row.state_json); } catch { state = emptyState(); }
  }
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'user'
    },
    state,
    schoolConfig: readSchoolConfig()
  });
});

app.put('/api/state', requireAuth, (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return res.status(400).json({ error: 'A state object is required.' });
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > 1_500_000) {
    return res.status(413).json({ error: 'Seating-chart state is unexpectedly large.' });
  }
  db.prepare(`
    INSERT INTO user_state (user_id, state_json, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.authSession.user.id, serialized);
  res.json({ ok: true });
});



app.get('/api/admin/school-config', requireAdmin, (req, res) => {
  res.json(schoolConfigSummary());
});

app.post('/api/admin/school-config/bell-schedule', requireAdmin, (req, res) => {
  try {
    const schedules = parseBellScheduleCsv(req.body?.csv);
    const config = readSchoolConfig();
    config.bellSchedules = schedules;
    config.bellConfigured = true;
    config.bellUpdatedAt = new Date().toISOString();
    res.json(schoolConfigSummary(writeSchoolConfig(config)));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not import bell schedule CSV.' });
  }
});

app.post('/api/admin/school-config/calendar', requireAdmin, (req, res) => {
  try {
    const calendar = parseCalendarCsv(req.body?.csv);
    const config = readSchoolConfig();
    config.calendar = calendar;
    config.calendarConfigured = true;
    config.calendarUpdatedAt = new Date().toISOString();
    res.json(schoolConfigSummary(writeSchoolConfig(config)));
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not import calendar CSV.' });
  }
});

app.put('/api/admin/school-config/late-start-days', requireAdmin, (req, res) => {
  const days = Array.isArray(req.body?.days)
    ? [...new Set(req.body.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    : null;
  if (!days) return res.status(400).json({ error: 'days must be an array of weekday numbers.' });
  const config = readSchoolConfig();
  config.lateStartDays = days;
  config.lateStartUpdatedAt = new Date().toISOString();
  res.json(schoolConfigSummary(writeSchoolConfig(config)));
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await auth.api.listUsers({
      query: { limit: 100, offset: 0, sortBy: 'name', sortDirection: 'asc' },
      headers: fromNodeHeaders(req.headers)
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(error?.status || 500).json({ error: error?.message || 'Could not list users.' });
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  try {
    const user = await auth.api.createUser({
      body: { name: name.trim(), email: email.trim().toLowerCase(), password, role: 'user' },
      headers: fromNodeHeaders(req.headers)
    });
    res.status(201).json(user);
  } catch (error) {
    res.status(error?.status || 400).json({ error: error?.message || 'Could not create user.' });
  }
});

app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  try {
    await auth.api.setUserPassword({
      body: { userId: req.params.id, newPassword: password },
      headers: fromNodeHeaders(req.headers)
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(error?.status || 400).json({ error: error?.message || 'Could not reset password.' });
  }
});

app.post('/api/admin/users/:id/disabled', requireAdmin, async (req, res) => {
  if (req.params.id === req.authSession.user.id) return res.status(400).json({ error: 'You cannot disable your own admin account.' });
  const disabled = Boolean(req.body?.disabled);
  try {
    if (disabled) {
      await auth.api.banUser({
        body: { userId: req.params.id, banReason: 'Disabled by administrator' },
        headers: fromNodeHeaders(req.headers)
      });
    } else {
      await auth.api.unbanUser({
        body: { userId: req.params.id },
        headers: fromNodeHeaders(req.headers)
      });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(error?.status || 400).json({ error: error?.message || 'Could not update account status.' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.authSession.user.id) return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  try {
    await auth.api.removeUser({
      body: { userId: req.params.id },
      headers: fromNodeHeaders(req.headers)
    });
    db.prepare('DELETE FROM user_state WHERE user_id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error?.status || 400).json({ error: error?.message || 'Could not delete user.' });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found');
});

app.listen(port, () => {
  console.log(`CAL Seating Chart running at http://localhost:${port}`);
});
