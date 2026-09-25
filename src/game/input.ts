export type InputAction = 'left' | 'right' | 'action' | 'up' | 'down' | 'pause';

/** Клавиатура + свайпы/тапы */
export class Input {
  private cb: (a: InputAction) => void;
  private el: HTMLElement;
  private tsx = 0;
  private tsy = 0;
  private tst = 0;
  private tracking = false;
  private disposed = false;

  constructor(el: HTMLElement, cb: (a: InputAction) => void) {
    this.el = el;
    this.cb = cb;
    window.addEventListener('keydown', this.onKey);
    el.addEventListener('touchstart', this.onTS, { passive: false });
    el.addEventListener('touchend', this.onTE, { passive: false });
    el.addEventListener('mousedown', this.onMouse);
    el.addEventListener('contextmenu', this.onCtx);
  }

  private onCtx = (e: Event) => e.preventDefault();

  private onKey = (e: KeyboardEvent) => {
    if (this.disposed) return;
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') this.cb('left');
    else if (k === 'ArrowRight' || k === 'KeyD') this.cb('right');
    else if (k === 'Space') { this.cb('action'); e.preventDefault(); }   // сальто
    else if (k === 'ArrowUp' || k === 'KeyW') { this.cb('up'); e.preventDefault(); } // прыжок
    else if (k === 'ArrowDown' || k === 'KeyS') this.cb('down');
    else if (k === 'KeyP' || k === 'Escape') this.cb('pause');
  };

  private onTS = (e: TouchEvent) => {
    if (this.disposed) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    this.tsx = t.clientX; this.tsy = t.clientY;
    this.tst = performance.now();
    this.tracking = true;
  };

  private onTE = (e: TouchEvent) => {
    if (this.disposed || !this.tracking) return;
    e.preventDefault();
    this.tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.tsx;
    const dy = t.clientY - this.tsy;
    const dt = performance.now() - this.tst;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > 42 && ax > ay) this.cb(dx > 0 ? 'right' : 'left');
    else if (ay > 44 && dy > 0) this.cb('down');   // свайп вниз — кувырок
    else if (ay > 44 && dy < 0) this.cb('up');     // свайп вверх — прыжок
    else if (ax < 22 && ay < 22 && dt < 450) this.cb('action'); // тап — сальто
  };

  private onMouse = (e: MouseEvent) => {
    if (this.disposed) return;
    if (e.button === 0) this.cb('action');
  };

  dispose() {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('touchstart', this.onTS);
    this.el.removeEventListener('touchend', this.onTE);
    this.el.removeEventListener('mousedown', this.onMouse);
    this.el.removeEventListener('contextmenu', this.onCtx);
  }
}
