(async () => {
  'use strict';

  const ATTENDANCE_FIRST_INTERVAL_SECONDS = 8 * 60;
  const ATTENDANCE_LATE_INTERVAL_SECONDS = 4 * 60;
  const TABLE_HISTORY_LIMIT = 4;
  const MAX_STUDENTS = 60;
  // Five calm color families, each with four tonal steps. Colors are used only as
  // a persistent stroke around a student's seat circle so the chart stays calm.
  const STUDENT_COLOR_PALETTE = [
    '#8F4A4A', '#B86161', '#D58A8A', '#EBC0C0',
    '#9A642E', '#B98045', '#D6A36C', '#EAC8A2',
    '#426F58', '#5F8A70', '#83AA92', '#B4CEBD',
    '#3F6693', '#5B7FA8', '#84A1C2', '#B6C8DC',
    '#6D5485', '#8870A0', '#A78FB9', '#CCBBD7'
  ];

  let schoolConfig = {
    version: 1,
    bellSchedules: {},
    calendar: {},
    lateStartDays: [3],
    bellConfigured: false,
    calendarConfigured: false
  };

  function normalizeSchoolConfig(candidate) {
    if (!candidate || typeof candidate !== 'object') return { ...schoolConfig };
    return {
      version: 1,
      bellSchedules: candidate.bellSchedules && typeof candidate.bellSchedules === 'object' ? candidate.bellSchedules : {},
      calendar: candidate.calendar && typeof candidate.calendar === 'object' ? candidate.calendar : {},
      lateStartDays: Array.isArray(candidate.lateStartDays)
        ? [...new Set(candidate.lateStartDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
        : [3],
      bellConfigured: Boolean(candidate.bellConfigured),
      calendarConfigured: Boolean(candidate.calendarConfigured),
      bellUpdatedAt: candidate.bellUpdatedAt || null,
      calendarUpdatedAt: candidate.calendarUpdatedAt || null
    };
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    clockTime: $('#clockTime'),
    clockDate: $('#clockDate'),
    dayToggle: $('#dayToggle'),
    dayLabel: $('#dayLabel'),
    sidebarResizer: $('#sidebarResizer'),
    sidebarCollapseBtn: $('#sidebarCollapseBtn'),
    sidebarRevealBtn: $('#sidebarRevealBtn'),
    sidebarFocusBtn: $('#sidebarFocusBtn'),
    sidebarFocusLabel: $('#sidebarFocusLabel'),
    scheduleStatus: $('#scheduleStatus'),
    scheduleTime: $('#scheduleTime'),
    scheduleRemaining: $('#scheduleRemaining'),
    scheduleModeLabel: $('#scheduleModeLabel'),
    scheduleGear: $('#scheduleGear'),
    attendanceReminder: $('#attendanceReminder'),
    attendanceReminderDetail: $('#attendanceReminderDetail'),
    shuffleBtn: $('#shuffleBtn'),
    openDashboardBtn: $('#openDashboardBtn'),
    classTitle: $('#classTitle'),
    studentCountChip: $('#studentCountChip'),
    tableGrid: $('#tableGrid'),
    classFabBar: $('#classFabBar'),
    dashboardDialog: $('#dashboardDialog'),
    dashboardClassSubtitle: $('#dashboardClassSubtitle'),
    currentClassName: $('#currentClassName'),
    renameClassBtn: $('#renameClassBtn'),
    newClassDialog: $('#newClassDialog'),
    newClassForm: $('#newClassForm'),
    newClassNamePrompt: $('#newClassNamePrompt'),
    confirmCreateClassBtn: $('#confirmCreateClassBtn'),
    deleteClassBtn: $('#deleteClassBtn'),
    importCsvBtn: $('#importCsvBtn'),
    downloadCsvTemplateBtn: $('#downloadCsvTemplateBtn'),
    csvFileInput: $('#csvFileInput'),
    rosterSetupCard: $('#rosterSetupCard'),
    rosterSetupStatus: $('#rosterSetupStatus'),
    rosterSetupDetail: $('#rosterSetupDetail'),
    seatingSetupCard: $('#seatingSetupCard'),
    seatingSetupStatus: $('#seatingSetupStatus'),
    seatingSetupDetail: $('#seatingSetupDetail'),
    chartSourceNote: $('#chartSourceNote'),
    editSeatingChartBtn: $('#editSeatingChartBtn'),
    shareSeatingChartBtn: $('#shareSeatingChartBtn'),
    makeIndependentChartBtn: $('#makeIndependentChartBtn'),
    shareChartDialog: $('#shareChartDialog'),
    shareChartForm: $('#shareChartForm'),
    shareChartClassSelect: $('#shareChartClassSelect'),
    confirmShareChartBtn: $('#confirmShareChartBtn'),
    shareChartCancelBtn: $('#shareChartCancelBtn'),
    fixedSeatStudent: $('#fixedSeatStudent'),
    fixedSeatNumber: $('#fixedSeatNumber'),
    addFixedSeatBtn: $('#addFixedSeatBtn'),
    fixedSeatList: $('#fixedSeatList'),
    separationPoolStudent: $('#separationPoolStudent'),
    addSeparationPoolBtn: $('#addSeparationPoolBtn'),
    separationPoolList: $('#separationPoolList'),
    buddyStudentA: $('#buddyStudentA'),
    buddyStudentB: $('#buddyStudentB'),
    buddyStudentC: $('#buddyStudentC'),
    addBuddyBtn: $('#addBuddyBtn'),
    buddyRulesList: $('#buddyRulesList'),
    layoutEditorDialog: $('#layoutEditorDialog'),
    layoutEditorFrame: $('#layoutEditorFrame'),
    layoutEditorClassName: $('#layoutEditorClassName'),
    layoutEditorCloseBtn: $('#layoutEditorCloseBtn'),
    scheduleDialog: $('#scheduleDialog'),
    applyScheduleBtn: $('#applyScheduleBtn'),
    toast: $('#toast'),
    signedInAs: $('#signedInAs'),
    adminPanelLink: $('#adminPanelLink'),
    signOutBtn: $('#signOutBtn')
  };

  function makeId(prefix = 'id') {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function studentColorForIndex(index = 0) {
    return STUDENT_COLOR_PALETTE[Math.abs(Number(index) || 0) % STUDENT_COLOR_PALETTE.length];
  }

  function validStudentColor(value) {
    return STUDENT_COLOR_PALETTE.includes(String(value || '').toUpperCase())
      ? String(value).toUpperCase()
      : null;
  }

  function studentColorClass(value) {
    const color = validStudentColor(value) || STUDENT_COLOR_PALETTE[0];
    return `student-color-${Math.max(0, STUDENT_COLOR_PALETTE.indexOf(color))}`;
  }

  function leastUsedStudentColor(cls) {
    const counts = new Map(STUDENT_COLOR_PALETTE.map(color => [color, 0]));
    for (const student of cls?.students || []) {
      const color = validStudentColor(student.color);
      if (color) counts.set(color, (counts.get(color) || 0) + 1);
    }
    return STUDENT_COLOR_PALETTE
      .slice()
      .sort((a, b) => (counts.get(a) - counts.get(b)) || (STUDENT_COLOR_PALETTE.indexOf(a) - STUDENT_COLOR_PALETTE.indexOf(b)))[0];
  }

  function normalizeLayout(layout) {
    if (!layout || typeof layout !== 'object' || layout.schema !== 'cal-classroom-layout') return null;
    const columns = Number(layout.grid?.columns);
    const rows = Number(layout.grid?.rows);
    if (!Number.isInteger(columns) || columns < 8 || columns > 60 || !Number.isInteger(rows) || rows < 6 || rows > 50) return null;
    const clone = JSON.parse(JSON.stringify(layout));
    clone.version = Number(clone.version) || 6;
    clone.grid = { columns, rows, unit: 'square' };
    clone.roomSize = { x: columns, y: rows, unit: 'square' };
    clone.tables = Array.isArray(clone.tables) ? clone.tables : [];
    clone.seats = Array.isArray(clone.seats) ? clone.seats : [];
    clone.doors = Array.isArray(clone.doors) ? clone.doors : [];
    clone.teacherDesks = Array.isArray(clone.teacherDesks) ? clone.teacherDesks : [];
    clone.projectorScreens = Array.isArray(clone.projectorScreens) ? clone.projectorScreens : [];
    return clone;
  }

  function initialState() {
    return {
      version: 9,
      dayType: 'A',
      dayOverride: 'auto',
      scheduleOverride: 'auto',
      sidebarWidth: 292,
      sidebarCollapsed: false,
      activeClassId: '',
      attendanceStatus: { dismissedPeriodKey: '' },
      classes: {}
    };
  }

  function normalizeState(candidate) {
    if (!candidate || typeof candidate !== 'object') return initialState();
    const classes = candidate.classes && typeof candidate.classes === 'object' ? candidate.classes : {};
    const normalizedClasses = {};

    for (const [key, value] of Object.entries(classes)) {
      if (!value || typeof value !== 'object') continue;
      const id = String(value.id || key);
      const layout = normalizeLayout(value.layout);
      const students = Array.isArray(value.students) ? value.students.slice(0, MAX_STUDENTS).map((s, i) => ({
        id: String(s.id || makeId('student')),
        name: String(s.name || `Student ${i + 1}`).trim() || `Student ${i + 1}`,
        seat: Number.isInteger(Number(s.seat)) ? Number(s.seat) : null,
        fixed: Boolean(s.fixed),
        color: validStudentColor(s.color) || studentColorForIndex(i)
      })) : [];
      const legacyPool = Array.isArray(value.separationRules)
        ? [...new Set(value.separationRules.flat().map(String))]
        : [];
      const validStudentIds = new Set(students.map(student => student.id));
      const sourceGroups = Array.isArray(value.buddyGroups) ? value.buddyGroups : (Array.isArray(value.buddyRules) ? value.buddyRules : []);
      const buddyGroups = [];
      const buddyStudents = new Set();
      for (const rule of sourceGroups) {
        if (!Array.isArray(rule)) continue;
        const group = [...new Set(rule.map(String))].filter(studentId => validStudentIds.has(studentId)).slice(0, 3);
        if (group.length < 2 || group.some(studentId => buddyStudents.has(studentId))) continue;
        group.forEach(studentId => buddyStudents.add(studentId));
        buddyGroups.push(group);
      }
      const tableHistory = {};
      const rawTableHistory = value.tableHistory && typeof value.tableHistory === 'object' ? value.tableHistory : {};
      for (const studentId of validStudentIds) {
        const history = Array.isArray(rawTableHistory[studentId]) ? rawTableHistory[studentId] : [];
        const cleaned = history.map(item => String(item)).filter(Boolean).slice(-TABLE_HISTORY_LIMIT);
        if (cleaned.length) tableHistory[studentId] = cleaned;
      }
      normalizedClasses[id] = {
        id,
        name: String(value.name || id),
        students,
        layout,
        layoutSourceClassId: typeof value.layoutSourceClassId === 'string' && value.layoutSourceClassId.trim()
          ? value.layoutSourceClassId.trim()
          : null,
        separationPool: (Array.isArray(value.separationPool) ? value.separationPool.map(String) : legacyPool)
          .filter((studentId, index, list) => validStudentIds.has(studentId) && list.indexOf(studentId) === index),
        buddyGroups,
        tableHistory
      };
    }

    // Keep only valid links and reject cycles in saved data.
    for (const cls of Object.values(normalizedClasses)) {
      const seen = new Set([cls.id]);
      let sourceId = cls.layoutSourceClassId;
      while (sourceId) {
        if (!normalizedClasses[sourceId] || seen.has(sourceId)) {
          cls.layoutSourceClassId = null;
          break;
        }
        seen.add(sourceId);
        sourceId = normalizedClasses[sourceId].layoutSourceClassId;
      }
    }

    const requestedActive = String(candidate.activeClassId || '');
    return {
      version: 9,
      dayType: candidate.dayType === 'B' ? 'B' : 'A',
      dayOverride: ['auto', 'A', 'B'].includes(candidate.dayOverride) ? candidate.dayOverride : 'auto',
      sidebarWidth: Math.min(420, Math.max(190, Number(candidate.sidebarWidth) || 292)),
      sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
      scheduleOverride: ['auto', 'allPeriods', 'twoHour'].includes(candidate.scheduleOverride) ? candidate.scheduleOverride : 'auto',
      activeClassId: normalizedClasses[requestedActive] ? requestedActive : (Object.keys(normalizedClasses)[0] || ''),
      attendanceStatus: {
        dismissedPeriodKey: typeof candidate.attendanceStatus?.dismissedPeriodKey === 'string'
          ? candidate.attendanceStatus.dismissedPeriodKey
          : ''
      },
      classes: normalizedClasses
    };
  }

  let currentUser = null;
  let state = initialState();
  let saveTimer = null;
  let saveChain = Promise.resolve();

  async function loadState() {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('Authentication required.');
    }
    if (!response.ok) throw new Error('Could not load seating-chart data from the server.');
    const payload = await response.json();
    currentUser = payload.user || null;
    schoolConfig = normalizeSchoolConfig(payload.schoolConfig);
    return normalizeState(payload.state);
  }

  async function persistStateNow() {
    clearTimeout(saveTimer);
    const snapshot = JSON.parse(JSON.stringify(state));
    saveChain = saveChain.then(async () => {
      const response = await fetch('/api/state', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: snapshot })
      });
      if (response.status === 401) {
        window.location.replace('/login');
        return;
      }
      if (!response.ok) throw new Error('Server save failed.');
    }).catch(error => {
      console.error(error);
      showToast('Could not save to the server. Your current screen still has the changes.', 5000);
    });
    return saveChain;
  }

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistStateNow, 220);
  }

  state = await loadState();
  Object.values(state.classes).forEach(repairSeats);
  let toastTimer = null;
  let shuffleTimer = null;
  let draggedStudentId = null;
  let layoutEditorTargetClassId = null;
  let attendanceAudioContext = null;
  let attendanceRuntime = { periodKey: null, lastDingMarker: '' };
  let attendanceStatus = state.attendanceStatus || { dismissedPeriodKey: '' };

  function activeClass() {
    return state.classes[state.activeClassId];
  }

  function layoutOwner(classData = activeClass()) {
    if (!classData) return null;
    let current = classData;
    const seen = new Set();
    while (current?.layoutSourceClassId) {
      if (seen.has(current.id)) return classData;
      seen.add(current.id);
      const next = state.classes[current.layoutSourceClassId];
      if (!next || seen.has(next.id)) return classData;
      current = next;
    }
    return current;
  }

  function effectiveLayoutForClass(classData = activeClass()) {
    return layoutOwner(classData)?.layout || null;
  }

  function classesUsingLayoutOwner(ownerId) {
    return Object.values(state.classes).filter(cls => layoutOwner(cls)?.id === ownerId);
  }

  function seatNumberFromLayoutSeat(seat, fallback) {
    const match = String(seat?.label || seat?.id || '').match(/\d+/);
    const number = match ? Number(match[0]) : Number(fallback);
    return Number.isInteger(number) && number > 0 ? number : Number(fallback);
  }

  function layoutSeatInfos(classData = activeClass()) {
    const layout = effectiveLayoutForClass(classData);
    if (!layout || !Array.isArray(layout.seats)) return [];
    const usedNumbers = new Set();
    const tableGroups = Array.isArray(layout.tables) ? layout.tables : [];
    return layout.seats.map((seat, index) => {
      let number = seatNumberFromLayoutSeat(seat, index + 1);
      while (usedNumbers.has(number)) number++;
      usedNumbers.add(number);
      const column = Number(seat.column);
      const row = Number(seat.row);
      let tableId = null;
      let tableLabel = null;
      let tableRow = null;
      let bestDistance = Infinity;
      for (const table of tableGroups) {
        for (const cell of table.cells || []) {
          const distance = Math.abs(Number(cell.column) - column) + Math.abs(Number(cell.row) - row);
          if (distance < bestDistance) {
            bestDistance = distance;
            tableId = String(table.id || table.label || '');
            tableLabel = String(table.label || table.id || 'Table');
            tableRow = Number(cell.row);
          }
        }
      }
      return {
        id: String(seat.id || `seat-${number}`),
        number,
        label: String(seat.label || `Seat ${number}`),
        column,
        row,
        tableId: tableId || null,
        tableLabel: tableLabel || null,
        tableRow: Number.isInteger(tableRow) ? tableRow : null
      };
    }).filter(seat => Number.isInteger(seat.column) && Number.isInteger(seat.row))
      .sort((a, b) => a.number - b.number);
  }

  function seatInfoMap(classData = activeClass()) {
    return new Map(layoutSeatInfos(classData).map(info => [info.number, info]));
  }

  function layoutSeatNumbers(classData = activeClass()) {
    return layoutSeatInfos(classData).map(info => info.number);
  }

  function validSeat(value, classData = activeClass()) {
    const n = Number(value);
    if (!Number.isInteger(n)) return false;
    const seats = layoutSeatNumbers(classData);
    return seats.includes(n);
  }

  function seatInfoFor(classData, seatNumber) {
    return seatInfoMap(classData).get(Number(seatNumber)) || null;
  }

  function seatTableId(classData, seatNumber) {
    return seatInfoFor(classData, seatNumber)?.tableId || null;
  }

  function seatsAreNeighbors(classData, seatA, seatB) {
    const a = seatInfoFor(classData, seatA);
    const b = seatInfoFor(classData, seatB);
    if (!a || !b) return false;
    const dx = Math.abs(a.column - b.column);
    const dy = Math.abs(a.row - b.row);
    return dx <= 1 && dy <= 1;
  }

  function separationPairAllowed(classData, seatA, seatB) {
    const a = seatInfoFor(classData, seatA);
    const b = seatInfoFor(classData, seatB);
    if (!a || !b) return false;
    if (seatsAreNeighbors(classData, seatA, seatB)) return false;
    if (a.tableId && b.tableId && a.tableId === b.tableId) return false;
    return true;
  }

  function layoutHasSeats(classData = activeClass()) {
    return layoutSeatInfos(classData).length > 0;
  }

  function seatingChartReady(classData = activeClass()) {
    if (!effectiveLayoutForClass(classData)) return false;
    const seats = layoutSeatInfos(classData);
    return seats.length > 0 && seats.length >= classData.students.length;
  }

  function blankLayout() {
    return {
      schema: 'cal-classroom-layout', version: 6,
      grid: { columns: 24, rows: 16, unit: 'square' },
      roomSize: { x: 24, y: 16, unit: 'square' },
      tables: [], seats: [], doors: [], teacherDesks: [], projectorScreens: []
    };
  }

  function repairSeats(classData) {
    const available = layoutSeatNumbers(classData);
    if (!available.length) {
      classData.students.forEach(student => { student.seat = null; student.fixed = false; });
      return;
    }
    const availableSet = new Set(available);
    const used = new Set();
    const unseated = [];
    for (const student of classData.students) {
      const seat = Number(student.seat);
      if (availableSet.has(seat) && !used.has(seat)) {
        student.seat = seat;
        used.add(seat);
      } else {
        student.seat = null;
        student.fixed = false;
        unseated.push(student);
      }
    }
    const open = available.filter(seat => !used.has(seat));
    unseated.forEach((student, index) => {
      student.seat = open[index] ?? null;
      if (student.seat == null) student.fixed = false;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message, ms = 3000) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  function calendarDateKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function calendarInfoForDate(now) {
    return window.CALInfo.calendarInfoForDate(schoolConfig, now);
  }

  function effectiveDayType(now = new Date()) {
    return window.CALInfo.effectiveDayType(schoolConfig, {
      dayOverride: state.dayOverride,
      scheduleOverride: state.scheduleOverride,
      fallbackDayType: state.dayType
    }, now);
  }

  function applySidebarWidth() {
    const width = Math.min(420, Math.max(190, Number(state.sidebarWidth) || 292));
    state.sidebarWidth = width;
    document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
  }

  function applySidebarVisibility() {
    const collapsed = Boolean(state.sidebarCollapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    els.sidebarCollapseBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    els.sidebarRevealBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function setSidebarCollapsed(collapsed, persist = true) {
    state.sidebarCollapsed = Boolean(collapsed);
    applySidebarVisibility();
    if (persist) saveState();
    requestAnimationFrame(() => {
      fitRoomCanvas();
      requestAnimationFrame(fitRoomCanvas);
    });
  }

  function renderDayToggle(now = new Date()) {
    const info = calendarInfoForDate(now);
    const manual = state.dayOverride === 'A' || state.dayOverride === 'B';
    const dayType = manual ? state.dayOverride : info.dayType;
    els.dayToggle.classList.toggle('a-day', dayType === 'A');
    els.dayToggle.classList.toggle('b-day', dayType === 'B');
    els.dayToggle.classList.toggle('neutral-day', !dayType);
    if (dayType) {
      els.dayLabel.textContent = `${dayType}-Day`;
      const source = manual ? 'manual override' : (info.label || 'school calendar');
      els.dayToggle.setAttribute('aria-label', `${dayType}-Day, ${source}. Open day and schedule options.`);
      els.dayToggle.title = `${dayType}-Day · ${source}`;
    } else {
      els.dayLabel.textContent = info.label || 'Calendar';
      els.dayToggle.setAttribute('aria-label', `${els.dayLabel.textContent}. Open day and schedule options.`);
      els.dayToggle.title = els.dayLabel.textContent;
    }
  }

  function getStudentBySeat(seat) {
    return activeClass()?.students.find(s => Number(s.seat) === Number(seat));
  }

  function lockSvg() {
    return '<svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z"/></svg>';
  }

  function displayRoomBounds(layout) {
    const points = [];
    const addCells = (groups = []) => {
      for (const group of groups || []) {
        for (const cell of group?.cells || []) {
          const column = Number(cell?.column);
          const row = Number(cell?.row);
          if (Number.isInteger(column) && Number.isInteger(row)) points.push({ column, row });
        }
      }
    };
    addCells(layout?.tables);
    addCells(layout?.doors);
    addCells(layout?.teacherDesks);
    addCells(layout?.projectorScreens);
    for (const seat of layout?.seats || []) {
      const column = Number(seat?.column);
      const row = Number(seat?.row);
      if (Number.isInteger(column) && Number.isInteger(row)) points.push({ column, row });
    }
    if (!points.length) {
      const columns = Math.max(1, Number(layout?.grid?.columns) || 8);
      const rows = Math.max(1, Number(layout?.grid?.rows) || 16);
      return { minCol: 1, maxCol: columns, minRow: 1, maxRow: rows, columns, rows };
    }
    const minCol = Math.min(...points.map(point => point.column));
    const maxCol = Math.max(...points.map(point => point.column));
    const minRow = Math.min(...points.map(point => point.row));
    const maxRow = Math.max(...points.map(point => point.row));
    return {
      minCol,
      maxCol,
      minRow,
      maxRow,
      columns: Math.max(1, maxCol - minCol + 1),
      rows: Math.max(1, maxRow - minRow + 1)
    };
  }

  function displayGroupBounds(cells = []) {
    const valid = (cells || []).map(cell => ({
      column: Number(cell?.column),
      row: Number(cell?.row)
    })).filter(cell => Number.isInteger(cell.column) && Number.isInteger(cell.row));
    if (!valid.length) return null;
    return {
      minCol: Math.min(...valid.map(cell => cell.column)),
      maxCol: Math.max(...valid.map(cell => cell.column)),
      minRow: Math.min(...valid.map(cell => cell.row)),
      maxRow: Math.max(...valid.map(cell => cell.row)),
      cells: valid
    };
  }

  function displayGroupHtml(groups, type, bounds) {
    return (groups || []).map(group => {
      const groupBounds = displayGroupBounds(group?.cells);
      if (!groupBounds) return '';

      // Doors are landmarks, not furniture blocks in presentation mode.
      // Render one centered icon for the entire saved door group.
      if (type === 'door') {
        const localStartCol = groupBounds.minCol - bounds.minCol + 1;
        const localStartRow = groupBounds.minRow - bounds.minRow + 1;
        const colSpan = groupBounds.maxCol - groupBounds.minCol + 1;
        const rowSpan = groupBounds.maxRow - groupBounds.minRow + 1;
        return `<div class="chartroom-door-marker" style="grid-column:${localStartCol} / span ${colSpan};grid-row:${localStartRow} / span ${rowSpan}" title="${escapeHtml(group.label || 'Door')}" aria-label="${escapeHtml(group.label || 'Door')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v16h-2V5H7v16H5V3Zm4 3h6v13H9V6Zm4.25 6.25a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg></div>`;
      }
      const keySet = new Set(groupBounds.cells.map(cell => `${cell.column}:${cell.row}`));
      const cells = groupBounds.cells.map(cell => {
        const localColumn = cell.column - bounds.minCol + 1;
        const localRow = cell.row - bounds.minRow + 1;
        const edges = [
          !keySet.has(`${cell.column}:${cell.row - 1}`) ? 'edge-top' : '',
          !keySet.has(`${cell.column + 1}:${cell.row}`) ? 'edge-right' : '',
          !keySet.has(`${cell.column}:${cell.row + 1}`) ? 'edge-bottom' : '',
          !keySet.has(`${cell.column - 1}:${cell.row}`) ? 'edge-left' : ''
        ].filter(Boolean).join(' ');
        return `<div class="chartroom-object chartroom-${type} ${edges}" style="grid-column:${localColumn};grid-row:${localRow}"></div>`;
      }).join('');

      const localStartCol = groupBounds.minCol - bounds.minCol + 1;
      const localStartRow = groupBounds.minRow - bounds.minRow + 1;
      const colSpan = groupBounds.maxCol - groupBounds.minCol + 1;
      const rowSpan = groupBounds.maxRow - groupBounds.minRow + 1;
      const vertical = rowSpan > colSpan;
      const label = `<div class="chartroom-object-label chartroom-${type}-label ${vertical ? 'vertical-label' : ''}" style="grid-column:${localStartCol} / span ${colSpan};grid-row:${localStartRow} / span ${rowSpan}"><span>${escapeHtml(group.label || type)}</span></div>`;
      return cells + label;
    }).join('');
  }

  function fitRoomCanvas() {
    const canvas = $('.chartroom-canvas', els.tableGrid);
    if (!canvas) return;
    const columns = Math.max(1, Number(canvas.dataset.columns) || 1);
    const columnWeight = Math.max(1, Number(canvas.dataset.columnWeight) || columns);
    const rows = Math.max(1, Number(canvas.dataset.rows) || 1);
    const rect = els.tableGrid.getBoundingClientRect();

    // Fill the available workspace on wide screens, but always scale down to
    // the actual viewport on smaller devices instead of forcing overflow.
    const horizontalInset = window.innerWidth <= 980 ? 12 : 18;
    const verticalInset = window.innerHeight <= 760 ? 10 : 16;
    const availableWidth = Math.max(240, rect.width - horizontalInset * 2);
    const availableHeight = Math.max(260, rect.height - verticalInset * 2);

    canvas.style.width = `${Math.round(availableWidth)}px`;
    canvas.style.height = `${Math.round(availableHeight)}px`;

    // This custom metric drives seats, names, labels, and landmarks. It is
    // intentionally allowed to become smaller on Chromebook-sized screens.
    const widthMetric = availableWidth / columnWeight;
    const heightMetric = (availableHeight / rows) * 1.55;
    const cellMetric = Math.max(24, Math.min(72, widthMetric, heightMetric));
    canvas.style.setProperty('--chartroom-cell-px', `${cellMetric}px`);
  }

  function renderTables() {
    const cls = activeClass();

    if (!cls) {
      els.tableGrid.className = 'chartroom-stage no-class-grid';
      els.tableGrid.innerHTML = `
        <div class="no-class-panel">
          <div class="no-class-icon" aria-hidden="true">＋</div>
          <h2>No classes yet</h2>
          <p>Create a class, then add its roster and draw the room.</p>
          <button class="filled-button" type="button" data-create-first-class>Create a class</button>
        </div>`;
      $('[data-create-first-class]', els.tableGrid)?.addEventListener('click', openNewClassDialog);
      return;
    }

    if (!effectiveLayoutForClass(cls) || !layoutHasSeats(cls)) {
      els.tableGrid.className = 'chartroom-stage no-class-grid';
      els.tableGrid.innerHTML = `
        <div class="no-class-panel setup-needed-panel">
          <div class="no-class-icon warning-icon" aria-hidden="true">!</div>
          <h2>Seating chart needed</h2>
          <p>Create a new room layout or link ${escapeHtml(cls.name)} to a chart from another period.</p>
          <div class="button-row wrap">
            <button class="filled-button" type="button" data-draw-room>New chart</button>
            <button class="outlined-button" type="button" data-share-room>Share chart from other period</button>
          </div>
        </div>`;
      $('[data-draw-room]', els.tableGrid)?.addEventListener('click', openLayoutEditor);
      $('[data-share-room]', els.tableGrid)?.addEventListener('click', openShareChartDialog);
      return;
    }

    const layout = effectiveLayoutForClass(cls);
    const bounds = displayRoomBounds(layout);
    const seatInfos = layoutSeatInfos(cls);

    // Give seat rows extra display space for names. This changes only the
    // presentation tracks, never the saved classroom coordinates.
    const seatRows = new Set(seatInfos.map(info => info.row));
    const objectRows = new Set();
    for (const groups of [layout.tables, layout.doors, layout.teacherDesks, layout.projectorScreens]) {
      for (const group of groups || []) {
        for (const cell of group?.cells || []) {
          const row = Number(cell?.row);
          if (Number.isInteger(row)) objectRows.add(row);
        }
      }
    }
    const rowTemplate = Array.from({ length: bounds.rows }, (_, index) => {
      const sourceRow = bounds.minRow + index;
      if (seatRows.has(sourceRow)) return '2.45fr';
      if (objectRows.has(sourceRow)) return '.92fr';
      return '.55fr';
    }).join(' ');

    // Preserve logical room coordinates, but visually compress columns that
    // contain no seat or room object. An empty column consumes half the width
    // of an occupied column, which keeps intentional aisles without creating
    // oversized blank gaps on wide displays.
    const occupiedColumns = new Set(seatInfos.map(info => info.column));
    for (const groups of [layout.tables, layout.doors, layout.teacherDesks, layout.projectorScreens]) {
      for (const group of groups || []) {
        for (const cell of group?.cells || []) {
          const column = Number(cell?.column);
          if (Number.isInteger(column)) occupiedColumns.add(column);
        }
      }
    }
    const columnWeights = Array.from({ length: bounds.columns }, (_, index) => {
      const sourceColumn = bounds.minCol + index;
      return occupiedColumns.has(sourceColumn) ? 1 : 0.5;
    });
    const columnTemplate = columnWeights.map(weight => `${weight}fr`).join(' ');
    const columnWeight = columnWeights.reduce((sum, weight) => sum + weight, 0);

    // Every student name is above its seat. When two seats are immediately
    // adjacent, bias the labels outward so both remain readable while still
    // following the same name-above-circle rule.
    const nameAlignmentBySeat = new Map();
    const seatsByRow = new Map();
    for (const info of seatInfos) {
      if (!seatsByRow.has(info.row)) seatsByRow.set(info.row, []);
      seatsByRow.get(info.row).push(info);
    }
    for (const rowSeats of seatsByRow.values()) {
      rowSeats.sort((a, b) => a.column - b.column || a.number - b.number);
      rowSeats.forEach(info => nameAlignmentBySeat.set(info.number, 'name-center'));
      for (let index = 0; index < rowSeats.length - 1; index += 1) {
        const left = rowSeats[index];
        const right = rowSeats[index + 1];
        if (right.column - left.column === 1) {
          nameAlignmentBySeat.set(left.number, 'name-out-left');
          nameAlignmentBySeat.set(right.number, 'name-out-right');
          index += 1;
        }
      }
    }

    const seatsHtml = seatInfos.map(info => {
      const student = getStudentBySeat(info.number);
      const localColumn = info.column - bounds.minCol + 1;
      const localRow = info.row - bounds.minRow + 1;
      const nameAlignment = nameAlignmentBySeat.get(info.number) || 'name-center';
      const labelPosition = Number.isInteger(info.tableRow) && info.tableRow < info.row ? 'label-below' : 'label-above';
      const color = validStudentColor(student?.color) || studentColorForIndex(info.number - 1);
      return `
        <div class="chartroom-seat ${student ? '' : 'empty'} ${labelPosition} ${nameAlignment}" style="grid-column:${localColumn};grid-row:${localRow}" data-seat="${info.number}" title="Seat ${info.number}${student ? ` — ${escapeHtml(student.name)}` : ''}">
          <div class="chartroom-token" style="--student-color:${escapeHtml(color)}" ${student ? `data-student-id="${escapeHtml(student.id)}" draggable="true"` : ''}>
            <span class="chartroom-seat-circle">${info.number}</span>
            <span class="chartroom-student-name">${escapeHtml(student?.name || 'Open seat')}</span>
          </div>
        </div>`;
    }).join('');

    els.tableGrid.className = 'chartroom-stage';
    els.tableGrid.innerHTML = `
      <div class="chartroom-canvas" data-columns="${bounds.columns}" data-column-weight="${columnWeight}" data-rows="${bounds.rows}" style="--chartroom-cols:${bounds.columns};--chartroom-rows:${bounds.rows};grid-template-columns:${columnTemplate};grid-template-rows:${rowTemplate}" aria-label="${escapeHtml(cls.name)} classroom layout">
        ${displayGroupHtml(layout.tables, 'table', bounds)}
        ${displayGroupHtml(layout.doors, 'door', bounds)}
        ${displayGroupHtml(layout.teacherDesks, 'desk', bounds)}
        ${displayGroupHtml(layout.projectorScreens, 'projector', bounds)}
        ${seatsHtml}
      </div>`;

    requestAnimationFrame(() => {
      fitRoomCanvas();
      requestAnimationFrame(fitRoomCanvas);
    });
    attachSeatDragHandlers();
  }

  function renderClassSwitcher() {
    const classes = Object.values(state.classes);
    els.classFabBar.innerHTML = classes.map(cls => `
      <button class="class-fab ${cls.id === state.activeClassId ? 'active' : ''}" type="button" data-class-id="${escapeHtml(cls.id)}">${escapeHtml(cls.name)}</button>
    `).join('') + '<button class="class-fab add" type="button" data-add-class aria-label="Create class" title="Create class">+</button>';

    $$('[data-class-id]', els.classFabBar).forEach(button => {
      button.addEventListener('click', () => setActiveClass(button.dataset.classId));
    });
    $('[data-add-class]', els.classFabBar)?.addEventListener('click', openNewClassDialog);
  }

  function setActiveClass(classId) {
    if (!state.classes[classId]) return;
    state.activeClassId = classId;
    saveState();
    renderAll();
  }

  function renderHeader() {
    const cls = activeClass();
    els.classTitle.textContent = cls?.name || 'No classes yet';
    const count = cls?.students.length || 0;
    const seats = cls ? layoutSeatInfos(cls).length : 0;
    els.studentCountChip.textContent = cls
      ? `${count} student${count === 1 ? '' : 's'} · ${seats || 0} seat${seats === 1 ? '' : 's'}`
      : 'Create a class to begin';
    els.shuffleBtn.disabled = !cls || !cls.students.length || !seatingChartReady(cls);
  }

  function setSetupCard(card, status, detail, ready) {
    card?.classList.toggle('setup-missing', !ready);
    card?.classList.toggle('setup-ready', ready);
    if (status) status.textContent = ready ? 'Ready' : 'Missing';
    if (detail) detail.classList?.toggle?.('warning-copy', !ready);
  }

  function renderDashboard() {
    const cls = activeClass();
    const hasClass = Boolean(cls);
    els.dashboardClassSubtitle.textContent = hasClass ? `Setup and seating rules for ${cls.name}` : 'Create your first class';
    els.currentClassName.value = cls?.name || '';
    els.currentClassName.disabled = !hasClass;
    els.renameClassBtn.disabled = !hasClass;
    els.deleteClassBtn.disabled = !hasClass;

    const rosterReady = Boolean(cls?.students.length);
    const layout = cls ? effectiveLayoutForClass(cls) : null;
    const owner = cls ? layoutOwner(cls) : null;
    const linked = Boolean(cls && owner && owner.id !== cls.id);
    const seatCount = cls ? layoutSeatInfos(cls).length : 0;
    const chartReady = Boolean(layout && seatCount && seatCount >= (cls?.students.length || 0));
    setSetupCard(els.rosterSetupCard, els.rosterSetupStatus, els.rosterSetupDetail, rosterReady);
    setSetupCard(els.seatingSetupCard, els.seatingSetupStatus, els.seatingSetupDetail, chartReady);
    els.rosterSetupDetail.textContent = rosterReady ? `${cls.students.length} students loaded.` : 'Import a CSV roster before shuffling seats.';
    if (!layout || !seatCount) els.seatingSetupDetail.textContent = 'Create a new chart or share one from another period.';
    else if (seatCount < cls.students.length) els.seatingSetupDetail.textContent = `${seatCount} seats for ${cls.students.length} students — add ${cls.students.length - seatCount} more seat${cls.students.length - seatCount === 1 ? '' : 's'}.`;
    else els.seatingSetupDetail.textContent = `${seatCount} numbered seats ready.`;

    if (els.chartSourceNote) {
      els.chartSourceNote.textContent = linked
        ? `Linked to ${owner.name}. Changes to its chart automatically update this class.`
        : layout
          ? 'This class owns its chart and can be used as a master for other periods.'
          : 'Choose New chart, or link this class to a chart from another period.';
    }
    els.editSeatingChartBtn.textContent = linked ? 'Edit master chart' : (layout ? 'Edit seating chart' : 'New chart');
    els.shareSeatingChartBtn.textContent = linked ? 'Use a different shared chart' : 'Share chart from other period';
    els.makeIndependentChartBtn.hidden = !linked;
    els.editSeatingChartBtn.disabled = !hasClass;
    els.shareSeatingChartBtn.disabled = !hasClass;
    els.makeIndependentChartBtn.disabled = !hasClass || !linked;
    els.importCsvBtn.disabled = !hasClass;
    els.downloadCsvTemplateBtn.disabled = !hasClass;

    renderFixedSeatControls();
    renderSeparationControls();
    renderBuddyControls();
  }

  function renderFixedSeatControls() {
    const cls = activeClass();
    if (!cls) {
      els.fixedSeatStudent.innerHTML = '<option value="">Create a class first…</option>';
      els.fixedSeatNumber.innerHTML = '<option value="">No seats</option>';
      els.addFixedSeatBtn.disabled = true;
      els.fixedSeatList.innerHTML = '<div class="empty-state">No class selected.</div>';
      return;
    }
    const nonFixed = cls.students.filter(student => !student.fixed);
    els.fixedSeatStudent.innerHTML = '<option value="">Choose student…</option>' + nonFixed.map(student => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)}</option>`).join('');
    const seatInfos = layoutSeatInfos(cls);
    els.fixedSeatNumber.innerHTML = seatInfos.length
      ? '<option value="">Choose seat…</option>' + seatInfos.map(info => `<option value="${info.number}">Seat ${info.number}</option>`).join('')
      : '<option value="">Draw seating chart first…</option>';
    els.addFixedSeatBtn.disabled = !nonFixed.length || !seatInfos.length;

    const fixed = cls.students.filter(student => student.fixed).sort((a, b) => Number(a.seat) - Number(b.seat));
    if (!fixed.length) {
      els.fixedSeatList.innerHTML = '<div class="empty-state">No fixed seats. Add a row only when a student needs one.</div>';
      return;
    }
    els.fixedSeatList.innerHTML = fixed.map(student => `<div class="fixed-seat-row"><span><strong>${escapeHtml(student.name)}</strong><small>Seat ${student.seat}</small></span><button type="button" data-remove-fixed="${escapeHtml(student.id)}" aria-label="Remove fixed seat for ${escapeHtml(student.name)}">×</button></div>`).join('');
    $$('[data-remove-fixed]', els.fixedSeatList).forEach(button => button.addEventListener('click', () => {
      const student = cls.students.find(entry => entry.id === button.dataset.removeFixed);
      if (!student) return;
      student.fixed = false;
      saveState();
      renderFixedSeatControls();
      renderTables();
    }));
  }

  function addFixedSeatRule() {
    const cls = activeClass();
    const studentId = els.fixedSeatStudent.value;
    const seat = Number(els.fixedSeatNumber.value);
    if (!cls || !studentId || !validSeat(seat, cls)) return showToast('Choose a student and seat first.');
    const student = cls.students.find(entry => entry.id === studentId);
    if (!student) return;
    const occupant = cls.students.find(entry => entry.id !== studentId && Number(entry.seat) === seat);
    if (occupant?.fixed) return showToast(`Seat ${seat} is already fixed for ${occupant.name}.`);
    const oldSeat = student.seat;
    student.seat = seat;
    student.fixed = true;
    if (occupant) occupant.seat = oldSeat;
    saveState();
    renderAll();
    if (els.dashboardDialog.open) renderDashboard();
    showToast(`${student.name} fixed in seat ${seat}.`);
  }

  function removeStudent(studentId) {
    const cls = activeClass();
    const student = cls?.students.find(s => s.id === studentId);
    if (!student) return;
    cls.students = cls.students.filter(s => s.id !== studentId);
    cls.separationPool = (cls.separationPool || []).filter(id => id !== studentId);
    cls.buddyGroups = (cls.buddyGroups || []).map(group => group.filter(id => id !== studentId)).filter(group => group.length >= 2);
    delete cls.tableHistory?.[studentId];
    repairSeats(cls);
    saveState();
    renderAll();
    renderDashboard();
    showToast(`${student.name} removed from ${cls.name}.`);
  }

  function renderSeparationControls() {
    const cls = activeClass();
    if (!cls) {
      els.separationPoolStudent.innerHTML = '<option value="">Create a class first…</option>';
      els.addSeparationPoolBtn.disabled = true;
      els.separationPoolList.innerHTML = '<div class="empty-state">No class selected.</div>';
      return;
    }
    const pool = new Set(cls.separationPool || []);
    const available = cls.students.filter(student => !pool.has(student.id));
    els.separationPoolStudent.innerHTML = '<option value="">Choose student…</option>' +
      available.map(student => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)}</option>`).join('');
    els.addSeparationPoolBtn.disabled = !available.length;

    if (!pool.size) {
      els.separationPoolList.innerHTML = '<div class="empty-state">No students in the separation pool.</div>';
      return;
    }

    els.separationPoolList.innerHTML = [...pool].map(studentId => {
      const student = cls.students.find(s => s.id === studentId);
      if (!student) return '';
      return `<span class="rule-chip">${escapeHtml(student.name)}<button type="button" data-remove-pool-student="${escapeHtml(student.id)}" aria-label="Remove ${escapeHtml(student.name)} from separation pool">×</button></span>`;
    }).join('');

    $$('[data-remove-pool-student]', els.separationPoolList).forEach(button => {
      button.addEventListener('click', () => {
        cls.separationPool = cls.separationPool.filter(id => id !== button.dataset.removePoolStudent);
        saveState();
        renderSeparationControls();
      });
    });
  }

  function addSeparationPoolStudent() {
    const cls = activeClass();
    const studentId = els.separationPoolStudent.value;
    if (!cls || !studentId) return showToast('Choose a student first.');
    cls.separationPool = Array.isArray(cls.separationPool) ? cls.separationPool : [];
    if (cls.separationPool.includes(studentId)) return showToast('That student is already in the separation pool.');
    const buddyGroup = (cls.buddyGroups || []).find(group => group.includes(studentId));
    if (buddyGroup) {
      const otherInPool = buddyGroup.find(id => id !== studentId && cls.separationPool.includes(id));
      if (otherInPool) return showToast('Two students in the same buddy group cannot both be in the separation pool.');
    }
    cls.separationPool.push(studentId);
    saveState();
    renderSeparationControls();
    showToast('Student added to the separation pool.');
  }

  function renderBuddyControls() {
    const cls = activeClass();
    const selects = [els.buddyStudentA, els.buddyStudentB, els.buddyStudentC];
    if (!cls) {
      selects.forEach(select => { select.innerHTML = '<option value="">Create a class first…</option>'; });
      els.addBuddyBtn.disabled = true;
      els.buddyRulesList.innerHTML = '<div class="empty-state">No class selected.</div>';
      return;
    }
    const groups = Array.isArray(cls.buddyGroups) ? cls.buddyGroups : [];
    const grouped = new Set(groups.flat());
    const options = cls.students
      .filter(student => !grouped.has(student.id))
      .map(student => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)}</option>`)
      .join('');
    els.buddyStudentA.innerHTML = '<option value="">Choose student…</option>' + options;
    els.buddyStudentB.innerHTML = '<option value="">Choose student…</option>' + options;
    els.buddyStudentC.innerHTML = '<option value="">Optional third student…</option>' + options;
    els.addBuddyBtn.disabled = cls.students.length < 2 || !options;

    if (!groups.length) {
      els.buddyRulesList.innerHTML = '<div class="empty-state">No buddy groups for this class.</div>';
      return;
    }

    els.buddyRulesList.innerHTML = groups.map((group, index) => {
      const names = group.map(id => cls.students.find(student => student.id === id)?.name).filter(Boolean);
      if (names.length < 2) return '';
      return `<span class="rule-chip buddy-group-chip">${names.map(escapeHtml).join(' · ')}<button type="button" data-remove-buddy="${index}" aria-label="Remove buddy group">×</button></span>`;
    }).join('');

    $$('[data-remove-buddy]', els.buddyRulesList).forEach(button => {
      button.addEventListener('click', () => {
        cls.buddyGroups.splice(Number(button.dataset.removeBuddy), 1);
        saveState();
        renderBuddyControls();
      });
    });
  }

  function addBuddyRule() {
    const cls = activeClass();
    if (!cls) return;
    const group = [...new Set([els.buddyStudentA.value, els.buddyStudentB.value, els.buddyStudentC.value].filter(Boolean))];
    if (group.length < 2) return showToast('Choose at least two different students.');
    if (group.length > 3) return showToast('Buddy groups can contain up to three students.');
    cls.buddyGroups = Array.isArray(cls.buddyGroups) ? cls.buddyGroups : [];
    const alreadyGrouped = new Set(cls.buddyGroups.flat());
    if (group.some(id => alreadyGrouped.has(id))) return showToast('Each student can belong to only one buddy group.');
    const pool = new Set(cls.separationPool || []);
    if (group.filter(id => pool.has(id)).length > 1) return showToast('Only one student from a buddy group can be in the separation pool.');
    cls.buddyGroups.push(group);
    saveState();
    renderBuddyControls();
    showToast(`Buddy group of ${group.length} added.`);
  }

  function renameCurrentClass() {
    const cls = activeClass();
    if (!cls) return showToast('Create a class first.');
    const name = els.currentClassName.value.trim();
    if (!name) return showToast('Enter a class name.');
    const duplicate = Object.values(state.classes).some(c => c.id !== cls.id && c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return showToast('A class with that name already exists.');
    const oldName = cls.name;
    cls.name = name;
    saveState();
    renderAll();
    renderDashboard();
    showToast(oldName === name ? 'Class name unchanged.' : `Renamed ${oldName} to ${name}.`);
  }

  function openNewClassDialog() {
    els.newClassNamePrompt.value = '';
    els.newClassDialog.showModal();
    setTimeout(() => els.newClassNamePrompt.focus(), 40);
  }

  function createClass() {
    const name = els.newClassNamePrompt.value.trim();
    if (!name) return showToast('Enter a class name.');
    const duplicate = Object.values(state.classes).some(c => c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return showToast('A class with that name already exists.');
    const id = makeId('class');
    state.classes[id] = { id, name, students: [], layout: null, layoutSourceClassId: null, separationPool: [], buddyGroups: [], tableHistory: {} };
    state.activeClassId = id;
    saveState();
    els.newClassDialog.close();
    renderAll();
    renderDashboard();
    els.dashboardDialog.showModal();
    showToast(`${name} created. Add its roster and seating chart.`);
  }

  function deleteCurrentClass() {
    const cls = activeClass();
    if (!cls) return showToast('There is no class to delete.');
    const dependents = classesUsingLayoutOwner(cls.id).filter(other => other.id !== cls.id);
    const dependencyCopy = cls.layout ? JSON.parse(JSON.stringify(cls.layout)) : null;
    const dependencyNote = dependents.length
      ? `\n\n${dependents.length} linked class${dependents.length === 1 ? '' : 'es'} will keep an independent copy of this seating chart.`
      : '';
    if (!window.confirm(`Delete “${cls.name}” and its settings?${dependencyNote}`)) return;

    for (const dependent of dependents) {
      dependent.layout = dependencyCopy ? JSON.parse(JSON.stringify(dependencyCopy)) : null;
      dependent.layoutSourceClassId = null;
      repairSeats(dependent);
    }

    delete state.classes[cls.id];
    state.activeClassId = Object.keys(state.classes)[0] || '';
    saveState();
    renderAll();
    if (state.activeClassId) renderDashboard(); else els.dashboardDialog.close();
    showToast(dependents.length
      ? `${cls.name} deleted. Linked classes kept independent chart copies.`
      : `${cls.name} deleted.`);
  }

  function openLayoutEditor() {
    const cls = activeClass();
    if (!cls) return showToast('Create a class first.');

    const owner = layoutOwner(cls) || cls;
    layoutEditorTargetClassId = owner.id;
    els.layoutEditorClassName.textContent = owner.id === cls.id
      ? cls.name
      : `${owner.name} · master chart shared with ${cls.name}`;

    const loadLayout = () => {
      try {
        const editor = els.layoutEditorFrame.contentWindow?.DrawSeatingChart;
        if (editor?.loadLayout) editor.loadLayout(owner.layout || blankLayout());
      } catch (error) { console.error('Could not load seating chart editor:', error); }
    };
    if (!els.layoutEditorFrame.getAttribute('src')) {
      els.layoutEditorFrame.addEventListener('load', loadLayout, { once: true });
      els.layoutEditorFrame.src = '/draw-chart';
    } else if (els.layoutEditorFrame.contentDocument?.readyState === 'complete') {
      loadLayout();
    } else {
      els.layoutEditorFrame.addEventListener('load', loadLayout, { once: true });
    }
    els.layoutEditorDialog.showModal();
  }

  function acceptLayoutFromEditor(layout) {
    const owner = state.classes[layoutEditorTargetClassId] || layoutOwner(activeClass()) || activeClass();
    if (!owner) return;
    const normalized = normalizeLayout(layout);
    if (!normalized) return showToast('The seating chart could not be saved.');

    owner.layout = normalized;
    owner.layoutSourceClassId = null;
    const linkedClasses = classesUsingLayoutOwner(owner.id);
    linkedClasses.forEach(repairSeats);

    saveState();
    els.layoutEditorDialog.close();
    layoutEditorTargetClassId = null;
    renderAll();
    if (els.dashboardDialog.open) renderDashboard();
    showToast(linkedClasses.length > 1
      ? `Master seating chart saved for ${owner.name}. ${linkedClasses.length - 1} linked class${linkedClasses.length === 2 ? '' : 'es'} updated.`
      : `Seating chart saved for ${owner.name}.`);
  }

  function shareableLayoutOwners(targetClass = activeClass()) {
    const seen = new Set();
    return Object.values(state.classes)
      .filter(candidate => candidate.id !== targetClass?.id)
      .map(candidate => layoutOwner(candidate))
      .filter(owner => {
        if (!owner || owner.id === targetClass?.id || seen.has(owner.id)) return false;
        seen.add(owner.id);
        return Boolean(owner.layout && layoutHasSeats(owner));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function openShareChartDialog() {
    const cls = activeClass();
    if (!cls) return showToast('Create a class first.');
    const owners = shareableLayoutOwners(cls);
    if (!owners.length) return showToast('Create a seating chart in another class first.');

    els.shareChartClassSelect.innerHTML = owners
      .map(owner => `<option value="${escapeHtml(owner.id)}">${escapeHtml(owner.name)}</option>`)
      .join('');
    els.shareChartDialog.showModal();
    setTimeout(() => els.shareChartClassSelect.focus(), 30);
  }

  function shareChartFromOtherClass() {
    const cls = activeClass();
    if (!cls) return;
    const source = state.classes[els.shareChartClassSelect.value];
    const owner = layoutOwner(source);
    if (!owner || owner.id === cls.id || !owner.layout || !layoutHasSeats(owner)) {
      return showToast('Choose a class with a completed seating chart.');
    }

    if (effectiveLayoutForClass(cls) && !cls.layoutSourceClassId) {
      const replaceOwn = window.confirm(`Replace ${cls.name}'s current chart with a live link to ${owner.name}?`);
      if (!replaceOwn) return;
    }

    cls.layout = null;
    cls.layoutSourceClassId = owner.id;
    repairSeats(cls);
    saveState();
    els.shareChartDialog.close();
    renderAll();
    if (els.dashboardDialog.open) renderDashboard();
    showToast(`${cls.name} is now linked to ${owner.name}'s seating chart.`);
  }

  function makeChartIndependent() {
    const cls = activeClass();
    if (!cls?.layoutSourceClassId) return;
    const owner = layoutOwner(cls);
    const layout = effectiveLayoutForClass(cls);
    if (!layout || !owner) return showToast('The shared chart is no longer available.');

    cls.layout = JSON.parse(JSON.stringify(layout));
    cls.layoutSourceClassId = null;
    repairSeats(cls);
    saveState();
    renderAll();
    if (els.dashboardDialog.open) renderDashboard();
    showToast(`${cls.name} now has an independent copy of ${owner.name}'s chart.`);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell);
        if (row.some(value => value.trim() !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    return rows;
  }

  function truthyCsv(value) {
    return ['true', '1', 'yes', 'y', 'x', 'fixed'].includes(String(value || '').trim().toLowerCase());
  }

  async function importCsv(file) {
    const cls = activeClass();
    if (!cls) return showToast('Create a class before importing a roster.');
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) return showToast('The CSV has no student rows.');

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const nameIndex = headers.indexOf('name');
    const seatIndex = headers.indexOf('seat');
    const fixedIndex = headers.indexOf('fixed');
    const poolIndex = headers.indexOf('separation_pool');
    const legacySeparateIndex = headers.indexOf('separate_from');
    if (nameIndex === -1) return showToast('CSV must include a “name” column.');

    const dataRows = rows.slice(1).filter(r => String(r[nameIndex] || '').trim());
    if (dataRows.length > MAX_STUDENTS) return showToast(`This app supports up to ${MAX_STUDENTS} students per class. Your CSV has ${dataRows.length}.`, 4500);

    const previousByName = new Map(cls.students.map(student => [student.name.trim().toLowerCase(), student]));
    const seatNumbers = layoutSeatNumbers(cls);
    const assignedColors = new Set();
    const students = dataRows.map((r, i) => {
      const name = String(r[nameIndex] || '').trim();
      const previous = previousByName.get(name.toLowerCase());
      let color = validStudentColor(previous?.color);
      if (!color) color = STUDENT_COLOR_PALETTE.find(candidate => !assignedColors.has(candidate)) || studentColorForIndex(i);
      assignedColors.add(color);
      const requestedSeat = seatIndex >= 0 ? Number(r[seatIndex]) : null;
      return {
        id: previous?.id || makeId('student'),
        name,
        seat: validSeat(requestedSeat, cls) ? requestedSeat : (validSeat(previous?.seat, cls) ? Number(previous.seat) : (seatNumbers[i] ?? null)),
        fixed: fixedIndex >= 0 ? truthyCsv(r[fixedIndex]) : Boolean(previous?.fixed),
        color,
        rawPool: poolIndex >= 0 ? truthyCsv(r[poolIndex]) : false,
        legacySeparate: legacySeparateIndex >= 0 ? String(r[legacySeparateIndex] || '').trim() : ''
      };
    });

    const seenNames = new Set();
    for (const student of students) {
      const key = student.name.toLowerCase();
      if (seenNames.has(key)) return showToast(`Duplicate student name in CSV: ${student.name}`);
      seenNames.add(key);
    }

    cls.students = students.map(({ rawPool, legacySeparate, ...student }) => student);
    repairSeats(cls);

    const idByName = new Map(cls.students.map(student => [student.name.toLowerCase(), student.id]));
    const pool = new Set(students.filter(student => student.rawPool).map(student => idByName.get(student.name.toLowerCase())).filter(Boolean));
    students.forEach(student => {
      if (!student.legacySeparate) return;
      const fromId = idByName.get(student.name.toLowerCase());
      if (fromId) pool.add(fromId);
      student.legacySeparate.split(';').map(value => value.trim()).filter(Boolean).forEach(name => {
        const toId = idByName.get(name.toLowerCase());
        if (toId) pool.add(toId);
      });
    });

    cls.separationPool = [...pool];
    cls.buddyGroups = [];
    cls.tableHistory = {};
    saveState();
    renderAll();
    renderDashboard();
    const seatCount = layoutSeatNumbers(cls).length;
    showToast(seatCount && cls.students.length > seatCount
      ? `${cls.students.length} students imported. Add ${cls.students.length - seatCount} more seat${cls.students.length - seatCount === 1 ? '' : 's'} to the seating chart.`
      : `${cls.students.length} students imported into ${cls.name}.`, 4800);
  }

  function downloadBlob(contents, filename, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCsvTemplate() {
    const csv = [
      'name',
      'Alex Rivera',
      'Jordan Lee',
      'Sam Patel',
      'Taylor Nguyen'
    ].join('\n');
    downloadBlob(csv, 'seating-chart-template.csv', 'text/csv;charset=utf-8');
  }


  function tableForSeat(seat, classData = activeClass()) {
    return seatTableId(classData, seat);
  }

  function randomFloat() {
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }
    return Math.random();
  }

  function shuffled(array) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(randomFloat() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function seatDistanceSquared(classData, seatA, seatB) {
    const a = seatInfoFor(classData, seatA);
    const b = seatInfoFor(classData, seatB);
    if (!a || !b) return 0;
    const dx = a.column - b.column;
    const dy = a.row - b.row;
    return dx * dx + dy * dy;
  }

  function poolScore(classData, placements, poolIds) {
    const seats = poolIds.map(id => placements.get(id)).filter(seat => validSeat(seat, classData));
    if (seats.length < 2) return { min: Infinity, total: 0 };
    let min = Infinity;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const distance = seatDistanceSquared(classData, seats[i], seats[j]);
        min = Math.min(min, distance);
        total += distance;
      }
    }
    return { min, total };
  }

  function recentTablesForStudent(cls, studentId) {
    const history = cls.tableHistory && typeof cls.tableHistory === 'object' ? cls.tableHistory[studentId] : null;
    return Array.isArray(history) ? history.slice(-TABLE_HISTORY_LIMIT) : [];
  }

  function tableHistoryPenalty(history, candidateTable) {
    const reversed = history.slice().reverse();
    const weights = [8, 5, 3, 1.5];
    return reversed.reduce((penalty, table, index) => penalty + (String(table) === String(candidateTable) ? (weights[index] || 1) : 0), 0);
  }

  function tableKeyForSeat(cls, seat) {
    return tableForSeat(seat, cls) || `seat:${seat}`;
  }

  function recordTableHistory(cls) {
    cls.tableHistory = cls.tableHistory && typeof cls.tableHistory === 'object' ? cls.tableHistory : {};
    const liveIds = new Set(cls.students.map(student => student.id));
    Object.keys(cls.tableHistory).forEach(studentId => {
      if (!liveIds.has(studentId)) delete cls.tableHistory[studentId];
    });
    cls.students.forEach(student => {
      if (!validSeat(student.seat, cls)) return;
      const history = Array.isArray(cls.tableHistory[student.id]) ? cls.tableHistory[student.id] : [];
      history.push(String(tableKeyForSeat(cls, student.seat)));
      cls.tableHistory[student.id] = history.slice(-TABLE_HISTORY_LIMIT);
    });
  }

  function buddyGroupMap(cls) {
    const map = new Map();
    for (const group of cls.buddyGroups || []) {
      if (!Array.isArray(group) || group.length < 2) continue;
      for (const studentId of group) map.set(studentId, group);
    }
    return map;
  }

  function validateFixedRules(cls, byId, poolIds, buddyGroups) {
    const fixedSeats = new Set();
    for (const student of cls.students.filter(student => student.fixed)) {
      if (!validSeat(student.seat, cls)) return `${student.name} has an invalid fixed seat.`;
      if (fixedSeats.has(Number(student.seat))) return `Two fixed students are assigned to seat ${student.seat}.`;
      fixedSeats.add(Number(student.seat));
    }

    for (let i = 0; i < poolIds.length; i++) {
      const a = byId.get(poolIds[i]);
      if (!a?.fixed) continue;
      for (let j = i + 1; j < poolIds.length; j++) {
        const b = byId.get(poolIds[j]);
        if (!b?.fixed) continue;
        if (!separationPairAllowed(cls, a.seat, b.seat)) return `${a.name} and ${b.name} have fixed seats that are too close for the separation pool.`;
      }
    }

    for (const group of buddyGroups) {
      const fixedMembers = group.map(id => byId.get(id)).filter(student => student?.fixed);
      if (fixedMembers.length < 2) continue;
      const tables = new Set(fixedMembers.map(student => tableForSeat(student.seat, cls)));
      if (tables.has(null) || tables.size > 1) return `The fixed seats for ${fixedMembers.map(student => student.name).join(', ')} are not at the same table group.`;
    }
    return null;
  }

  function findValidShuffle(cls) {
    if (!effectiveLayoutForClass(cls) || !layoutHasSeats(cls)) return { error: 'Create or link a seating chart before shuffling.' };
    if (cls.students.length > layoutSeatInfos(cls).length) return { error: 'The seating chart does not have enough seats for this roster.' };

    const byId = new Map(cls.students.map(student => [student.id, student]));
    const seatInfos = layoutSeatInfos(cls);
    const allSeats = seatInfos.map(info => info.number);
    const poolIds = [...new Set((cls.separationPool || []).filter(id => byId.has(id)))];
    const poolSet = new Set(poolIds);
    const buddyGroups = (cls.buddyGroups || []).filter(group => Array.isArray(group) && group.length >= 2 && group.length <= 3 && group.every(id => byId.has(id)));
    const buddyMap = buddyGroupMap({ ...cls, buddyGroups });

    for (const group of buddyGroups) {
      if (group.filter(id => poolSet.has(id)).length > 1) return { error: 'Only one student from a buddy group can be in the separation pool.' };
    }

    const tableIds = new Set(seatInfos.map(info => info.tableId).filter(Boolean));
    if (tableIds.size && poolIds.length > tableIds.size) return { error: `The separation pool has ${poolIds.length} students but the drawn room has only ${tableIds.size} table groups.` };
    if (buddyGroups.length && !tableIds.size) return { error: 'Buddy groups require table objects in the seating chart.' };

    const fixedRuleError = validateFixedRules(cls, byId, poolIds, buddyGroups);
    if (fixedRuleError) return { error: fixedRuleError };

    const fixed = cls.students.filter(student => student.fixed);
    const fixedPlacement = new Map(fixed.map(student => [student.id, Number(student.seat)]));
    const fixedSeats = new Set(fixed.map(student => Number(student.seat)));
    const movingStudents = cls.students.filter(student => !student.fixed);
    const currentSeatById = new Map(cls.students.map(student => [student.id, Number(student.seat)]));
    const recentTablesById = new Map(movingStudents.map(student => [student.id, recentTablesForStudent(cls, student.id)]));
    const currentPoolSeatSet = new Set(poolIds.map(id => currentSeatById.get(id)).filter(seat => validSeat(seat, cls)));
    const candidates = [];
    const maxRestarts = 90;
    const maxNodes = 120000;

    for (let restart = 0; restart < maxRestarts && candidates.length < 45; restart++) {
      const placements = new Map(fixedPlacement);
      const used = new Set(fixedSeats);
      const ordered = movingStudents.map(student => {
        const group = buddyMap.get(student.id);
        const fixedBuddy = group?.some(id => byId.get(id)?.fixed);
        let weight = randomFloat();
        if (poolSet.has(student.id)) weight += 12;
        if (group) weight += 7;
        if (fixedBuddy) weight += 14;
        return { student, weight };
      }).sort((a, b) => b.weight - a.weight).map(entry => entry.student);

      const canPlace = (student, seat) => {
        const info = seatInfoFor(cls, seat);
        if (!info) return false;

        if (poolSet.has(student.id)) {
          for (const otherId of poolIds) {
            if (otherId === student.id || !placements.has(otherId)) continue;
            if (!separationPairAllowed(cls, seat, placements.get(otherId))) return false;
          }
        }

        const group = buddyMap.get(student.id);
        if (group) {
          if (!info.tableId) return false;
          const placedOthers = group.filter(id => id !== student.id && placements.has(id));
          if (placedOthers.some(id => tableForSeat(placements.get(id), cls) !== info.tableId)) return false;
          const unplacedOthers = group.filter(id => id !== student.id && !placements.has(id));
          const remainingAtTable = seatInfos.filter(candidate => candidate.tableId === info.tableId && candidate.number !== seat && !used.has(candidate.number)).length;
          if (remainingAtTable < unplacedOthers.length) return false;
        }
        return true;
      };

      let nodes = 0;
      const backtrack = index => {
        nodes++;
        if (nodes > maxNodes) return false;
        if (index >= ordered.length) return true;
        const student = ordered[index];
        const oldSeat = currentSeatById.get(student.id);
        const oldTable = validSeat(oldSeat, cls) ? tableKeyForSeat(cls, oldSeat) : null;
        const choices = shuffled(allSeats.filter(seat => !used.has(seat) && canPlace(student, seat))).map(seat => {
          const candidateTable = tableKeyForSeat(cls, seat);
          let penalty = randomFloat() * 1.5;
          if (seat === oldSeat) penalty += 28;
          if (oldTable && candidateTable === oldTable) penalty += 9;
          penalty += tableHistoryPenalty(recentTablesById.get(student.id) || [], candidateTable);
          if (poolSet.has(student.id)) {
            if (currentPoolSeatSet.has(seat)) penalty += 4;
            const placedPoolSeats = poolIds.filter(id => placements.has(id)).map(id => placements.get(id));
            if (placedPoolSeats.length) {
              const minDistance = Math.min(...placedPoolSeats.map(otherSeat => seatDistanceSquared(cls, seat, otherSeat)));
              penalty -= Math.min(8, minDistance * .18);
            }
          }
          return { seat, penalty };
        }).sort((a, b) => a.penalty - b.penalty);

        for (const { seat } of choices) {
          placements.set(student.id, seat);
          used.add(seat);
          if (backtrack(index + 1)) return true;
          used.delete(seat);
          placements.delete(student.id);
        }
        return false;
      };

      if (!backtrack(0)) continue;
      if (!seatingRulesSatisfied(cls, placements)) continue;

      let novelty = 0;
      for (const student of movingStudents) {
        const oldSeat = currentSeatById.get(student.id);
        const newSeat = placements.get(student.id);
        if (!validSeat(newSeat, cls)) continue;
        if (newSeat !== oldSeat) novelty += 1.5;
        const oldTable = validSeat(oldSeat, cls) ? tableKeyForSeat(cls, oldSeat) : null;
        const newTable = tableKeyForSeat(cls, newSeat);
        if (oldTable && newTable !== oldTable) novelty += 2.75;
        const history = recentTablesById.get(student.id) || [];
        if (history.length && !history.includes(String(newTable))) novelty += 3;
        novelty -= tableHistoryPenalty(history, newTable) * .55;
      }
      const poolGeometry = poolScore(cls, placements, poolIds);
      if (Number.isFinite(poolGeometry.min)) novelty += poolGeometry.min * .12 + poolGeometry.total * .015;
      candidates.push({ placements: new Map(placements), novelty });
    }

    if (!candidates.length) return { error: 'No valid shuffle could satisfy the fixed-seat, separation, and buddy-group rules. Check the drawn seat spacing and rules.' };
    candidates.sort((a, b) => b.novelty - a.novelty);
    const best = candidates[0].novelty;
    const fuzzy = candidates.filter(candidate => candidate.novelty >= best - 4).slice(0, 16);
    return fuzzy[Math.floor(randomFloat() * fuzzy.length)] || candidates[0];
  }

  function seatingRulesSatisfied(cls, placements) {
    const poolIds = [...new Set((cls.separationPool || []).filter(id => placements.has(id)))];
    for (let i = 0; i < poolIds.length; i++) {
      for (let j = i + 1; j < poolIds.length; j++) {
        if (!separationPairAllowed(cls, placements.get(poolIds[i]), placements.get(poolIds[j]))) return false;
      }
    }
    for (const group of cls.buddyGroups || []) {
      const seats = group.filter(id => placements.has(id)).map(id => placements.get(id));
      if (seats.length < 2) continue;
      const tables = new Set(seats.map(seat => tableForSeat(seat, cls)));
      if (tables.has(null) || tables.size !== 1) return false;
    }
    return true;
  }

  function manualMoveStudent(studentId, targetSeat) {
    const cls = activeClass();
    const student = cls?.students.find(entry => entry.id === studentId);
    if (!student || !validSeat(targetSeat, cls) || Number(student.seat) === Number(targetSeat)) return;

    const occupant = cls.students.find(entry => entry.id !== studentId && Number(entry.seat) === Number(targetSeat));
    if (student.fixed || occupant?.fixed) {
      showToast('That move is blocked by a fixed-seat rule.');
      return;
    }

    const oldSeat = Number(student.seat);
    const placements = new Map(cls.students.filter(entry => validSeat(entry.seat, cls)).map(entry => [entry.id, Number(entry.seat)]));
    placements.set(student.id, Number(targetSeat));
    if (occupant) placements.set(occupant.id, oldSeat);

    if (!seatingRulesSatisfied(cls, placements)) {
      showToast('That swap would break a separation or buddy-group rule.');
      return;
    }

    student.seat = Number(targetSeat);
    if (occupant) occupant.seat = oldSeat;
    saveState();
    renderTables();
    if (els.dashboardDialog.open) renderDashboard();
  }

  function attachSeatDragHandlers() {
    $$('.chartroom-token[data-student-id]', els.tableGrid).forEach(token => {
      token.addEventListener('dragstart', event => {
        draggedStudentId = token.dataset.studentId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedStudentId);
        requestAnimationFrame(() => token.classList.add('is-dragging'));
      });
      token.addEventListener('dragend', () => {
        draggedStudentId = null;
        token.classList.remove('is-dragging');
        $$('.chartroom-seat.drop-target', els.tableGrid).forEach(seat => seat.classList.remove('drop-target'));
      });
    });

    $$('.chartroom-seat', els.tableGrid).forEach(seat => {
      seat.addEventListener('dragover', event => {
        if (!draggedStudentId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        seat.classList.add('drop-target');
      });
      seat.addEventListener('dragleave', event => {
        if (!seat.contains(event.relatedTarget)) seat.classList.remove('drop-target');
      });
      seat.addEventListener('drop', event => {
        event.preventDefault();
        const studentId = draggedStudentId || event.dataTransfer.getData('text/plain');
        draggedStudentId = null;
        seat.classList.remove('drop-target');
        $$('.chartroom-seat.drop-target', els.tableGrid).forEach(entry => entry.classList.remove('drop-target'));
        if (studentId) manualMoveStudent(studentId, Number(seat.dataset.seat));
      });
    });
  }

  function animateShuffle(placements, onComplete) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const cls = activeClass();
    const moving = cls.students.filter(student => !student.fixed && placements.get(student.id) !== student.seat);
    if (reduceMotion || !moving.length) {
      onComplete();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'shuffle-overlay';
    document.body.appendChild(overlay);
    const clones = [];

    // Animate only the student's colored ring, not the name label. Names fade
    // during the shuffle and reappear at their final above/below position.
    for (const student of moving) {
      const originToken = $$('.chartroom-token[data-student-id]', els.tableGrid).find(token => token.dataset.studentId === student.id);
      const destinationSeat = placements.get(student.id);
      const destination = $(`.chartroom-seat[data-seat="${destinationSeat}"]`, els.tableGrid);
      const originCircle = originToken?.querySelector('.chartroom-seat-circle');
      const destinationCircle = destination?.querySelector('.chartroom-seat-circle');
      if (!originCircle || !destinationCircle) continue;

      const start = originCircle.getBoundingClientRect();
      const finish = destinationCircle.getBoundingClientRect();
      const clone = originCircle.cloneNode(true);
      clone.textContent = '';
      clone.className = 'shuffle-ring';
      const studentColor = getComputedStyle(originCircle).borderColor;
      clone.style.setProperty('--shuffle-color', studentColor);
      clone.style.left = `${start.left}px`;
      clone.style.top = `${start.top}px`;
      clone.style.width = `${start.width}px`;
      clone.style.height = `${start.height}px`;
      overlay.appendChild(clone);
      originToken.classList.add('shuffle-origin-hidden');
      clones.push({
        clone,
        dx: finish.left - start.left,
        dy: finish.top - start.top
      });
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      clones.forEach(({ clone, dx, dy }) => {
        clone.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    }));

    shuffleTimer = setTimeout(() => {
      overlay.remove();
      $$('.shuffle-origin-hidden', els.tableGrid).forEach(token => token.classList.remove('shuffle-origin-hidden'));
      onComplete();
    }, 700);
  }

  function shuffleSeats() {
    const cls = activeClass();
    if (!cls?.students.length) return showToast('Import some students before shuffling.');
    const result = findValidShuffle(cls);
    if (result.error || !result.placements) return showToast(result.error || 'Could not create a valid shuffle.', 5000);

    clearTimeout(shuffleTimer);
    els.shuffleBtn.disabled = true;
    document.body.classList.add('is-shuffling');

    animateShuffle(result.placements, () => {
      cls.students.forEach(student => {
        const seat = result.placements.get(student.id);
        if (seat) student.seat = seat;
      });
      recordTableHistory(cls);
      saveState();
      document.body.classList.remove('is-shuffling');
      els.shuffleBtn.disabled = false;
      renderTables();
      if (els.dashboardDialog.open) renderDashboard();

    });
  }

  function loadAttendanceStatus() {
    return state.attendanceStatus || { dismissedPeriodKey: '' };
  }

  function saveAttendanceStatus() {
    state.attendanceStatus = attendanceStatus;
    saveState();
  }

  function attendanceDateKey(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function attendancePeriodKey(now, schedule, entry) {
    const period = entry.period || (schedule.dayType === 'A' ? entry.slot : entry.slot + 4);
    return `${attendanceDateKey(now)}|${schedule.key}|${schedule.dayType}|P${period}|${entry.start}`;
  }

  function hideAttendanceReminder() {
    els.attendanceReminder.hidden = true;
  }

  function ensureAttendanceAudio() {
    if (attendanceAudioContext) return attendanceAudioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      attendanceAudioContext = new AudioContextClass();
      return attendanceAudioContext;
    } catch (error) {
      return null;
    }
  }

  function unlockAttendanceAudio() {
    const context = ensureAttendanceAudio();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }

  function playAttendanceDing(volumeMultiplier = 1) {
    const context = ensureAttendanceAudio();
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    const peakGain = Math.min(0.45, 0.18 * volumeMultiplier);
    [0, 0.13].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1175, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.18);
    });
  }

  function updateAttendanceReminder(now, schedule, activeEntry) {
    if (!activeEntry || activeEntry.type === 'lunch' || !schedule?.key) {
      attendanceRuntime = { periodKey: null, lastDingMarker: '' };
      hideAttendanceReminder();
      return;
    }

    const startSeconds = minutesFromClock(activeEntry.start) * 60;
    const endSeconds = minutesFromClock(activeEntry.end) * 60;
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const elapsedSeconds = Math.max(0, nowSeconds - startSeconds);
    const periodDurationSeconds = Math.max(1, endSeconds - startSeconds);
    const halfwaySeconds = periodDurationSeconds / 2;
    const periodKey = attendancePeriodKey(now, schedule, activeEntry);

    if (attendanceRuntime.periodKey !== periodKey) {
      attendanceRuntime = { periodKey, lastDingMarker: '' };
    }

    if (attendanceStatus.dismissedPeriodKey === periodKey || elapsedSeconds < ATTENDANCE_FIRST_INTERVAL_SECONDS) {
      hideAttendanceReminder();
      return;
    }

    const afterHalfway = elapsedSeconds >= halfwaySeconds;
    const periodLabel = entryLabel(activeEntry, schedule.dayType);
    els.attendanceReminderDetail.textContent = afterHalfway
      ? `${periodLabel} · second half · tap to dismiss`
      : `${periodLabel} · tap to dismiss for this period`;
    els.attendanceReminder.hidden = false;

    let dingMarker = '';
    if (afterHalfway) {
      const lateBucket = Math.floor((elapsedSeconds - halfwaySeconds) / ATTENDANCE_LATE_INTERVAL_SECONDS);
      dingMarker = `late-${lateBucket}`;
    } else {
      const earlyBucket = Math.floor(elapsedSeconds / ATTENDANCE_FIRST_INTERVAL_SECONDS);
      if (earlyBucket >= 1) dingMarker = `early-${earlyBucket}`;
    }

    if (dingMarker && dingMarker !== attendanceRuntime.lastDingMarker) {
      attendanceRuntime.lastDingMarker = dingMarker;
      playAttendanceDing(afterHalfway ? 1.5 : 1);
    }
  }

  function dismissAttendanceReminder() {
    if (!attendanceRuntime.periodKey) return;
    attendanceStatus.dismissedPeriodKey = attendanceRuntime.periodKey;
    saveAttendanceStatus();
    hideAttendanceReminder();
  }

  function periodNumberForSlot(slot, now = new Date()) {
    return effectiveDayType(now) === 'A' ? slot : slot + 4;
  }

  function minutesFromClock(value) {
    return window.CALInfo.minutesFromClock(value);
  }

  function formatClock(value) {
    return window.CALInfo.formatClock(value);
  }

  function scheduleForNow(now) {
    return window.CALInfo.scheduleForNow(schoolConfig, {
      dayOverride: state.dayOverride,
      scheduleOverride: state.scheduleOverride,
      fallbackDayType: state.dayType
    }, now);
  }

  function entryLabel(entry, dayType) {
    return window.CALInfo.entryLabel(entry, dayType);
  }

  function formatTabCountdown(secondsLeft) {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function updateTabTitle(label = '', secondsLeft = null) {
    const className = activeClass()?.name || 'Seating Chart';
    if (Number.isFinite(secondsLeft)) {
      const shortLabel = label.replace(/^Period\s+/i, 'P');
      document.title = `${formatTabCountdown(secondsLeft)} · ${shortLabel} · ${className}`;
    } else if (label) {
      document.title = `${label} · ${className}`;
    } else {
      document.title = `Seating Chart · ${className}`;
    }
  }

  function updateClockAndSchedule() {
    const now = new Date();
    const snapshot = window.CALInfo.snapshot(schoolConfig, {
      dayOverride: state.dayOverride,
      scheduleOverride: state.scheduleOverride,
      fallbackDayType: state.dayType
    }, now);

    els.clockTime.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    els.clockDate.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    renderDayToggle(now);

    els.scheduleStatus.textContent = snapshot.scheduleStatus;
    els.scheduleTime.textContent = snapshot.scheduleTime;
    els.scheduleRemaining.textContent = snapshot.scheduleRemaining;
    els.scheduleModeLabel.textContent = snapshot.scheduleModeLabel;

    if (snapshot.schedule?.unconfigured && currentUser?.role?.includes?.('admin')) {
      els.scheduleRemaining.textContent = 'Configure this in the Admin panel';
    } else if (snapshot.schedule?.special) {
      els.scheduleRemaining.textContent = 'Use the override menu if needed';
    }

    updateAttendanceReminder(now, snapshot.schedule, snapshot.activeEntry);
    updateTabTitle(snapshot.titleLabel, snapshot.secondsLeft);
  }

  function renderScheduleDialog() {
    const scheduleRadio = $(`input[name="scheduleOverride"][value="${state.scheduleOverride}"]`, els.scheduleDialog);
    if (scheduleRadio) scheduleRadio.checked = true;
    const dayRadio = $(`input[name="dayOverride"][value="${state.dayOverride}"]`, els.scheduleDialog);
    if (dayRadio) dayRadio.checked = true;
  }

  function applyScheduleOverride() {
    const scheduleSelected = $('input[name="scheduleOverride"]:checked', els.scheduleDialog);
    const daySelected = $('input[name="dayOverride"]:checked', els.scheduleDialog);
    if (!scheduleSelected || !daySelected) return;
    state.scheduleOverride = scheduleSelected.value;
    state.dayOverride = daySelected.value;
    if (state.dayOverride === 'A' || state.dayOverride === 'B') state.dayType = state.dayOverride;
    saveState();
    renderDayToggle();
    updateClockAndSchedule();
    els.scheduleDialog.close();
    showToast('Day and schedule settings updated.');
  }

  function applyUserChrome() {
    if (els.signedInAs) els.signedInAs.textContent = currentUser?.name || currentUser?.email || 'Teacher';
    const roles = String(currentUser?.role || '').split(',').map(value => value.trim());
    if (els.adminPanelLink) els.adminPanelLink.hidden = !roles.includes('admin');
  }

  function renderAll() {
    applyUserChrome();
    applySidebarWidth();
    applySidebarVisibility();
    renderDayToggle();
    renderHeader();
    renderTables();
    renderClassSwitcher();
    updateClockAndSchedule();
  }

  els.dayToggle.addEventListener('click', () => {
    renderScheduleDialog();
    els.scheduleDialog.showModal();
  });

  els.sidebarCollapseBtn?.addEventListener('click', () => setSidebarCollapsed(true));
  els.sidebarRevealBtn?.addEventListener('click', () => setSidebarCollapsed(false));

  function setSidebarWidth(width, persist = false) {
    state.sidebarWidth = Math.min(420, Math.max(190, Math.round(width)));
    applySidebarWidth();
    if (persist) saveState();
  }

  function updateSidebarFocusButton(enabled) {
    els.sidebarFocusBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    els.sidebarFocusLabel.textContent = enabled ? 'Exit full-screen info' : 'Full-screen info';
  }

  async function setSidebarFocus(enabled) {
    document.body.classList.toggle('sidebar-focus', enabled);
    if (enabled) document.body.classList.remove('sidebar-collapsed');
    else applySidebarVisibility();
    updateSidebarFocusButton(enabled);
    if (enabled) {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch (error) {
        // The app-level full-screen layout still works when browser fullscreen is unavailable.
      }
    } else if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch (error) { /* no-op */ }
    }
  }

  let sidebarDragStartX = 0;
  let sidebarDragStartWidth = 0;
  els.sidebarResizer.addEventListener('pointerdown', event => {
    if (window.innerWidth <= 760) return;
    sidebarDragStartX = event.clientX;
    sidebarDragStartWidth = state.sidebarWidth;
    document.body.classList.add('resizing-sidebar');
    els.sidebarResizer.setPointerCapture(event.pointerId);
  });
  els.sidebarResizer.addEventListener('pointermove', event => {
    if (!els.sidebarResizer.hasPointerCapture(event.pointerId)) return;
    setSidebarWidth(sidebarDragStartWidth + (event.clientX - sidebarDragStartX));
  });
  const finishSidebarResize = event => {
    if (!els.sidebarResizer.hasPointerCapture(event.pointerId)) return;
    els.sidebarResizer.releasePointerCapture(event.pointerId);
    document.body.classList.remove('resizing-sidebar');
    saveState();
  };
  els.sidebarResizer.addEventListener('pointerup', finishSidebarResize);
  els.sidebarResizer.addEventListener('pointercancel', finishSidebarResize);
  els.sidebarResizer.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSidebarWidth(state.sidebarWidth + (event.key === 'ArrowRight' ? 12 : -12), true);
  });

  els.signOutBtn?.addEventListener('click', async () => {
    await persistStateNow();
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/login');
  });

  els.sidebarFocusBtn.addEventListener('click', () => setSidebarFocus(!document.body.classList.contains('sidebar-focus')));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('sidebar-focus')) {
      document.body.classList.remove('sidebar-focus');
      updateSidebarFocusButton(false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-focus') && !document.fullscreenElement) setSidebarFocus(false);
  });

  els.attendanceReminder.addEventListener('click', dismissAttendanceReminder);
  document.addEventListener('pointerdown', unlockAttendanceAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAttendanceAudio, { once: true });
  document.addEventListener('visibilitychange', updateClockAndSchedule);

  els.shuffleBtn.addEventListener('click', shuffleSeats);
  els.openDashboardBtn.addEventListener('click', () => {
    if (!activeClass()) return openNewClassDialog();
    renderDashboard();
    els.dashboardDialog.showModal();
  });
  els.scheduleGear.addEventListener('click', () => {
    renderScheduleDialog();
    els.scheduleDialog.showModal();
  });
  els.applyScheduleBtn.addEventListener('click', event => {
    event.preventDefault();
    applyScheduleOverride();
  });

  els.renameClassBtn.addEventListener('click', renameCurrentClass);
  els.currentClassName.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      renameCurrentClass();
    }
  });
  els.newClassForm.addEventListener('submit', event => {
    event.preventDefault();
    createClass();
  });
  els.editSeatingChartBtn.addEventListener('click', openLayoutEditor);
  els.shareSeatingChartBtn.addEventListener('click', openShareChartDialog);
  els.makeIndependentChartBtn.addEventListener('click', makeChartIndependent);
  els.shareChartForm.addEventListener('submit', event => {
    event.preventDefault();
    shareChartFromOtherClass();
  });
  els.shareChartCancelBtn.addEventListener('click', () => els.shareChartDialog.close());
  els.addFixedSeatBtn.addEventListener('click', addFixedSeatRule);
  els.layoutEditorCloseBtn.addEventListener('click', () => els.layoutEditorDialog.close());
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== els.layoutEditorFrame.contentWindow) return;
    if (event.data?.type === 'draw-seating-chart:done') acceptLayoutFromEditor(event.data.layout);
  });
  els.deleteClassBtn.addEventListener('click', deleteCurrentClass);
  els.importCsvBtn.addEventListener('click', () => els.csvFileInput.click());
  els.downloadCsvTemplateBtn.addEventListener('click', downloadCsvTemplate);
  els.csvFileInput.addEventListener('change', async () => {
    const file = els.csvFileInput.files?.[0];
    if (file) await importCsv(file);
    els.csvFileInput.value = '';
  });
  els.addSeparationPoolBtn.addEventListener('click', addSeparationPoolStudent);
  els.addBuddyBtn.addEventListener('click', addBuddyRule);

  // Close dialogs when clicking the dimmed backdrop.
  [els.dashboardDialog, els.scheduleDialog, els.newClassDialog, els.shareChartDialog].forEach(dialog => {
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
  });

  window.addEventListener('resize', fitRoomCanvas);
  renderAll();
  setInterval(updateClockAndSchedule, 1000);
})();
