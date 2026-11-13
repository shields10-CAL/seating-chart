globalThis.DrawSeatingChartConfig = {
  autosave: false,
  onDone(layout) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'draw-seating-chart:done', layout }, window.location.origin);
      return false;
    }
    return true;
  }
};
