/* The first-launch guide: a few pages to swipe through. Each is a short title (four words at most) over a phone
   showing real screenshots of the app that play in a loop, with small labels pointing at what matters — the
   pictures do the explaining, not the words.
   app.js calls Intro.init({ native, onDone }) and Intro.open(). The pictures and where the labels go come from
   intro/data.js, made by tools/make_intro.py. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  // One per page of intro/data.js, in order (the web version has no last page: no history there).
  const TITLES = ['Answers as you type', 'Add brackets anywhere', 'Words name numbers', 'Add line by line', 'Convert by typing', 'Old pages are kept'];
  const STEP = 1500;      // how long a screenshot stays up
  const HOLD = 2800;      // … and the last one of a page, before it starts again

  let deps = {}, pages = [], built = false, current = 0, frame = 0, timer = null;
  const root = () => $('intro');

  // A phone with the page's screenshots stacked in it, and over the screen its labels (each with a line to the spot
  // it's about) and rings round buttons. p.marks: what shows on which screenshot.
  function phone(p, W, H) {
    const box = el('div', 'intro-phone');
    const body = el('div', 'intro-body');
    const screen = el('div', 'intro-screen');
    screen.style.aspectRatio = `${W} / ${H}`;
    p.imgs = p.shots.map(name => {
      const img = el('img', 'intro-shot');
      img.src = `intro/${name}.webp`;
      img.alt = '';
      img.draggable = false;
      screen.appendChild(img);
      return img;
    });
    body.append(screen, el('div', 'intro-island'));
    const over = el('div', 'intro-over');
    over.style.aspectRatio = `${W} / ${H}`;
    const lines = svg('svg', { class: 'intro-lines', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
    over.appendChild(lines);
    p.marks = [];
    for (const r of p.rings || []) {
      const [x0, y0, x1, y1] = [r.box[0] * W, r.box[1] * H, r.box[2] * W, r.box[3] * H], pad = W * 0.012;
      const ring = svg('rect', { class: 'intro-ring', x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad, rx: (y1 - y0) / 2 + pad });
      lines.appendChild(ring);
      p.marks.push({ frames: r.frames, nodes: [ring] });
    }
    for (const n of p.notes || []) {
      const [tx, ty, ax, ay] = [n.tip[0] * W, n.tip[1] * H, n.at[0] * W, n.at[1] * H];
      const g = svg('g', { class: 'intro-mark' });
      g.append(svg('line', { x1: ax, y1: ay, x2: tx, y2: ty }),
               svg('circle', { class: 'intro-pulse', cx: tx, cy: ty, r: W * 0.011 }),
               svg('circle', { cx: tx, cy: ty, r: W * 0.011 }));
      lines.appendChild(g);
      const chip = el('span', 'intro-chip', n.text);
      chip.style.left = n.at[0] * 100 + '%';
      chip.style.top = n.at[1] * 100 + '%';
      over.appendChild(chip);
      p.marks.push({ frames: n.frames, nodes: [g, chip] });
    }
    box.append(body, over);
    return box;
  }

  function build() {
    const r = root(), data = window.INTRO_SHOTS || {};
    const [W, H] = data.size || [1206, 2622];
    pages = (deps.native ? data.native : data.web) || [];
    const top = el('div', 'intro-top');
    const skip = el('button', 'intro-skip', 'Skip');
    skip.addEventListener('click', close);
    top.appendChild(skip);
    const strip = el('div', 'intro-pages');
    strip.id = 'introPages';
    pages.forEach((p, i) => {
      const sec = el('section', 'intro-page');
      const stage = el('div', 'intro-stage');
      stage.appendChild(phone(p, W, H));
      sec.append(el('h2', '', TITLES[i]), stage);
      strip.appendChild(sec);
    });
    const foot = el('div', 'intro-foot');
    const dots = el('div', 'intro-dots');
    dots.id = 'introDots';
    pages.forEach(() => dots.appendChild(el('span')));
    const next = el('button', 'intro-next', 'Next');
    next.id = 'introNext';
    next.addEventListener('click', () => {
      if (current >= pages.length - 1) close();
      else strip.scrollTo({ left: (current + 1) * strip.clientWidth, behavior: 'smooth' });
    });
    foot.append(dots, next);
    r.append(top, strip, foot);
    strip.addEventListener('scroll', () => {
      const i = Math.max(0, Math.min(pages.length - 1, Math.round(strip.scrollLeft / (strip.clientWidth || 1))));
      if (i !== current) show(i);
    }, { passive: true });
  }

  // The page on screen plays its screenshots; the others wait on their first one.
  function show(i) {
    current = i;
    [...$('introDots').children].forEach((d, n) => d.classList.toggle('on', n === i));
    $('introNext').textContent = i >= pages.length - 1 ? 'Start' : 'Next';
    play();
  }
  // The new screenshot fades in over the one before it (which stays put underneath, so nothing dips to black);
  // labels that belong to both simply stay.
  function setFrame(n) {
    const p = pages[current];
    p.imgs.forEach((img, k) => {
      img.classList.toggle('was', k === frame && k !== n);
      img.classList.toggle('on', k === n);
    });
    for (const m of p.marks) m.nodes.forEach(node => node.classList.toggle('show', m.frames.includes(n)));
    frame = n;
  }
  function play() {
    clearTimeout(timer);
    const count = pages[current].imgs.length;
    setFrame(0);
    const tick = () => {
      const n = (frame + 1) % count;
      setFrame(n);
      timer = setTimeout(tick, n === count - 1 ? HOLD : STEP);
    };
    timer = setTimeout(tick, STEP);
  }

  function open() {
    if (!built) { build(); built = true; }
    if (!pages.length) { if (deps.onDone) deps.onDone(); return; }
    const r = root();
    r.classList.add('open');
    r.inert = false;
    r.setAttribute('aria-hidden', 'false');
    $('introPages').scrollLeft = 0;
    show(0);
  }
  function close() {
    clearTimeout(timer);
    const r = root();
    r.classList.remove('open');
    r.inert = true;
    r.setAttribute('aria-hidden', 'true');
    if (deps.onDone) deps.onDone();
  }
  function init(o) { deps = o || {}; }

  window.Intro = { init, open, close };
})();
