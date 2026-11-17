(() => {
  const $ = selector => document.querySelector(selector);
  const els = {
    clockTime: $('#clockTime'),
    clockDate: $('#clockDate'),
    dayCard: $('#dayCard'),
    dayLabel: $('#dayLabel'),
    scheduleStatus: $('#scheduleStatus'),
    scheduleTime: $('#scheduleTime'),
    scheduleRemaining: $('#scheduleRemaining'),
    scheduleModeLabel: $('#scheduleModeLabel'),
    dashboardError: $('#dashboardError')
  };

  let schoolConfig = null;

  function render() {
    if (!schoolConfig || !window.CALInfo) return;
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

    document.title = snapshot.titleLabel
      ? `${snapshot.titleLabel} · CAL School Dashboard`
      : 'CAL School Dashboard';
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

  loadConfig();
  setInterval(render, 1000);
  setInterval(() => loadConfig(false), 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadConfig(false);
  });
})();