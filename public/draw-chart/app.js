const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ICONS = {
  seat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v6h-2V5H7v6H5V5a2 2 0 0 1 2-2Zm-2 9h14a2 2 0 0 1 2 2v3h-2v4h-2v-4H7v4H5v-4H3v-3a2 2 0 0 1 2-2Zm0 2v1h14v-1H5Z"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11v18H5V3Zm2 2v14h7V5H7Zm4 6.25a1 1 0 1 1 0 1.5 1 1 0 0 1 0-1.5ZM18 6h2v15h-2V6Z"/></svg>',
  desk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v7H3V5Zm2 2v3h14V7H5Zm0 6h3v7H6v-5H5v-2Zm11 0h3v2h-1v5h-2v-7Z"/></svg>',
  projector: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v12H3V4Zm2 2v8h14V6H5Zm6 11h2v2h5v2H6v-2h5v-2Z"/></svg>'
};

const DISPLAY_CELL_PX = 44;
const MAX_HISTORY = 10;
const INTEGRATION_CONFIG = globalThis.DrawSeatingChartConfig || {};
const AUTOSAVE_KEY = INTEGRATION_CONFIG.autosaveKey || 'draw-seating-chart:autosave:v1';
const AUTOSAVE_ENABLED = INTEGRATION_CONFIG.autosave !== false;
let autosaveReady = false;
let lastAutosaveFingerprint = null;
const TYPE_META = {
  table: { label: 'Table', groupPrefix: 'table' },
  seat: { label: 'Seat', groupPrefix: 'seat-group' },
  door: { label: 'Door', groupPrefix: 'door' },
  desk: { label: 'Teacher Desk', groupPrefix: 'desk' },
  projector: { label: 'Projector Screen', groupPrefix: 'screen' }
};

const state = {
  version: 6,
  grid: { columns: 24, rows: 16 },
  cells: new Map(),
  selected: new Set(),
  activeTool: 'select',
  counters: { table: 1, seat: 1, door: 1, desk: 1, projector: 1 }
};

const history = { undo: [], redo: [] };
let clipboardData = null;
let interaction = null;
let snackbarTimer = null;
let renameTarget = null;
let eraseHoverId = null;

const els = {
  grid: $('#layoutGrid'),
  shell: $('#canvasShell'),
  columns: $('#gridColumns'),
  rows: $('#gridRows'),
  roomSize: $('#roomSize'),
  select: $('#selectBtn'),
  undo: $('#undoBtn'),
  redo: $('#redoBtn'),
  cut: $('#cutBtn'),
  copy: $('#copyBtn'),
  paste: $('#pasteBtn'),
  merge: $('#mergeBtn'),
  save: $('#saveBtn'),
  clear: $('#clearBtn'),
  contextMenu: $('#contextMenu'),
  renameDialog: $('#renameDialog'),
  renameForm: $('#renameForm'),
  renameInput: $('#renameInput'),
  renameCancel: $('#renameCancel'),
  snackbar: $('#snackbar')
};

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function keyFor(x, y) { return `${x},${y}`; }
function coordsFromKey(key) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}
function logicalId(object) { return object ? `${object.type}:${object.groupId}` : null; }
function splitLogicalId(id) {
  const index = id.indexOf(':');
  return { type: id.slice(0, index), groupId: id.slice(index + 1) };
}
function objectAt(x, y) { return state.cells.get(keyFor(x, y)); }
function isSelected(object) { return object ? state.selected.has(logicalId(object)) : false; }
function selectedEntries() { return [...state.cells.entries()].filter(([, object]) => isSelected(object)); }
function selectedIds() { return [...state.selected]; }
function selectedType() {
  if (state.selected.size < 2) return null;
  const types = new Set(selectedIds().map(id => splitLogicalId(id).type));
  return types.size === 1 ? [...types][0] : null;
}
function groupEntries(type, groupId) {
  return [...state.cells.entries()].filter(([, object]) => object.type === type && object.groupId === groupId);
}
function groupLabel(type, groupId) {
  return groupEntries(type, groupId)[0]?.[1]?.label || TYPE_META[type]?.label || type;
}
function groupAnchor(type, groupId) {
  const entries = groupEntries(type, groupId)
    .map(([key]) => ({ key, ...coordsFromKey(key) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return entries[0]?.key || null;
}
function sameGroup(x, y, object) {
  const other = objectAt(x, y);
  return other?.type === object.type && other?.groupId === object.groupId;
}

function persistAutosave() {
  if (!AUTOSAVE_ENABLED || !autosaveReady) return;
  try {
    const layout = serializeLayout();
    const fingerprint = JSON.stringify({ ...layout, exportedAt: undefined });
    if (fingerprint === lastAutosaveFingerprint) return;
    lastAutosaveFingerprint = fingerprint;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(layout));
    globalThis.dispatchEvent(new CustomEvent('draw-seating-chart:change', { detail: { layout } }));
  } catch (error) {
    console.warn('Draw Seating Chart autosave failed:', error);
  }
}
function restoreAutosave() {
  if (!AUTOSAVE_ENABLED) return false;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    loadLayoutData(JSON.parse(raw), { recordHistory: false });
    history.undo = [];
    history.redo = [];
    return true;
  } catch (error) {
    console.warn('Draw Seating Chart autosave restore failed:', error);
    return false;
  }
}

function showMessage(message) {
  clearTimeout(snackbarTimer);
  els.snackbar.textContent = message;
  els.snackbar.classList.add('show');
  snackbarTimer = setTimeout(() => els.snackbar.classList.remove('show'), 2300);
}

function snapshotState() {
  return {
    grid: { ...state.grid },
    cells: [...state.cells.entries()].map(([key, object]) => [key, { ...object }]),
    counters: { ...state.counters }
  };
}
function restoreSnapshot(snapshot) {
  state.grid = { ...snapshot.grid };
  state.cells = new Map(snapshot.cells.map(([key, object]) => [key, { ...object }]));
  state.counters = { ...snapshot.counters };
  state.selected.clear();
  syncInputs();
  renderGrid();
}
function checkpoint() {
  history.undo.push(snapshotState());
  if (history.undo.length > MAX_HISTORY) history.undo.shift();
  history.redo = [];
  updateToolbar();
}
function undo() {
  const previous = history.undo.pop();
  if (!previous) return;
  history.redo.push(snapshotState());
  if (history.redo.length > MAX_HISTORY) history.redo.shift();
  restoreSnapshot(previous);
  updateToolbar();
}
function redo() {
  const next = history.redo.pop();
  if (!next) return;
  history.undo.push(snapshotState());
  if (history.undo.length > MAX_HISTORY) history.undo.shift();
  restoreSnapshot(next);
  updateToolbar();
}

function clearEraseHover() {
  eraseHoverId = null;
  els.grid.querySelectorAll('.erase-hover').forEach(el => el.classList.remove('erase-hover'));
}
function applyEraseHover(id) {
  if (eraseHoverId === id) return;
  clearEraseHover();
  eraseHoverId = id;
  if (!id) return;
  els.grid.querySelectorAll('[data-logical-id]').forEach(el => {
    if (el.dataset.logicalId === id) el.classList.add('erase-hover');
  });
}
function setTool(tool) {
  state.activeTool = tool === 'select' ? 'select' : (state.activeTool === tool ? 'select' : tool);
  $$('.placement-tool').forEach(button => {
    const active = button.dataset.tool === state.activeTool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const selectActive = state.activeTool === 'select';
  els.select.classList.toggle('active', selectActive);
  els.select.setAttribute('aria-pressed', String(selectActive));
  els.grid.classList.toggle('select-mode', selectActive);
  els.grid.classList.toggle('erase-mode', state.activeTool === 'erase');
  if (state.activeTool !== 'erase') clearEraseHover();
}

function updateRoomSize() {
  els.roomSize.textContent = `Room: ${state.grid.columns} × ${state.grid.rows} squares`;
}
function syncInputs() {
  els.columns.value = String(state.grid.columns);
  els.rows.value = String(state.grid.rows);
  updateRoomSize();
}

function updateToolbar() {
  const hasSelection = state.selected.size > 0;
  els.undo.disabled = history.undo.length === 0;
  els.redo.disabled = history.redo.length === 0;
  els.copy.disabled = !hasSelection;
  els.cut.disabled = !hasSelection;
  els.paste.disabled = !clipboardData;
  els.merge.hidden = !canMergeSelection();
}

function renderGrid() {
  const { columns, rows } = state.grid;
  els.grid.style.gridTemplateColumns = `repeat(${columns}, var(--cell-px))`;
  els.grid.style.gridTemplateRows = `repeat(${rows}, var(--cell-px))`;
  els.grid.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const key = keyFor(x, y);
      const object = state.cells.get(key);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'layout-cell';
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Column ${x + 1}, row ${y + 1}`);

      if (object) {
        cell.classList.add('object', `object-${object.type}`);
        cell.dataset.logicalId = logicalId(object);
        const groupSize = groupEntries(object.type, object.groupId).length;
        if (groupSize > 1) {
          cell.classList.add('merged');
          if (!sameGroup(x, y - 1, object)) cell.classList.add('edge-top');
          if (!sameGroup(x + 1, y, object)) cell.classList.add('edge-right');
          if (!sameGroup(x, y + 1, object)) cell.classList.add('edge-bottom');
          if (!sameGroup(x - 1, y, object)) cell.classList.add('edge-left');
        }
        if (object.type === 'seat') {
          // Seat numbers are stable data identifiers used by the seating-chart app.
          const seatNumber = object.label.match(/\d+/)?.[0] || object.label;
          cell.innerHTML = `<span class="seat-number">${escapeHtml(seatNumber)}</span>`;
        } else if (object.type === 'door') {
          cell.innerHTML = ICONS.door;
        }
        cell.title = object.label;
        cell.setAttribute('aria-label', `${object.label}, column ${x + 1}, row ${y + 1}`);
        if (isSelected(object)) cell.classList.add('selected');
      }
      fragment.appendChild(cell);
    }
  }
  els.grid.appendChild(fragment);
  renderGroupOverlays();
  updateToolbar();
  persistAutosave();
}

function groupBounds(type, groupId) {
  const coords = groupEntries(type, groupId).map(([key]) => coordsFromKey(key));
  if (!coords.length) return null;
  const xs = coords.map(c => c.x), ys = coords.map(c => c.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

function renderGroupOverlays() {
  const seen = new Set();
  for (const object of state.cells.values()) {
    if (object.type === 'seat') continue;
    const id = logicalId(object);
    if (seen.has(id)) continue;
    seen.add(id);
    const bounds = groupBounds(object.type, object.groupId);
    if (!bounds) continue;

    const overlay = document.createElement('div');
    overlay.className = `group-overlay group-overlay-${object.type}`;
    overlay.dataset.logicalId = id;
    if (state.selected.has(id)) overlay.classList.add('selected-group-overlay');
    overlay.style.left = `${bounds.minX * DISPLAY_CELL_PX}px`;
    overlay.style.top = `${bounds.minY * DISPLAY_CELL_PX}px`;
    const widthCells = bounds.maxX - bounds.minX + 1;
    const heightCells = bounds.maxY - bounds.minY + 1;
    const isVertical = heightCells > widthCells;
    overlay.style.width = `${widthCells * DISPLAY_CELL_PX}px`;
    overlay.style.height = `${heightCells * DISPLAY_CELL_PX}px`;
    if (isVertical) overlay.classList.add('vertical-object');
    overlay.setAttribute('aria-hidden', 'true');

    if (object.type === 'desk' || object.type === 'projector') {
      const icon = document.createElement('span');
      icon.className = 'group-overlay-icon';
      icon.innerHTML = ICONS[object.type];
      overlay.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'group-overlay-label';
    label.textContent = object.label;
    if (isVertical) label.style.maxWidth = `${Math.max(42, heightCells * DISPLAY_CELL_PX - 18)}px`;
    overlay.appendChild(label);
    els.grid.appendChild(overlay);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function nextGroupInfo(type) {
  const meta = TYPE_META[type];
  if (type === 'seat') throw new Error('Seat groups are allocated separately.');
  const n = state.counters[type]++;
  return { groupId: `${meta.groupPrefix}-${n}-${uid().slice(0, 8)}`, label: `${meta.label} ${n}` };
}
function createPlacedGroup(type, coords) {
  if (!coords.length) return [];
  const created = [];
  if (type === 'seat') {
    const groupId = coords.length > 1 ? `seat-group-${uid()}` : null;
    for (const { x, y } of coords) {
      const n = state.counters.seat++;
      const id = `seat-${n}-${uid().slice(0, 6)}`;
      const object = { type: 'seat', id, groupId: groupId || id, label: `Seat ${n}` };
      state.cells.set(keyFor(x, y), object);
      created.push(logicalId(object));
    }
    if (coords.length > 1) return [`seat:${groupId}`];
    return created;
  }
  const { groupId, label } = nextGroupInfo(type);
  coords.forEach(({ x, y }, index) => {
    state.cells.set(keyFor(x, y), { type, id: `${groupId}-cell-${index + 1}`, groupId, label });
  });
  return [`${type}:${groupId}`];
}

function selectedUnionIsContiguous(type) {
  const ids = new Set(selectedIds().map(id => splitLogicalId(id)).filter(item => item.type === type).map(item => item.groupId));
  const keys = [...state.cells.entries()]
    .filter(([, object]) => object.type === type && ids.has(object.groupId))
    .map(([key]) => key);
  if (!keys.length) return false;
  const remaining = new Set(keys);
  const queue = [keys[0]];
  remaining.delete(keys[0]);
  while (queue.length) {
    const { x, y } = coordsFromKey(queue.shift());
    for (const neighbor of [keyFor(x+1,y), keyFor(x-1,y), keyFor(x,y+1), keyFor(x,y-1)]) {
      if (!remaining.has(neighbor)) continue;
      remaining.delete(neighbor);
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}
function canMergeSelection() {
  const type = selectedType();
  return Boolean(type && selectedUnionIsContiguous(type));
}
function mergeSelection() {
  const type = selectedType();
  if (!type) return;
  if (!selectedUnionIsContiguous(type)) {
    showMessage('Selected objects must touch edge-to-edge before they can be merged.');
    return;
  }
  checkpoint();
  const selection = selectedIds().map(splitLogicalId);
  const groupIds = new Set(selection.map(item => item.groupId));
  const entries = [...state.cells.entries()].filter(([, object]) => object.type === type && groupIds.has(object.groupId));
  const sorted = entries.slice().sort(([a], [b]) => {
    const ca = coordsFromKey(a), cb = coordsFromKey(b);
    return ca.y - cb.y || ca.x - cb.x;
  });
  const anchorObject = sorted[0]?.[1];
  const newGroupId = `${TYPE_META[type].groupPrefix}-merged-${uid()}`;
  const label = anchorObject?.label || TYPE_META[type].label;
  for (const [, object] of entries) {
    object.groupId = newGroupId;
    if (type !== 'seat') object.label = label;
  }
  state.selected.clear();
  state.selected.add(`${type}:${newGroupId}`);
  renderGrid();
  showMessage('Objects merged.');
}

function deleteSelection({ recordHistory = true } = {}) {
  if (!state.selected.size) return false;
  if (recordHistory) checkpoint();
  for (const [key, object] of [...state.cells.entries()]) {
    if (isSelected(object)) state.cells.delete(key);
  }
  state.selected.clear();
  renderGrid();
  return true;
}
function deleteLogicalObject(object) {
  if (!object) return;
  checkpoint();
  const id = logicalId(object);
  for (const [key, candidate] of [...state.cells.entries()]) {
    if (logicalId(candidate) === id) state.cells.delete(key);
  }
  state.selected.delete(id);
  renderGrid();
}

function buildClipboardFromSelection() {
  const entries = selectedEntries();
  if (!entries.length) return null;
  const coords = entries.map(([key]) => coordsFromKey(key));
  const minX = Math.min(...coords.map(c => c.x));
  const minY = Math.min(...coords.map(c => c.y));
  const maxX = Math.max(...coords.map(c => c.x));
  const maxY = Math.max(...coords.map(c => c.y));
  return {
    sourceX: minX,
    sourceY: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cells: entries.map(([key, object]) => {
      const { x, y } = coordsFromKey(key);
      return { dx: x - minX, dy: y - minY, object: { ...object }, sourceLogicalId: logicalId(object) };
    })
  };
}
function copySelection() {
  const clip = buildClipboardFromSelection();
  if (!clip) return;
  clipboardData = clip;
  updateToolbar();
  showMessage('Copied selection.');
}
function cutSelection() {
  const clip = buildClipboardFromSelection();
  if (!clip) return;
  clipboardData = clip;
  checkpoint();
  for (const [key, object] of [...state.cells.entries()]) if (isSelected(object)) state.cells.delete(key);
  state.selected.clear();
  renderGrid();
  showMessage('Cut selection.');
}
function canPlaceClipboardAt(originX, originY) {
  if (!clipboardData) return false;
  for (const item of clipboardData.cells) {
    const x = originX + item.dx;
    const y = originY + item.dy;
    if (x < 0 || y < 0 || x >= state.grid.columns || y >= state.grid.rows) return false;
    if (state.cells.has(keyFor(x, y))) return false;
  }
  return true;
}
function findPasteOrigin() {
  if (!clipboardData) return null;
  for (let offset = 1; offset <= 8; offset++) {
    const x = clipboardData.sourceX + offset;
    const y = clipboardData.sourceY + offset;
    if (canPlaceClipboardAt(x, y)) return { x, y };
  }
  for (let y = 0; y <= state.grid.rows - clipboardData.height; y++) {
    for (let x = 0; x <= state.grid.columns - clipboardData.width; x++) {
      if (canPlaceClipboardAt(x, y)) return { x, y };
    }
  }
  return null;
}
function allocateCopiedGroups() {
  const sourceIds = [...new Set(clipboardData.cells.map(item => item.sourceLogicalId))];
  const map = new Map();
  for (const sourceId of sourceIds) {
    const { type } = splitLogicalId(sourceId);
    if (type === 'seat') {
      map.set(sourceId, { type, groupId: `seat-group-${uid()}` });
    } else {
      map.set(sourceId, { type, ...nextGroupInfo(type) });
    }
  }
  return map;
}
function pasteSelection() {
  if (!clipboardData) return;
  const origin = findPasteOrigin();
  if (!origin) {
    showMessage('There is not enough open grid space to paste this selection.');
    return;
  }
  checkpoint();
  const groupMap = allocateCopiedGroups();
  const newSelection = new Set();
  for (const item of clipboardData.cells) {
    const { type } = item.object;
    const groupInfo = groupMap.get(item.sourceLogicalId);
    const x = origin.x + item.dx;
    const y = origin.y + item.dy;
    let object;
    if (type === 'seat') {
      const n = state.counters.seat++;
      const id = `seat-${n}-${uid().slice(0, 6)}`;
      object = { type, id, groupId: groupInfo.groupId, label: `Seat ${n}` };
    } else {
      object = { type, id: `${groupInfo.groupId}-cell-${uid().slice(0, 6)}`, groupId: groupInfo.groupId, label: groupInfo.label };
    }
    state.cells.set(keyFor(x, y), object);
    newSelection.add(logicalId(object));
  }
  state.selected = newSelection;
  renderGrid();
  showMessage('Pasted selection.');
}

function previewMove(dx, dy) {
  const entries = selectedEntries();
  if (!entries.length) return { valid: false, reason: 'Nothing selected.', entries: [], destinations: [] };
  const movingKeys = new Set(entries.map(([key]) => key));
  const destinations = [];
  for (const [key, object] of entries) {
    const { x, y } = coordsFromKey(key);
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= state.grid.columns || ny >= state.grid.rows) {
      return { valid: false, reason: 'That move would leave the classroom grid.', entries, destinations: [] };
    }
    const targetKey = keyFor(nx, ny);
    if (state.cells.has(targetKey) && !movingKeys.has(targetKey)) {
      return { valid: false, reason: 'That move is blocked by another object.', entries, destinations: [] };
    }
    destinations.push({ targetKey, x: nx, y: ny, object });
  }
  return { valid: true, entries, destinations };
}
function clearDragVisuals() {
  els.grid.querySelectorAll('.layout-cell').forEach(cell => {
    cell.style.transform = '';
    cell.classList.remove('drag-target-valid', 'drag-target-invalid', 'paint-preview');
  });
  els.grid.querySelectorAll('.group-overlay').forEach(overlay => { overlay.style.transform = ''; });
  els.grid.classList.remove('dragging');
}
function previewMoveTargets(dx, dy) {
  els.grid.querySelectorAll('.layout-cell').forEach(cell => cell.classList.remove('drag-target-valid', 'drag-target-invalid'));
  const move = previewMove(dx, dy);
  if (move.valid) {
    for (const item of move.destinations) {
      els.grid.querySelector(`.layout-cell[data-x="${item.x}"][data-y="${item.y}"]`)?.classList.add('drag-target-valid');
    }
  }
  return move;
}
function commitMove(dx, dy) {
  if (!dx && !dy) { renderGrid(); return; }
  const move = previewMove(dx, dy);
  if (!move.valid) { renderGrid(); showMessage(move.reason); return; }
  checkpoint();
  for (const [key] of move.entries) state.cells.delete(key);
  for (const item of move.destinations) state.cells.set(item.targetKey, item.object);
  renderGrid();
}

function gridCoordsFromPointer(clientX, clientY) {
  const rect = els.grid.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / DISPLAY_CELL_PX);
  const y = Math.floor((clientY - rect.top) / DISPLAY_CELL_PX);
  if (x < 0 || y < 0 || x >= state.grid.columns || y >= state.grid.rows) return null;
  return { x, y };
}
function pointInGrid(clientX, clientY) {
  const rect = els.grid.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, clientY - rect.top))
  };
}
function lineCells(from, to) {
  const cells = [];
  let x = from.x, y = from.y;
  cells.push({ x, y });
  while (x !== to.x) { x += Math.sign(to.x - x); cells.push({ x, y }); }
  while (y !== to.y) { y += Math.sign(to.y - y); cells.push({ x, y }); }
  return cells;
}
function updatePaintPreview(keys) {
  els.grid.querySelectorAll('.layout-cell').forEach(cell => cell.classList.remove('paint-preview', 'drag-target-invalid'));
  for (const key of keys) {
    const { x, y } = coordsFromKey(key);
    const cell = els.grid.querySelector(`.layout-cell[data-x="${x}"][data-y="${y}"]`);
    if (!cell) continue;
    cell.classList.add(state.cells.has(key) ? 'drag-target-invalid' : 'paint-preview');
  }
}
function marqueeElement() {
  let box = document.querySelector('.selection-marquee');
  if (!box) {
    box = document.createElement('div');
    box.className = 'selection-marquee';
    document.body.appendChild(box);
  }
  return box;
}
function removeMarquee() { document.querySelector('.selection-marquee')?.remove(); }
function applyMarquee(start, end, additive) {
  const box = {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y)
  };
  if (!additive) state.selected.clear();
  els.grid.querySelectorAll('.layout-cell.object').forEach(cell => {
    const rect = cell.getBoundingClientRect();
    const intersects = rect.right >= box.left && rect.left <= box.right && rect.bottom >= box.top && rect.top <= box.bottom;
    if (!intersects) return;
    const object = objectAt(Number(cell.dataset.x), Number(cell.dataset.y));
    if (object) state.selected.add(logicalId(object));
  });
  renderGrid();
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  hideContextMenu();
  const cell = event.target.closest('.layout-cell');
  if (!cell) return;
  const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
  const object = objectAt(x, y);
  const additive = event.shiftKey || event.metaKey || event.ctrlKey;

  if (state.activeTool === 'erase') {
    if (object) deleteLogicalObject(object);
    event.preventDefault();
    return;
  }

  if (object) {
    const id = logicalId(object);
    const wasSelected = state.selected.has(id);
    const priorCount = state.selected.size;
    if (!wasSelected) {
      if (!additive) state.selected.clear();
      state.selected.add(id);
      renderGrid();
    }
    interaction = {
      mode: 'move', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY,
      startX: x, startY: y, dragging: false, clickedId: id, additive, wasSelected,
      toggleOffOnClick: additive && wasSelected,
      collapseOnClick: !additive && wasSelected && priorCount > 1
    };
    els.grid.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }

  if (state.activeTool && state.activeTool !== 'erase' && state.activeTool !== 'select') {
    state.selected.clear();
    renderGrid();
    const startKey = keyFor(x, y);
    interaction = { mode: 'paint', pointerId: event.pointerId, type: state.activeTool, keys: new Set([startKey]), last: { x, y } };
    updatePaintPreview(interaction.keys);
    els.grid.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }

  if (!additive) state.selected.clear();
  renderGrid();
  const point = { x: event.clientX, y: event.clientY };
  interaction = { mode: 'marquee', pointerId: event.pointerId, start: point, current: point, drawing: false, additive };
  const box = marqueeElement();
  box.style.left = `${point.x}px`; box.style.top = `${point.y}px`; box.style.width = '0px'; box.style.height = '0px';
  els.grid.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (state.activeTool === 'erase' && !interaction) {
    const cell = event.target.closest?.('.layout-cell.object');
    const object = cell ? objectAt(Number(cell.dataset.x), Number(cell.dataset.y)) : null;
    applyEraseHover(object ? logicalId(object) : null);
  }
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  if (interaction.mode === 'move') {
    const dxPx = event.clientX - interaction.startClientX;
    const dyPx = event.clientY - interaction.startClientY;
    if (Math.hypot(dxPx, dyPx) > 4) interaction.dragging = true;
    if (!interaction.dragging) return;
    els.grid.classList.add('dragging');
    els.grid.querySelectorAll('.layout-cell.selected, .group-overlay.selected-group-overlay').forEach(el => { el.style.transform = `translate(${dxPx}px, ${dyPx}px)`; });
    const dx = Math.round(dxPx / DISPLAY_CELL_PX), dy = Math.round(dyPx / DISPLAY_CELL_PX);
    previewMoveTargets(dx, dy);
    return;
  }
  if (interaction.mode === 'paint') {
    const current = gridCoordsFromPointer(event.clientX, event.clientY);
    if (!current) return;
    for (const coord of lineCells(interaction.last, current)) interaction.keys.add(keyFor(coord.x, coord.y));
    interaction.last = current;
    updatePaintPreview(interaction.keys);
    return;
  }
  if (interaction.mode === 'marquee') {
    const point = { x: event.clientX, y: event.clientY };
    interaction.current = point;
    const dx = point.x - interaction.start.x, dy = point.y - interaction.start.y;
    if (Math.hypot(dx, dy) > 4) interaction.drawing = true;
    const box = marqueeElement();
    box.style.left = `${Math.min(interaction.start.x, point.x)}px`;
    box.style.top = `${Math.min(interaction.start.y, point.y)}px`;
    box.style.width = `${Math.abs(dx)}px`;
    box.style.height = `${Math.abs(dy)}px`;
  }
}

function onPointerUp(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const current = interaction;
  interaction = null;
  try { els.grid.releasePointerCapture?.(event.pointerId); } catch {}

  if (current.mode === 'move') {
    if (current.dragging) {
      const dx = Math.round((event.clientX - current.startClientX) / DISPLAY_CELL_PX);
      const dy = Math.round((event.clientY - current.startClientY) / DISPLAY_CELL_PX);
      clearDragVisuals();
      commitMove(dx, dy);
    } else {
      if (current.toggleOffOnClick) state.selected.delete(current.clickedId);
      else if (current.collapseOnClick) { state.selected.clear(); state.selected.add(current.clickedId); }
      renderGrid();
    }
    return;
  }

  if (current.mode === 'paint') {
    clearDragVisuals();
    const coords = [...current.keys].map(coordsFromKey);
    const blocked = coords.some(({ x, y }) => objectAt(x, y));
    if (blocked) {
      renderGrid();
      showMessage('Placement is blocked by an existing object.');
      return;
    }
    checkpoint();
    const ids = createPlacedGroup(current.type, coords);
    state.selected = new Set(ids);
    renderGrid();
    return;
  }

  if (current.mode === 'marquee') {
    removeMarquee();
    if (current.drawing) applyMarquee(current.start, current.current, current.additive);
    else { state.selected.clear(); renderGrid(); }
  }
}

function onPointerCancel() {
  interaction = null;
  removeMarquee();
  clearDragVisuals();
  renderGrid();
}

function highestOccupied() {
  let maxX = -1, maxY = -1;
  for (const key of state.cells.keys()) {
    const { x, y } = coordsFromKey(key);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { maxX, maxY };
}
function applyGridSettings() {
  const columns = Math.max(8, Math.min(60, Number(els.columns.value) || state.grid.columns));
  const rows = Math.max(6, Math.min(50, Number(els.rows.value) || state.grid.rows));
  const { maxX, maxY } = highestOccupied();
  if (maxX >= columns || maxY >= rows) {
    syncInputs();
    showMessage('The room cannot shrink over placed objects. Move or delete them first.');
    return;
  }
  const unchanged = columns === state.grid.columns && rows === state.grid.rows;
  if (unchanged) { syncInputs(); return; }
  checkpoint();
  state.grid = { columns, rows };
  syncInputs();
  renderGrid();
}

function groupedData(type) {
  const map = new Map();
  for (const [key, object] of state.cells) {
    if (object.type !== type) continue;
    if (!map.has(object.groupId)) map.set(object.groupId, { id: object.groupId, label: object.label, cells: [] });
    const { x, y } = coordsFromKey(key);
    map.get(object.groupId).cells.push({ column: x + 1, row: y + 1 });
  }
  return [...map.values()].map(group => ({ ...group, cells: group.cells.sort((a,b) => a.row - b.row || a.column - b.column) }));
}
function serializeLayout() {
  const seats = [];
  for (const [key, object] of state.cells) {
    if (object.type !== 'seat') continue;
    const { x, y } = coordsFromKey(key);
    seats.push({ id: object.id, groupId: object.groupId, label: object.label, column: x + 1, row: y + 1 });
  }
  return {
    schema: 'cal-classroom-layout',
    version: 6,
    exportedAt: new Date().toISOString(),
    grid: {
      columns: state.grid.columns,
      rows: state.grid.rows,
      unit: 'square'
    },
    roomSize: {
      x: state.grid.columns,
      y: state.grid.rows,
      unit: 'square'
    },
    tables: groupedData('table'),
    seats,
    doors: groupedData('door'),
    teacherDesks: groupedData('desk'),
    projectorScreens: groupedData('projector')
  };
}
function downloadLayout() {
  const blob = new Blob([JSON.stringify(serializeLayout(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `draw-seating-chart-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showMessage('Seating chart JSON downloaded.');
}
function handleDone() {
  const layout = serializeLayout();
  const event = new CustomEvent('draw-seating-chart:done', {
    detail: { layout },
    cancelable: true
  });
  const shouldDownload = globalThis.dispatchEvent(event);
  if (typeof INTEGRATION_CONFIG.onDone === 'function') {
    const result = INTEGRATION_CONFIG.onDone(layout);
    if (result === false) return;
  }
  if (shouldDownload) downloadLayout();
}

function normalizeGroupItem(item, fallbackId, fallbackLabel) {
  return { id: item?.id || fallbackId, label: item?.label || fallbackLabel, cells: item?.cells || [] };
}
function loadLayoutData(data, { recordHistory = true } = {}) {
  const version = Number(data?.version);
  if (!data || data.schema !== 'cal-classroom-layout' || ![1,2,3,4,5,6].includes(version)) throw new Error('This is not a supported Draw Seating Chart JSON file.');
  const columns = Number(data.grid?.columns);
  const rows = Number(data.grid?.rows);
  if (!Number.isInteger(columns) || columns < 8 || columns > 60 || !Number.isInteger(rows) || rows < 6 || rows > 50) throw new Error('The saved grid dimensions are invalid.');
  const newCells = new Map();
  const occupy = (column, row, object) => {
    const x = Number(column) - 1, y = Number(row) - 1;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= columns || y >= rows) throw new Error('A saved object is outside the grid.');
    const key = keyFor(x, y);
    if (newCells.has(key)) throw new Error('The JSON places more than one object in the same square.');
    newCells.set(key, object);
  };
  const loadGroups = (items, type, prefix) => {
    (items || []).forEach((raw, index) => {
      if (raw.cells) {
        const group = normalizeGroupItem(raw, `${prefix}-${index+1}`, `${TYPE_META[type].label} ${index+1}`);
        group.cells.forEach((cell, cellIndex) => occupy(cell.column, cell.row, { type, id: `${group.id}-cell-${cellIndex+1}`, groupId: group.id, label: group.label }));
      } else if (raw.column != null && raw.row != null) {
        const groupId = raw.groupId || raw.id || `${prefix}-${index+1}`;
        occupy(raw.column, raw.row, { type, id: raw.id || `${groupId}-cell-1`, groupId, label: raw.label || `${TYPE_META[type].label} ${index+1}` });
      }
    });
  };
  loadGroups(data.tables, 'table', 'table');
  loadGroups(data.projectorScreens, 'projector', 'screen');
  loadGroups(data.doors, 'door', 'door');
  loadGroups(data.teacherDesks, 'desk', 'desk');
  (data.seats || []).forEach((seat, index) => {
    const id = seat.id || `seat-${index+1}`;
    occupy(seat.column, seat.row, { type:'seat', id, groupId:seat.groupId || id, label:seat.label || `Seat ${index+1}` });
  });

  if (recordHistory) checkpoint();
  state.grid = { columns, rows };
  state.cells = newCells;
  state.selected.clear();
  resetCounters();
  syncInputs();
  renderGrid();
}
function resetCounters() {
  const maxima = { table:0, seat:0, door:0, desk:0, projector:0 };
  for (const object of state.cells.values()) {
    const n = Number(object.label?.match(/\d+/)?.[0]) || 0;
    maxima[object.type] = Math.max(maxima[object.type] || 0, n);
  }
  Object.keys(state.counters).forEach(type => { state.counters[type] = (maxima[type] || 0) + 1; });
}

function hideContextMenu() { els.contextMenu.hidden = true; }
function showContextMenu(event, object) {
  const id = logicalId(object);
  if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); renderGrid(); }
  const renameButton = els.contextMenu.querySelector('[data-action="rename"]');
  const only = state.selected.size === 1 ? splitLogicalId(selectedIds()[0]) : null;
  renameButton.disabled = !only || only.type === 'seat';
  els.contextMenu.hidden = false;
  const menuRect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  els.contextMenu.style.left = `${Math.max(8,left)}px`;
  els.contextMenu.style.top = `${Math.max(8,top)}px`;
}
function beginRename() {
  if (state.selected.size !== 1) return;
  const target = splitLogicalId(selectedIds()[0]);
  if (target.type === 'seat') return;
  renameTarget = target;
  els.renameInput.value = groupLabel(target.type, target.groupId);
  hideContextMenu();
  els.renameDialog.showModal();
  setTimeout(() => { els.renameInput.focus(); els.renameInput.select(); }, 0);
}
function saveRename() {
  if (!renameTarget) return;
  const value = els.renameInput.value.trim();
  if (!value) return;
  checkpoint();
  for (const [, object] of groupEntries(renameTarget.type, renameTarget.groupId)) object.label = value;
  renameTarget = null;
  els.renameDialog.close();
  renderGrid();
}

els.select.addEventListener('click', () => setTool('select'));
$$('.placement-tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
els.grid.addEventListener('pointerdown', onPointerDown);
els.grid.addEventListener('pointermove', onPointerMove);
els.grid.addEventListener('pointerup', onPointerUp);
els.grid.addEventListener('pointercancel', onPointerCancel);
els.grid.addEventListener('pointerleave', () => { if (state.activeTool === 'erase' && !interaction) clearEraseHover(); });
els.grid.addEventListener('contextmenu', event => {
  event.preventDefault();
  const cell = event.target.closest('.layout-cell');
  if (!cell) return;
  const object = objectAt(Number(cell.dataset.x), Number(cell.dataset.y));
  if (!object) { hideContextMenu(); state.selected.clear(); renderGrid(); return; }
  showContextMenu(event, object);
});

document.addEventListener('pointerdown', event => {
  if (!els.contextMenu.hidden && !event.target.closest('#contextMenu')) hideContextMenu();
}, true);

els.contextMenu.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'copy') copySelection();
  if (action === 'cut') cutSelection();
  if (action === 'delete') deleteSelection();
  if (action === 'rename') beginRename();
  if (action !== 'rename') hideContextMenu();
});

els.renameForm.addEventListener('submit', event => { event.preventDefault(); saveRename(); });
els.renameCancel.addEventListener('click', () => { renameTarget = null; els.renameDialog.close(); });
els.renameDialog.addEventListener('cancel', () => { renameTarget = null; });

els.undo.addEventListener('click', undo);
els.redo.addEventListener('click', redo);
els.copy.addEventListener('click', copySelection);
els.cut.addEventListener('click', cutSelection);
els.paste.addEventListener('click', pasteSelection);
els.merge.addEventListener('click', mergeSelection);
els.save.addEventListener('click', handleDone);
els.clear.addEventListener('click', () => {
  if (!state.cells.size) return;
  if (!confirm('Clear every object from this room? You can undo this action.')) return;
  checkpoint(); state.cells.clear(); state.selected.clear(); resetCounters(); renderGrid();
});
[els.columns, els.rows].forEach(input => input.addEventListener('change', applyGridSettings));

document.addEventListener('keydown', event => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (typing && !event.metaKey && !event.ctrlKey && event.key !== 'Escape') return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'a' && !typing) {
    event.preventDefault();
    state.selected = new Set([...state.cells.values()].map(logicalId));
    renderGrid();
    return;
  }
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
  if (mod && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection(); return; }
  if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && state.selected.size) { event.preventDefault(); deleteSelection(); return; }
  if (event.key === 'Escape') {
    hideContextMenu();
    if (els.renameDialog.open) { renameTarget = null; els.renameDialog.close(); }
    setTool('select');
  }
});

restoreAutosave();
autosaveReady = true;
syncInputs();
renderGrid();
setTool('select');

globalThis.DrawSeatingChart = Object.freeze({
  schema: 'cal-classroom-layout',
  version: 6,
  getLayout: () => serializeLayout(),
  loadLayout: data => loadLayoutData(data),
  clearAutosave: () => { try { localStorage.removeItem(AUTOSAVE_KEY); } catch {} },
  autosaveKey: AUTOSAVE_KEY
});
