import { appState } from '../state/appState.js';

export function bringWindowToFront(winEl) {
  if (!winEl) return;
  if (appState.topWindowZ >= 70) {
    appState.floatingWindows
      .slice()
      .sort((a, b) => (parseInt(a.style.zIndex || 21, 10) - parseInt(b.style.zIndex || 21, 10)))
      .forEach((w, idx) => {
        w.style.zIndex = String(21 + idx);
      });
    appState.topWindowZ = 21 + appState.floatingWindows.length;
  }
  appState.topWindowZ += 1;
  winEl.style.zIndex = String(appState.topWindowZ);
}

export function clampWindowToViewport(winEl) {
  if (!winEl || winEl.hidden || !winEl.style.left || winEl.style.left === 'auto') return;
  const maxLeft = Math.max(8, window.innerWidth - winEl.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - winEl.offsetHeight - 8);
  const curLeft = parseFloat(winEl.style.left) || 8;
  const curTop = parseFloat(winEl.style.top) || 8;
  winEl.style.left = Math.min(maxLeft, Math.max(8, curLeft)) + 'px';
  winEl.style.top = Math.min(maxTop, Math.max(8, curTop)) + 'px';
}

export function clampAllFloatingWindows() {
  appState.floatingWindows.forEach(clampWindowToViewport);
}

export function makeWindowDraggable(winEl, handleEl) {
  if (!winEl || !handleEl) return;
  if (!appState.floatingWindows.includes(winEl)) appState.floatingWindows.push(winEl);

  winEl.addEventListener('pointerdown', () => bringWindowToFront(winEl));

  handleEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, a, input, select')) return;

    e.preventDefault();
    e.stopPropagation();
    bringWindowToFront(winEl);

    const rect = winEl.getBoundingClientRect();
    winEl.style.left = rect.left + 'px';
    winEl.style.top = rect.top + 'px';
    winEl.style.right = 'auto';
    winEl.style.bottom = 'auto';
    winEl.style.animation = 'none';
    winEl.classList.add('window-dragging');

    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const pointerId = e.pointerId;
    handleEl.setPointerCapture(pointerId);

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      const maxLeft = Math.max(8, window.innerWidth - winEl.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - winEl.offsetHeight - 8);
      const nextLeft = Math.min(maxLeft, Math.max(8, ev.clientX - offsetX));
      const nextTop = Math.min(maxTop, Math.max(8, ev.clientY - offsetY));
      winEl.style.left = nextLeft + 'px';
      winEl.style.top = nextTop + 'px';
    }

    function onEnd(ev) {
      if (ev.pointerId !== pointerId) return;
      winEl.classList.remove('window-dragging');
      if (handleEl.hasPointerCapture(pointerId)) {
        handleEl.releasePointerCapture(pointerId);
      }
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onEnd);
      handleEl.removeEventListener('pointercancel', onEnd);
    }

    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onEnd);
    handleEl.addEventListener('pointercancel', onEnd);
  });
}
