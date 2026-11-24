(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const els = {
    board: $('.public-dashboard-board'),
    clockTime: $('#clockTime'),
    clockDate: $('#clockDate'),
    dayCard: $('#dayCard'),
    dayLabel: $('#dayLabel'),
    scheduleCard: $('#scheduleCard'),
    scheduleStatus: $('#scheduleStatus'),
    scheduleTime: $('#scheduleTime'),
    scheduleRemaining: $('#scheduleRemaining'),
    scheduleModeLabel: $('#scheduleModeLabel'),
    scheduleSwapBtn: $('#scheduleSwapBtn'),
    timerToggleBtn: $('#timerToggleBtn'),
    timerCard: $('#timerCard'),
    timerCloseBtn: $('#timerCloseBtn'),
    timerSetup: $('#timerSetup'),
    timerRunning: $('#timerRunning'),
    timerInput: $('#timerInput'),
    timerStartBtn: $('#timerStartBtn'),
    timerRemaining: $('#timerRemaining'),
    timerProgressRing: $('#timerProgressRing'),
    timerPauseBtn: $('#timerPauseBtn'),
    timerPauseIcon: $('#timerPauseIcon'),
    timerResetBtn: $('#timerResetBtn'),
    dashboardError: $('#dashboardError')
  };

  let schoolConfig = null;
  let audioContext = null;
  let timerDurationSeconds = 300;
  let timerRemainingSeconds = 300;
  let timerEndAt = null;
  let timerRunning = false;
  let timerCompleted = false;

  function ensureAudio() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      audioContext = new AudioContextClass();
      return audioContext;
    } catch {
      return null;
    }
  }

  function unlockAudio() {
    const context = ensureAudio();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }

  function playGentleDing() {
    const context = ensureAudio();
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    [0, 0.13].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1175, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.18);
    });
  }

  function formatTimer(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function parseTimer(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) return Math.max(0, Number(text) * 60);
    const match = text.match(/^(\d+):([0-5]?\d)$/);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function setTimerVisible(visible) {
    const show = Boolean(visible);
    els.timerCard.hidden = !show;
    els.board.classList.toggle('timer-visible', show);
    els.timerToggleBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
    els.timerToggleBtn.setAttribute('aria-label', show ? 'Hide timer' : 'Show timer');
  }

  function syncTimerDisplay(now = Date.now()) {
    if (timerRunning && Number.isFinite(timerEndAt)) {
      timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - now) / 1000));
      if (timerRemainingSeconds <= 0 && !timerCompleted) {
        timerRunning = false;
        timerEndAt = null;
        timerCompleted = true;
        playGentleDing();
      }
    }

    els.timerRemaining.textContent = formatTimer(timerRemainingSeconds);
    els.timerInput.value = formatTimer(timerRemainingSeconds);

    const total = Math.max(1, timerDurationSeconds);
    const progress = Math.max(0, Math.min(1, (total - timerRemainingSeconds) / total));
    els.timerProgressRing.style.setProperty('--timer-progress', `${progress * 360}deg`);

    els.timerSetup.hidden = timerRunning || timerRemainingSeconds !== timerDurationSeconds || timerCompleted;
    els.timerRunning.hidden = !els.timerSetup.hidden;
    els.timerPauseIcon.textContent = timerRunning ? 'Ⅱ' : '▶';
    els.timerPauseBtn.setAttribute('aria-label', timerRunning ? 'Pause timer' : 'Resume timer');
  }

  function startTimer() {
    unlockAudio();
    const parsed = parseTimer(els.timerInput.value);
    if (parsed > 0 && !timerRunning && timerRemainingSeconds === timerDurationSeconds && !timerCompleted) {
      timerDurationSeconds = parsed;
      timerRemainingSeconds = parsed;
    }
    if (timerRemainingSeconds <= 0) {
      timerDurationSeconds = parsed || 300;
      timerRemainingSeconds = timerDurationSeconds;
    }
    timerCompleted = false;
    timerEndAt = Date.now() + timerRemainingSeconds * 1000;
    timerRunning = true;
    syncTimerDisplay();
  }

  function toggleTimerPause() {
    unlockAudio();
    if (timerRunning) {
      timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      timerEndAt = null;
      timerRunning = false;
    } else if (timerRemainingSeconds > 0) {
      timerEndAt = Date.now() + timerRemainingSeconds * 1000;
      timerRunning = true;
      timerCompleted = false;
    }
    syncTimerDisplay();
  }

  function resetTimer() {
    timerRunning = false;
    timerEndAt = null;
    timerCompleted = false;
    timerRemainingSeconds = timerDurationSeconds;
    syncTimerDisplay();
  }

  function addTimerSeconds(seconds) {
    const add = Math.max(0, Number(seconds) || 0);
    if (!add) return;
    const parsed = parseTimer(els.timerInput.value);
    const base = parsed || timerRemainingSeconds || timerDurationSeconds;
    timerDurationSeconds = base + add;
    timerRemainingSeconds = timerDurationSeconds;
    timerCompleted = false;
    if (timerRunning) timerEndAt = Date.now() + timerRemainingSeconds * 1000;
    syncTimerDisplay();
  }

  function render() {
    if (!schoolConfig || !window.CALInfo) {
      syncTimerDisplay();
      return;
    }

    const now = new Date();
    const snapshot = window.CALInfo.snapshot(schoolConfig, {
      dayOverride: 'auto',
      scheduleOverride: 'auto',
      fallbackDayType: 'A'
    }, now);

    els.clockTime.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    els.clockDate.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

    els.dayCard.classList.toggle('a-day', snapshot.dayType === 'A');
    els.dayCard.classList.toggle('b-day', snapshot.dayType === 'B');
    els.dayCard.classList.toggle('neutral-day', !snapshot.dayType);
    els.dayLabel.textContent = snapshot.dayLabel;

    els.scheduleStatus.textContent = snapshot.scheduleStatus;
    els.scheduleTime.textContent = snapshot.scheduleTime;
    els.scheduleRemaining.textContent = snapshot.scheduleRemaining;
    els.scheduleModeLabel.textContent = snapshot.scheduleModeLabel;

    if (Number.isFinite(snapshot.secondsLeft)) {
      const mins = Math.floor(snapshot.secondsLeft / 60);
      const secs = snapshot.secondsLeft % 60;
      const shortLabel = String(snapshot.titleLabel || '').replace(/^Period\s+/i, 'P');
      document.title = `${mins}:${String(secs).padStart(2, '0')} · ${shortLabel} · CAL School Dashboard`;
    } else {
      document.title = snapshot.titleLabel
        ? `${snapshot.titleLabel} · CAL School Dashboard`
        : 'CAL School Dashboard';
    }

    syncTimerDisplay();
  }

  async function loadConfig(showError = true) {
    try {
      const response = await fetch('/api/public/school-info', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load school schedule information.');
      const payload = await response.json();
      schoolConfig = payload.schoolConfig || null;
      els.dashboardError.hidden = true;
      render();
    } catch (error) {
      console.error(error);
      if (showError) {
        els.dashboardError.textContent = 'School schedule information is temporarily unavailable.';
        els.dashboardError.hidden = false;
      }
    }
  }

  els.scheduleSwapBtn.addEventListener('click', () => {
    const swapped = !els.scheduleCard.classList.contains('schedule-swapped');
    els.scheduleCard.classList.toggle('schedule-swapped', swapped);
    els.scheduleSwapBtn.setAttribute('aria-pressed', swapped ? 'true' : 'false');
    try { localStorage.setItem('cal-dashboard-schedule-swapped', swapped ? '1' : '0'); } catch {}
  });

  els.timerToggleBtn.addEventListener('click', () => {
    unlockAudio();
    setTimerVisible(els.timerCard.hidden);
  });
  els.timerCloseBtn.addEventListener('click', () => setTimerVisible(false));
  els.timerStartBtn.addEventListener('click', startTimer);
  els.timerPauseBtn.addEventListener('click', toggleTimerPause);
  els.timerResetBtn.addEventListener('click', resetTimer);
  $$('[data-add-timer]').forEach(button => {
    button.addEventListener('click', () => addTimerSeconds(button.dataset.addTimer));
  });
  els.timerInput.addEventListener('change', () => {
    const parsed = parseTimer(els.timerInput.value);
    if (parsed > 0 && !timerRunning) {
      timerDurationSeconds = parsed;
      timerRemainingSeconds = parsed;
      timerCompleted = false;
      syncTimerDisplay();
    } else {
      els.timerInput.value = formatTimer(timerRemainingSeconds);
    }
  });

  try {
    const swapped = localStorage.getItem('cal-dashboard-schedule-swapped') === '1';
    els.scheduleCard.classList.toggle('schedule-swapped', swapped);
    els.scheduleSwapBtn.setAttribute('aria-pressed', swapped ? 'true' : 'false');
  } catch {}

  setTimerVisible(false);
  syncTimerDisplay();
  loadConfig();
  setInterval(render, 250);
  setInterval(() => loadConfig(false), 30000);
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadConfig(false);
      syncTimerDisplay();
    }
  });
})();