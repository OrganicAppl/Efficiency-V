// Keeps the left sidebar (ZIP code + devices) in view: it scrolls with the
// page until its bottom edge is visible, then stops while the right column
// (graphs + schedule table) keeps scrolling.
(function () {
  const GAP = 24; // px of breathing room above/below the sidebar

  function update() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const header = document.querySelector('.navbar');
    const headerH = header ? header.offsetHeight : 0;

    const fitsTop = headerH + GAP;
    // If the sidebar is taller than the space under the header, this goes
    // negative, so the sidebar sticks by its bottom edge instead of its top.
    const stickBottom = window.innerHeight - sidebar.offsetHeight - GAP;

    document.documentElement.style.setProperty(
      '--sidebar-top',
      Math.min(fitsTop, stickBottom) + 'px'
    );
  }

  window.addEventListener('resize', update);
  document.addEventListener('DOMContentLoaded', () => {
    update();
    // Sidebar height changes when devices are added or removed.
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && 'ResizeObserver' in window) {
      new ResizeObserver(update).observe(sidebar);
    }
  });
})();
