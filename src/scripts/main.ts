import Lenis from 'lenis';
import { initForms } from './forms';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lenis: Lenis | null = null;
let cleanups: Array<() => void> = [];
let firstLoad = true;

/* ───────── Scroll loop ─────────
 * Layout is measured once (and on resize); each frame then works from the
 * scroll value alone, so there are no layout reads in the hot path. Frames
 * where the scroll position hasn't changed do no work at all. */
type Tick = (y: number, vh: number) => void;
let ticks: Tick[] = [];
let measurers: Array<() => void> = [];
let lastY = -1;
let dirty = true;
let raf = 0;
let still = 0;
function loop(time: number) {
  raf = 0;
  lenis?.raf(time);
  const y = lenis ? lenis.scroll : scrollY;
  if (y !== lastY || dirty) {
    lastY = y;
    dirty = false;
    still = 0;
    const vh = innerHeight;
    for (const t of ticks) t(y, vh);
  } else still++;
  // go fully idle once scrolling has settled; any input wakes the loop again
  if (still < 30 || lenis?.isScrolling) raf = requestAnimationFrame(loop);
}
function wake() {
  if (!raf) raf = requestAnimationFrame(loop);
}
function remeasure() {
  for (const m of measurers) m();
  dirty = true;
  wake();
}
/** Document offset, ignoring transforms (offsetTop chain). */
function docTop(el: HTMLElement) {
  let t = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) t += n.offsetTop;
  return t;
}
/** Write a style only when it changes. */
const cache = new WeakMap<HTMLElement, string>();
function setStyle(el: HTMLElement, prop: 'transform' | 'translate', v: string) {
  if (cache.get(el) === prop + v) return;
  cache.set(el, prop + v);
  el.style[prop] = v;
}

/* ───────── Curtain: gold preloader + dark dip between pages ───────── */
const curtain = () => document.querySelector<HTMLElement>('[data-curtain]');
async function reveal() {
  const el = curtain();
  if (!el) return;
  if (reduced) { el.className = 'curtain'; return; }
  if (el.classList.contains('is-fade')) {
    el.classList.remove('is-fade');
    return;
  }
  if (!el.classList.contains('is-covered')) return;
  el.classList.add('is-leaving');
  el.classList.remove('is-covered');
  // outermost columns finish last: 2 steps of delay + duration
  await new Promise<void>((r) => {
    const edge = el.querySelector('.curtain__row span');
    edge?.addEventListener('transitionend', () => r(), { once: true });
    setTimeout(r, 1700);
  });
  el.className = 'curtain';
}
async function cover() {
  const el = curtain();
  if (!el || reduced) return;
  el.className = 'curtain is-fade';
  await wait(120);
}

/* ───────── Helpers ───────── */
function onView(sel: string, cb: (el: HTMLElement) => void, opts: IntersectionObserverInit = { rootMargin: '0px 0px -12% 0px' }) {
  const els = document.querySelectorAll<HTMLElement>(sel);
  if (!els.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { cb(e.target as HTMLElement); io.unobserve(e.target); }
  }, opts);
  els.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

/* ───────── Features ───────── */
function header() {
  const h = document.querySelector<HTMLElement>('[data-header]');
  if (!h) return;
  let last = 0;
  let hidden = false;
  let solid = false;
  ticks.push((y, vh) => {
    const dy = y - last;
    if (Math.abs(dy) > 4) {
      const menuOpen = document.documentElement.classList.contains('menu-open');
      const hide = !menuOpen && dy > 0 && y > 160;
      if (hide !== hidden) { hidden = hide; h.classList.toggle('is-hidden', hide); }
      last = y;
    }
    const s = y > vh * 0.6;
    if (s !== solid) { solid = s; h.classList.toggle('is-solid', s); }
  });
}

function menu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  if (!btn) return;
  const root = document.documentElement;
  const set = (open: boolean) => {
    root.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    open ? lenis?.stop() : lenis?.start();
  };
  set(false);
  btn.onclick = () => set(!root.classList.contains('menu-open'));
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && set(false);
  addEventListener('keydown', esc);
  cleanups.push(() => { removeEventListener('keydown', esc); set(false); });
}

/** Decorative CSS loops: pause offscreen, and settle the globe after the first scroll (or 12s) so idle is truly idle. */
function heroLoops() {
  const hero = document.querySelector<HTMLElement>('.hero, .page-hero');
  if (!hero) return;
  const io = new IntersectionObserver(([e]) => hero.classList.toggle('is-offscreen', !e?.isIntersecting));
  io.observe(hero);
  const settle = () => hero.classList.add('is-settled');
  const timer = setTimeout(settle, 12000);
  addEventListener('wheel', settle, { once: true, passive: true });
  addEventListener('touchmove', settle, { once: true, passive: true });
  cleanups.push(() => { io.disconnect(); clearTimeout(timer); removeEventListener('wheel', settle); removeEventListener('touchmove', settle); });
}

function reveals() {
  onView('[data-reveal], [data-split="view"]', (el) => el.classList.add('is-in'));
}

function heroIntro() {
  document.querySelectorAll<HTMLElement>('[data-split="load"], [data-reveal="load"]').forEach((el) => el.classList.add('is-in'));
}

function counters() {
  onView('[data-count]', (el) => {
    const to = Number(el.dataset.count);
    if (reduced) { el.textContent = String(to); return; }
    const dur = 1800;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, { threshold: 0.6 });
}

function faq() {
  document.querySelectorAll<HTMLElement>('[data-faq]').forEach((list) => {
    list.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.faq__q');
      if (!btn) return;
      const item = btn.closest('.faq__item')!;
      const open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      setTimeout(() => lenis?.resize(), 650);
    };
  });
}

/** Scroll-linked: parallax, hero zoom, stairs, scrubbed words. */
function scrollEffects() {
  if (reduced) return;
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // pinned (sticky) elements report a shifting offset; measure their .pin wrapper instead
  const anchor = (el: HTMLElement) => el.closest<HTMLElement>('.pin') ?? el;

  const parallax = [...document.querySelectorAll<HTMLElement>('[data-parallax]')].map((el) => ({ el, k: Number(el.dataset.parallax) || 0.15, top: 0, h: 0 }));
  const zooms = [...document.querySelectorAll<HTMLElement>('[data-zoom]')].map((el) => ({ el, mode: el.dataset.zoom, host: el.parentElement!, top: 0, h: 0 }));
  // --p goes on the .stairs element itself, so only its 8 spans restyle (not the whole section)
  const stairs = [...document.querySelectorAll<HTMLElement>('[data-stairs]')].map((el) => ({ el, target: el.querySelector<HTMLElement>(':scope > .stairs') ?? el, top: 0, last: '' }));
  const scrubs = [...document.querySelectorAll<HTMLElement>('[data-scrub]')].map((el) => ({ el, words: [...el.querySelectorAll<HTMLElement>('.sw')], top: 0, h: 0, n: 0 }));

  measurers.push(() => {
    for (const p of parallax) { p.top = docTop(p.el); p.h = p.el.offsetHeight; }
    for (const z of zooms) { z.top = docTop(anchor(z.host)); z.h = z.host.offsetHeight; }
    for (const s of stairs) s.top = docTop(s.el);
    for (const s of scrubs) { s.top = docTop(s.el); s.h = s.el.offsetHeight; }
  });

  ticks.push((y, vh) => {
    for (const p of parallax) {
      const top = p.top - y;
      if (top + p.h < -200 || top > vh + 200) continue;
      setStyle(p.el, 'translate', `0 ${((top + p.h / 2 - vh / 2) * p.k).toFixed(1)}px`);
    }
    for (const z of zooms) {
      const top = z.top - y;
      if (top + z.h < 0 || top > vh) continue;
      if (z.mode === 'pin') {
        // pinned hero: gentle scale while the next section slides over it
        setStyle(z.el, 'transform', `scale(${(1 + clamp01(-top / z.h) * 0.06).toFixed(3)})`);
      } else if (z.mode === 'out') {
        const p = clamp01(-top / z.h);
        setStyle(z.el, 'transform', `translate3d(0, ${(p * z.h * 0.35).toFixed(1)}px, 0) scale(${(1 + p * 0.08).toFixed(3)})`);
      } else {
        // in-flow image: settles from 1.15 to 1 while crossing the viewport
        const p = clamp01((vh - top) / (vh + z.h));
        setStyle(z.el, 'transform', `translate3d(0, ${((p - 0.5) * -14).toFixed(2)}%, 0) scale(${(1.15 - p * 0.15).toFixed(3)})`);
      }
    }
    for (const s of stairs) {
      if (s.top - y > vh || s.top - y < -vh) continue;
      // the stepped edge grows as this section slides up over the pinned hero
      const v = clamp01(y / (Math.min(s.top, vh) * 0.8)).toFixed(3);
      if (v !== s.last) { s.last = v; s.target.style.setProperty('--p', v); }
    }
    for (const s of scrubs) {
      const top = s.top - y;
      if (top + s.h < 0 || top > vh) continue;
      const n = Math.round(clamp01((vh * 0.85 - top) / (s.h + vh * 0.35)) * s.words.length);
      if (n === s.n) continue;
      const [a, b] = n > s.n ? [s.n, n] : [n, s.n];
      for (let i = a; i < b; i++) s.words[i]!.classList.toggle('on', i < n);
      s.n = n;
    }
  });
}

function anchors() {
  document.querySelectorAll<HTMLAnchorElement>('[data-to-top]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); wake(); lenis ? lenis.scrollTo(0, { duration: 1.6 }) : scrollTo({ top: 0, behavior: 'smooth' }); };
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]:not([data-to-top])').forEach((a) => {
    const id = a.getAttribute('href')!;
    if (id.length < 2) return;
    a.onclick = (e) => {
      const t = document.querySelector<HTMLElement>(id);
      if (!t) return;
      e.preventDefault();
      wake();
      lenis ? lenis.scrollTo(t, { offset: -20 }) : t.scrollIntoView({ behavior: 'smooth' });
    };
  });
}

/** Desktop-only extras, loaded lazily so phones never download them. */
function desktopExtras() {
  if (reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const media = document.querySelector<HTMLElement>('[data-trail]');
  if (!media) return;
  let destroy: (() => void) | null = null;
  let cancelled = false;
  // warm up at idle (module + a downscaled copy of the photo) so the first move has no hitch;
  // nothing touches the GPU until the mouse actually moves over the hero
  const host = media.closest<HTMLElement>('section') ?? media;
  let warm: Promise<[typeof import('./trail'), HTMLCanvasElement | null]> | null = null;
  const prewarm = () => (warm ??= Promise.all([import('./trail'), import('./trail').then((m) => m.prepareSource(media))]));
  const idle = 'requestIdleCallback' in window ? requestIdleCallback(prewarm, { timeout: 4000 }) : setTimeout(prewarm, 1500);
  const go = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    host.removeEventListener('pointermove', go);
    prewarm().then(([m, src]) => { if (!cancelled) destroy = m.initTrail(media, src); });
  };
  host.addEventListener('pointermove', go, { passive: true });
  cleanups.push(() => {
    cancelled = true;
    'cancelIdleCallback' in window ? cancelIdleCallback(idle as number) : clearTimeout(idle);
    host.removeEventListener('pointermove', go);
    destroy?.();
  });
}

/* ───────── Page lifecycle ───────── */
async function mount() {
  cleanups.forEach((c) => c());
  cleanups = [];
  ticks = [];
  measurers = [];
  header();
  heroLoops();
  menu();
  faq();
  counters();
  scrollEffects();
  anchors();
  initForms();
  lenis?.resize();
  remeasure();
  // late layout changes (fonts, images, FAQ expanding) → measure again
  const ro = new ResizeObserver(() => remeasure());
  ro.observe(document.body);
  document.fonts?.ready.then(remeasure);
  cleanups.push(() => ro.disconnect());

  if (firstLoad) {
    firstLoad = false;
    const seen = sessionStorage.getItem('based:intro');
    try { sessionStorage.setItem('based:intro', '1'); } catch {}
    await wait(seen ? 150 : 850);
  }
  const head = document.querySelector('[data-header]');
  const intro = !!curtain()?.classList.contains('is-covered');
  if (!intro) head?.classList.add('is-in');
  heroIntro();
  await reveal();
  reveals();
  if (intro) setTimeout(() => head?.classList.add('is-in'), 250);
  desktopExtras();
}

export function boot() {
  if (!reduced) {
    lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), autoRaf: false });
  }
  wake();
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown', 'scroll', 'pointerdown', 'resize'])
    addEventListener(ev, wake, { passive: true });

  // Page transition: wipe gold stairs in, swap, wipe out.
  document.addEventListener('astro:before-preparation', (e) => {
    const original = e.loader;
    e.loader = async () => { await Promise.all([cover(), original()]); };
  });
  document.addEventListener('astro:after-swap', () => {
    lenis?.scrollTo(0, { immediate: true, force: true });
    wake();
  });
  document.addEventListener('astro:page-load', mount);
}
