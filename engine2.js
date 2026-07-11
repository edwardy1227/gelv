/* ═══════════════════════════════════════════════════════════════
   ENGINE v2 — band/grid layout engine runtime
   Responsibilities (and nothing else):
     1. hydrate()  — project band data attributes to CSS vars, once
     2. validate() — read-only contract checks after fonts+images settle
     3. panel()    — dev panel (overlay toggle / validate / export)
     4. exportConfig()/loadConfig() — lossless token+band projection
   There is NO measure-then-mutate loop. Layout is owned by CSS.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const UNIT = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--unit')) || 8;

  const bands = () => Array.from(document.body.children).filter(el => el.dataset && el.dataset.band !== undefined);
  const flowBands = () => bands().filter(el => !(el.dataset.band === 'nav' && el.dataset.nav === 'overlay'));

  // ═══════ 1. HYDRATE ═══════
  function hydrate() {
    authoredCols = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cols')) || 12;
    bands().forEach(b => {
      const h = parseInt(b.dataset.h);
      if (h > 0) b.style.setProperty('--band-h', h + 'px');
    });
    // --nav-h is a projection of the nav band's data-h; the site must not
    // hand-write it (single source of truth). auto-iterate reads it from :root.
    const nav = bands().find(b => b.dataset.band === 'nav');
    let navH = 0;
    if (nav) navH = parseInt(nav.dataset.h) || Math.round(nav.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--nav-h', navH + 'px');
  }

  // ═══════ 2. VALIDATE (read-only) ═══════
  async function validate() {
    const errors = [], warnings = [], infos = [];
    const unit = UNIT();

    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })));

    // fonts declared in tokens must actually resolve: either a known system
    // family, or an @font-face that exists AND loaded. fonts.check() alone
    // returns true for families that were never declared at all.
    const cs = getComputedStyle(document.documentElement);
    const SYSTEM_FAMILIES = ['system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace', 'ui-monospace',
      'Georgia', 'Helvetica', 'Helvetica Neue', 'Arial', 'Times', 'Times New Roman', 'Courier', 'Courier New',
      'Verdana', 'Tahoma', 'Trebuchet MS', 'SF Pro Text', 'SF Pro Display', 'Menlo', 'Monaco'];
    const declaredFaces = Array.from(document.fonts).map(f => f.family.replace(/^["']|["']$/g, '').toLowerCase());
    ['--font-sans', '--font-serif', '--font-mono'].forEach(tok => {
      const stack = cs.getPropertyValue(tok).trim();
      if (!stack) return;
      const first = stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (!first || SYSTEM_FAMILIES.some(f => f.toLowerCase() === first.toLowerCase())) return;
      if (!declaredFaces.includes(first.toLowerCase())) {
        errors.push(`${tok} references "${first}" but no @font-face declares it (silent fallback changes all metrics)`);
      } else if (!document.fonts.check(`16px "${first}"`)) {
        errors.push(`font declared but failed to load: ${tok} = "${first}" (check the src url)`);
      }
    });

    // images must decode
    Array.from(document.images).forEach(img => {
      if (img.getAttribute('src') && img.naturalWidth === 0) errors.push(`broken image: ${img.getAttribute('src')}`);
    });

    // media geometry
    document.querySelectorAll('.media').forEach(m => {
      const styled = (m.getAttribute('style') || '').includes('--ar') || m.style.height || m.closest('[data-bleed="media"]');
      if (!styled && !m.offsetHeight) warnings.push('.media without --ar or explicit height (zero-size box)');
    });

    // span contract
    document.querySelectorAll('[data-span]').forEach(el => {
      const s = +el.dataset.span, st = el.dataset.start ? +el.dataset.start : null;
      if (!(s >= 1 && s <= 12)) errors.push(`data-span=${el.dataset.span} out of 1..12`);
      else if (st !== null && st + s > 13) errors.push(`data-start=${st} + data-span=${s} exceeds column 12`);
    });

    // rendered span must match declared span — catches placement/cascade
    // bugs (a span-8 item silently collapsing to one track) that pure
    // attribute arithmetic can't see. Only meaningful in the canonical
    // 12-column state: applyCols() projections intentionally diverge.
    const desktop = window.innerWidth > 1024;
    const canonical = (parseInt(cs.getPropertyValue('--cols')) || 12) === authoredCols;
    if (!canonical) infos.push(`--cols is projected (≠authored ${authoredCols}): rendered-span and band-overflow checks skipped`);
    if (desktop && canonical) {
      document.querySelectorAll('.g > [data-span]').forEach(el => {
        if (getComputedStyle(el).position === 'absolute') return;
        const g = el.parentElement;
        const gcs = getComputedStyle(g);
        const cols = parseInt(cs.getPropertyValue('--cols')) || 12;
        const gap = parseFloat(gcs.columnGap) || 0;
        const inner = g.clientWidth - parseFloat(gcs.paddingLeft) - parseFloat(gcs.paddingRight);
        const colW = (inner - (cols - 1) * gap) / cols;
        const span = +el.dataset.span;
        const expected = span * colW + (span - 1) * gap;
        const actual = el.getBoundingClientRect().width;
        if (Math.abs(actual - expected) > colW / 2) {
          errors.push(`[data-span="${span}"] renders at ${Math.round(actual)}px, expected ~${Math.round(expected)}px (~${Math.max(1, Math.round((actual + gap) / (colW + gap)))} tracks) — placement collapsed or overridden`);
        }
      });
    }
    let flowSum = 0;
    bands().forEach(b => {
      const mb = getComputedStyle(b);
      if (parseFloat(mb.marginTop) || parseFloat(mb.marginBottom)) warnings.push(`band <${b.dataset.band}> has margin (breaks Σband reconciliation; keep spacing inside)`);
      const authored = parseInt(b.dataset.h) || 0;
      const frees = b.querySelectorAll('.free').length;
      const items = b.querySelectorAll('[data-span]').length;
      if (frees && !authored) errors.push(`band <${b.dataset.band}> uses .free without data-h (band collapses)`);
      if (frees) infos.push(`band <${b.dataset.band}>: .free=${frees} vs grid items=${items}`);
      if (desktop && canonical && authored) {
        if (b.dataset.clip !== undefined) {
          const over = b.scrollHeight - b.clientHeight;
          if (over > 2) infos.push(`band <${b.dataset.band}> clips ${over}px of content (data-clip)`);
        } else if (b.scrollHeight > authored + 2) {
          errors.push(`band <${b.dataset.band}> overflows authored height: content ${b.scrollHeight}px > data-h ${authored}px`);
        }
        // absolute children escape scrollHeight — check rects
        const br = b.getBoundingClientRect();
        b.querySelectorAll('.free').forEach(f => {
          const fr = f.getBoundingClientRect();
          if (fr.bottom > br.bottom + 2 || fr.right > br.right + 2) warnings.push(`.free element sticks out of band <${b.dataset.band}>`);
        });
        // vertical rhythm (warn only, half-unit grid)
        if (authored % (unit / 2) !== 0) warnings.push(`band <${b.dataset.band}> data-h=${authored} off the ${unit / 2}px rhythm`);
      }
      if (!(b.dataset.band === 'nav' && b.dataset.nav === 'overlay')) flowSum += b.offsetHeight;
    });

    // MB rhythm checks (GRID_THEORY_网格理论.md): the gutter derives from the
    // line unit; display line-heights should sit in simple ratios to body.
    const gutterV = parseFloat(cs.getPropertyValue('--gutter'));
    if (gutterV > 0 && gutterV % (unit / 2) !== 0) warnings.push(`--gutter ${gutterV}px off the ${unit / 2}px rhythm (MB: gutter = Leerzeile, a line-unit multiple)`);
    const bodyLh = parseFloat(cs.getPropertyValue('--type-body-lh'));
    if (bodyLh) {
      ['--type-h1-lh', '--type-h2-lh', '--type-h3-lh'].forEach(k => {
        const v = parseFloat(cs.getPropertyValue(k));
        if (!v) return;
        const r = v / bodyLh;
        if (Math.abs(r - Math.round(r)) > 0.01 && Math.abs(r * 2 - Math.round(r * 2)) > 0.02)
          infos.push(`${k} = ${(r).toFixed(2)}× body line-height — MB favours simple ratios (1, 1.5, 2, 3×)`);
      });
      const lineUnits = bands().filter(b => b.dataset.h).map(b => (b.dataset.h / bodyLh).toFixed(1));
      if (lineUnits.length) infos.push(`band heights in text lines: ${lineUnits.join(' / ')}`);
    }

    // Σband reconciliation against --target-h (desktop only; never drives layout)
    const target = parseInt(cs.getPropertyValue('--target-h')) || 0;
    if (desktop && target) {
      const diff = document.body.scrollHeight - target;
      (Math.abs(diff) > 2 * unit ? warnings : infos).push(`Σbands ${document.body.scrollHeight}px vs --target-h ${target}px (Δ ${diff > 0 ? '+' : ''}${diff}px)`);
    }

    // stray non-band body children (cookie banners etc.) — allowed if fixed
    Array.from(document.body.children).forEach(el => {
      if (el.dataset && el.dataset.band !== undefined) return;
      if (['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)) return;
      if (el.id === 'ctrlPanel' || el.id === 'ctrlToggle' || el.classList.contains('ov')) return;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'absolute') infos.push(`non-band overlay element <${el.tagName.toLowerCase()}${el.className ? '.' + el.className.split(' ')[0] : ''}> (not counted in Σband)`);
      else warnings.push(`non-band in-flow element <${el.tagName.toLowerCase()}> in <body> (breaks the band stack contract)`);
    });

    const result = { errors, warnings, infos, at: new Date().toISOString() };
    window.__v2ValidationResult = result;
    const badge = $('#v2badge');
    if (badge) {
      badge.className = errors.length ? 'fail' : warnings.length ? 'warn' : 'ok';
      badge.textContent = `✕ ${errors.length}  ⚠ ${warnings.length}  ℹ ${infos.length}`;
      badge.title = [...errors, ...warnings].join('\n');
    }
    errors.forEach(e => console.error('[v2]', e));
    warnings.forEach(w => console.warn('[v2]', w));
    infos.forEach(i => console.info('[v2]', i));
    return result;
  }

  // ═══════ GRID PROJECTION ═══════
  // data-span/data-start are authored against the site's native column
  // system (--cols at load — 12 for hand-authored sites, possibly 5/10/…
  // for cold-reconstructed ones). In the authored state the static CSS
  // rules place everything; any other column count is a proportional
  // projection — a pure, idempotent function of the data attributes.
  let authoredCols = 12;
  window.__v2AuthoredCols = () => authoredCols;
  window.applyCols = function (n) {
    n = Math.max(1, Math.min(12, Math.round(n) || authoredCols));
    document.documentElement.style.setProperty('--cols', n);
    document.querySelectorAll('.g > [data-span]').forEach(el => {
      if (n === authoredCols) { el.style.gridColumn = ''; return; }
      const span = Math.max(1, Math.round((+el.dataset.span / authoredCols) * n));
      const start = el.dataset.start ? Math.min(n, Math.max(1, Math.round(((+el.dataset.start - 1) / authoredCols) * n) + 1)) : null;
      el.style.gridColumn = start ? `${start} / span ${Math.min(span, n - start + 1)}` : `auto / span ${Math.min(span, n)}`;
    });
    const ov = $('#ovCol');
    if (ov) { ov.innerHTML = ''; for (let i = 0; i < n; i++) ov.appendChild(document.createElement('div')); }
  };

  // ═══════ 3. PANEL (dev only) ═══════
  // When embedded (workbench iframe) the page stays clean: overlays exist
  // but hidden, no panel chrome; the workbench drives everything through
  // the postMessage bridge below.
  const EMBEDDED = window.self !== window.top;

  function injectOverlays() {
    if ($('#ovCol')) return;
    const ovCol = document.createElement('div');
    ovCol.className = 'ov'; ovCol.id = 'ovCol';
    for (let i = 0; i < 12; i++) ovCol.appendChild(document.createElement('div'));
    ovCol.style.height = document.body.scrollHeight + 'px';
    document.body.appendChild(ovCol);
    const ovBase = document.createElement('div');
    ovBase.className = 'ov'; ovBase.id = 'ovBase';
    ovBase.style.height = document.body.scrollHeight + 'px';
    document.body.appendChild(ovBase);
  }

  function injectPanel() {
    if ($('#ctrlPanel')) return;
    injectOverlays();
    const ovCol = $('#ovCol'), ovBase = $('#ovBase');

    const toggle = document.createElement('button');
    toggle.className = 'ctrl-toggle'; toggle.id = 'ctrlToggle';
    toggle.innerHTML = '&#9881;';
    toggle.onclick = () => { $('#ctrlPanel').classList.remove('collapsed'); toggle.classList.remove('show'); };
    document.body.appendChild(toggle);

    const cs = getComputedStyle(document.documentElement);
    const tokN = (k, fb) => parseInt(cs.getPropertyValue(k)) || fb;

    const panel = document.createElement('div');
    panel.className = 'ctrl'; panel.id = 'ctrlPanel';
    panel.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <span style="font:700 11px/16px 'Lab Grotesque';letter-spacing:.1em;text-transform:uppercase;color:#666">Engine v2</span>
    <button id="v2close" style="border:none;background:none;font-size:17px;cursor:pointer;color:#999;line-height:1">&times;</button>
  </div>
  <label><input type="checkbox" id="v2ov"> Columns overlay</label>
  <label><input type="checkbox" id="v2ovb"> Baseline overlay</label>
  <div class="inp-row"><input type="number" id="v2cols" value="${tokN('--cols', 12)}" min="1" max="12"><span class="inp-label">columns</span></div>
  <div class="inp-row"><input type="number" id="v2gutter" value="${tokN('--gutter', 16)}" min="0" max="64" step="2"><span class="inp-label">px gutter</span></div>
  <div class="inp-row"><input type="number" id="v2margin" value="${tokN('--margin-l', 0)}" min="0" max="240" step="4"><span class="inp-label">px margin</span></div>
  <div class="inp-row"><input type="number" id="v2unit" value="${tokN('--unit', 8)}" min="2" max="16"><span class="inp-label">px unit</span></div>
  <button class="sbtn" id="v2validate">Validate</button>
  <button class="sbtn" id="v2export">Export Config</button>
  <div id="v2badge"></div>
  <div style="margin-top:6px;font:600 10px/14px monospace;color:#bbb">edits are live-only —<br>Export Config to persist</div>`;
    document.body.appendChild(panel);
    $('#v2close').onclick = () => { panel.classList.add('collapsed'); toggle.classList.add('show'); };
    const syncOvH = () => { const h = document.body.scrollHeight + 'px'; ovCol.style.height = h; ovBase.style.height = h; };
    $('#v2ov').onchange = e => { syncOvH(); ovCol.classList.toggle('on', e.target.checked); };
    $('#v2ovb').onchange = e => { syncOvH(); ovBase.classList.toggle('on', e.target.checked); };
    $('#v2cols').oninput = e => { applyCols(+e.target.value); syncOvH(); };
    $('#v2gutter').oninput = e => document.documentElement.style.setProperty('--gutter', (+e.target.value || 0) + 'px');
    $('#v2margin').oninput = e => { const v = (+e.target.value || 0) + 'px'; const r = document.documentElement.style; r.setProperty('--margin-l', v); r.setProperty('--margin-r', v); };
    $('#v2unit').oninput = e => document.documentElement.style.setProperty('--unit', Math.max(2, +e.target.value || 8) + 'px');
    $('#v2validate').onclick = () => validate();
    $('#v2export').onclick = () => {
      const cfg = exportConfig();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
      a.download = (cfg.slug || 'config') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }

  // ═══════ 4. CONFIG (lossless projection) ═══════
  const TOKEN_KEYS = ['--unit', '--cols', '--gutter', '--margin', '--margin-l', '--margin-r', '--max-w', '--target-h',
    '--font-sans', '--font-serif', '--font-mono',
    '--c-bg', '--c-bg-alt', '--c-bg-dark', '--c-bg-s1', '--c-bg-s2', '--c-ink', '--c-body', '--c-muted', '--c-link', '--c-link-hover', '--c-accent', '--c-on-accent', '--c-on-dark', '--c-border',
    '--type-h1-size', '--type-h1-lh', '--type-h1-wt', '--type-h2-size', '--type-h2-lh', '--type-h2-wt', '--type-h3-size', '--type-h3-lh', '--type-h3-wt',
    '--type-body-size', '--type-body-lh', '--type-small-size', '--type-small-lh', '--type-cap-size', '--type-cap-lh',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-full',
    '--bp-lg-cols', '--bp-md-cols', '--bp-md-gutter', '--bp-md-margin', '--bp-sm-cols', '--bp-sm-gutter', '--bp-sm-margin'];

  window.exportConfig = function () {
    const cs = getComputedStyle(document.documentElement);
    const tokens = {};
    TOKEN_KEYS.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) tokens[k] = v; }); // raw strings, no parsing
    const prev = window.__v2ConfigUrl || null;
    return {
      engine: 2,
      slug: document.body.dataset.slug || 'untitled',
      name: document.title || '',
      url: prev,
      savedAt: new Date().toISOString(),
      tokens,
      bands: bands().map((b, i) => ({
        i,
        band: b.dataset.band,
        h: b.dataset.h ? +b.dataset.h : null,
        clip: b.dataset.clip !== undefined || undefined,
        nav: b.dataset.nav || undefined,
        bleed: b.dataset.bleed || undefined,
        distribute: b.dataset.distribute || undefined
      }))
    };
  };

  window.loadConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.engine !== 2) {
      console.error('[v2] loadConfig: not an engine-2 config (v1 configs are not accepted; re-author band metadata)');
      const badge = $('#v2badge'); if (badge) { badge.className = 'fail'; badge.textContent = 'config rejected: not engine 2'; }
      return;
    }
    Object.entries(cfg.tokens || {}).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    if (Array.isArray(cfg.bands)) {
      const live = bands();
      if (cfg.bands.length !== live.length) {
        console.error(`[v2] loadConfig: band count mismatch (config ${cfg.bands.length} vs DOM ${live.length}) — refusing to apply band metadata; DOM is never reordered`);
      } else {
        cfg.bands.forEach((meta, i) => {
          const b = live[i];
          if (meta.h) b.dataset.h = meta.h; else delete b.dataset.h;
          if (meta.clip) b.dataset.clip = ''; else delete b.dataset.clip;
          if (meta.nav) b.dataset.nav = meta.nav; else delete b.dataset.nav;
          if (meta.bleed) b.dataset.bleed = meta.bleed; else delete b.dataset.bleed;
          if (meta.distribute) b.dataset.distribute = meta.distribute; else delete b.dataset.distribute;
        });
      }
    }
    if (cfg.url) window.__v2ConfigUrl = cfg.url;
    hydrate();
  };

  window.__v2Validate = validate;

  // ═══════ ENTRY ANIMATIONS (ported from v1, attribute-compatible) ═══════
  const animObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        if (el.dataset.animDelay) el.style.setProperty('--anim-stagger', el.dataset.animDelay);
        el.classList.add('anim-visible');
        animObserver.unobserve(el);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  function initAnimations() {
    document.querySelectorAll('[data-anim]:not([data-anim="none"])').forEach(el => {
      if (el.getBoundingClientRect().top < window.innerHeight * 1.1) {
        setTimeout(() => el.classList.add('anim-visible'), +(el.dataset.animDelay || 0));
      } else animObserver.observe(el);
    });
    // release author styles once the entry animation finishes (see .anim-done)
    document.addEventListener('animationend', e => {
      if (e.target.dataset && e.target.dataset.anim !== undefined) e.target.classList.add('anim-done');
    });
  }

  // ═══════ WORKBENCH BRIDGE (postMessage, active only when embedded) ═══════
  function initBridge() {
    window.addEventListener('message', async e => {
      const m = e.data || {};
      if (!m || m.v2 === undefined) return;
      if (m.v2 === 'token') {
        document.documentElement.style.setProperty(m.key, m.value);
        if (m.key === '--cols') applyCols(parseInt(m.value) || 12);
      } else if (m.v2 === 'overlay') {
        injectOverlays();
        const el = $(m.which === 'baseline' ? '#ovBase' : '#ovCol');
        if (el) { el.style.height = document.body.scrollHeight + 'px'; el.classList.toggle('on', !!m.on); }
      } else if (m.v2 === 'validate') {
        const r = await validate();
        (e.source || window.parent).postMessage({ v2: 'validation', result: r }, '*');
      } else if (m.v2 === 'get-tokens') {
        const cs = getComputedStyle(document.documentElement);
        const tokens = {};
        ['--cols', '--gutter', '--margin-l', '--unit'].forEach(k => { tokens[k] = cs.getPropertyValue(k).trim(); });
        (e.source || window.parent).postMessage({ v2: 'tokens', tokens }, '*');
      }
    });
  }

  // ═══════ INIT ═══════
  function init() {
    hydrate();
    if (EMBEDDED) initBridge(); else injectPanel();
    requestAnimationFrame(() => setTimeout(initAnimations, 100));
    validate(); // async; fills badge + window.__v2ValidationResult when settled
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
