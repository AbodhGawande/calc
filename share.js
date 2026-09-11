/* Share the page as text (answers included) or as a picture drawn the way it looks on screen.
   app.js calls Share.init({ text, page, segmentsFor, answerFor, resultText, toast, onOpen }). */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let deps = null;

  // "45 pizza + 18 drinks = bill (63)", "320 mi to km = 514.99 km", "45 + 18 = 63".
  function pageAsText() {
    const page = deps.page();
    return deps.text().split('\n').map((line, i) => {
      const info = page.lines[i];
      const ans = info && (info.status === 'answer' || info.status === 'live') ? deps.resultText(info) : null;
      if (!ans) return line;
      if (info.defSyntax) return line.replace(/\s+$/, '') + ' (' + ans + ')';
      return line.replace(/\s*=\s*$/, '') + ' = ' + ans;
    }).join('\n').replace(/\s+$/, '');
  }

  function pageAsImage() {
    const lines = deps.text().split('\n'), page = deps.page();
    const S = 2, W = 390 * S, pad = 22 * S, gap = 10 * S;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
    const font = (px, bold) => `${bold ? 600 : 400} ${px}px ${family}`;
    const isName = cls => cls === 'v' || cls === 'def';
    // Fit the widest line at up to 20px; never below 12px.
    let fs = 20 * S;
    const widthOf = (i, px) => {
      const info = page.lines[i];
      let w = 0;
      for (const sg of deps.segmentsFor(lines[i], info)) { g.font = font(px, isName(sg.cls)); w += g.measureText(sg.text).width; }
      const ans = info && deps.answerFor(info);
      if (ans) { g.font = font(px, false); w += gap + g.measureText(ans.text).width + 16 * S; }
      return w;
    };
    const widest = Math.max(1, ...lines.map((_, i) => widthOf(i, fs)));
    fs = Math.max(12 * S, Math.min(fs, Math.floor(fs * (W - 2 * pad) / widest)));
    const lh = fs * 1.5;
    const H = pad * 2 + lines.length * lh + 30 * S;
    c.width = W; c.height = H;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const info = page.lines[i], y = pad + i * lh + lh / 2;
      let x = pad;
      for (const sg of deps.segmentsFor(line, info)) {
        const name = isName(sg.cls);
        g.font = font(sg.cls === 'divider' ? fs * 0.7 : fs, name);
        g.fillStyle = name ? '#64d2ff' : sg.cls === 'arrow' || sg.cls === 'divider' ? '#8e8e93' : '#fff';
        g.fillText(sg.text, x, y);
        x += g.measureText(sg.text).width;
      }
      const ans = info && deps.answerFor(info);
      if (ans && !ans.dim) {
        g.font = font(fs, false);
        const w = g.measureText(ans.text).width + 16 * S, h = lh * 0.92, px = W - pad - w;
        g.fillStyle = ans.live ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.14)';
        g.beginPath(); g.roundRect(px, y - h / 2, w, h, 9 * S); g.fill();
        g.fillStyle = ans.live ? 'rgba(255,159,10,0.7)' : '#ff9f0a';
        g.fillText(ans.text, px + 8 * S, y);
      }
    });
    g.font = font(11 * S, false); g.fillStyle = '#48484a';
    g.fillText('Tote', pad, H - 15 * S);
    return new Promise(resolve => c.toBlob(resolve, 'image/png'));
  }

  const sheet = () => $('shareSheet');
  function open() {
    if (!deps.text().trim()) { deps.toast('Nothing to share yet'); return; }
    if (deps.onOpen) deps.onOpen();
    sheet().classList.add('open');
    sheet().inert = false;
    sheet().setAttribute('aria-hidden', 'false');
  }
  function close() {
    sheet().classList.remove('open');
    sheet().inert = true;
    sheet().setAttribute('aria-hidden', 'true');
  }

  async function shareText() {
    const body = pageAsText();
    close();
    try {
      if (navigator.share) await navigator.share({ text: body });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(body); deps.toast('Copied the page as text'); }
      else deps.toast('Sharing isn’t available here');
    } catch (e) {
      if (e && e.name !== 'AbortError') deps.toast('Couldn’t share');
    }
  }
  async function shareImage() {
    close();
    try {
      const blob = await pageAsImage();
      const file = new File([blob], 'tote.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
      else if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        deps.toast('Copied the page as a picture');
      } else deps.toast('Sharing pictures isn’t available here');
    } catch (e) {
      if (e && e.name !== 'AbortError') deps.toast('Couldn’t share');
    }
  }

  function init(d) {
    deps = d;
    $('shareBtn').addEventListener('click', open);
    $('shareDone').addEventListener('click', close);
    sheet().addEventListener('click', e => { if (e.target === sheet()) close(); });
    $('shareText').addEventListener('click', shareText);
    $('shareImage').addEventListener('click', shareImage);
  }

  window.Share = { init, open, close, pageAsText };
})();
