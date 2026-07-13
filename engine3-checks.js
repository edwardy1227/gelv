/* ═══════════════════════════════════════════════════════════════
   ENGINE 3 CHECKS — 组排页专属的五条追加契约(只读)
   仅在 body[data-composed] 时生效;通过包装 window.__v2Validate 合并结果,
   engine2.js 本体保持不动。每条契约都来自一次真实事故。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!document.body || document.body.dataset.composed === undefined) return;

  var LINE = 28;
  var CJK = /[一-鿿　-〿！-｠]/;
  var isCjk = function (s) { return CJK.test(s || ''); };
  var emWidth = function (s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += CJK.test(s[i]) ? 1 : 0.55;
    return w;
  };

  function extraChecks() {
    var errors = [], warnings = [];

    /* 契约① 基线:文本块相对所在 band 顶的偏移 ≡ 0 (mod 一行)——来自「乱对齐」事故 */
    document.querySelectorAll('[data-role]').forEach(function (el) {
      var bandEl = el.closest('[data-band]');
      if (!bandEl) return;
      var off = Math.round(el.getBoundingClientRect().top - bandEl.getBoundingClientRect().top);
      var rem = ((off % LINE) + LINE) % LINE;
      var half = Math.abs(rem - 14) <= 4;                     // 半行合法(图注制);容差±4=发丝线边框的合法累积
      if (!half && rem > 4 && rem < LINE - 4) warnings.push('基线契约: <' + el.tagName.toLowerCase() + '> 距 band 顶 ' + off + 'px,偏离行格 ' + Math.min(rem, LINE - rem) + 'px');
    });

    /* 契约② 每行字数:实际渲染宽÷字号 必须落在角色区间——来自「字号/栏宽失配」事故 */
    document.querySelectorAll('[data-measure]').forEach(function (el) {
      var mm = el.dataset.measure.split(',').map(Number);
      var size = parseFloat(getComputedStyle(el).fontSize);
      var per = el.clientWidth / size;
      if (isCjk(el.textContent)) {
        if (per < mm[0] - 0.5) warnings.push('度量契约: 每行约 ' + per.toFixed(1) + ' 字 < 下限 ' + mm[0] + ' (' + (el.dataset.t || el.tagName) + ')');
        if (per > mm[1] + 6) warnings.push('度量契约: 每行约 ' + per.toFixed(1) + ' 字 > 上限 ' + mm[1] + '(缺 max-width?) (' + (el.dataset.t || el.tagName) + ')');
      }
    });

    /* 契约③ CJK 孤字:标题末行不得 ≤1 字——来自孤字「块」事故 */
    document.querySelectorAll('[data-cjk-heading]').forEach(function (el) {
      var kids = Array.from(el.children).filter(function (k) { return getComputedStyle(k).display === 'block'; });
      var parts = kids.length ? kids : [el];               // 作者分行:逐行盒核查,不用整体折行模型
      parts.forEach(function (p) {
        var lh = parseFloat(getComputedStyle(p).lineHeight) || parseFloat(getComputedStyle(el).lineHeight);
        var lines = Math.max(1, Math.round(p.getBoundingClientRect().height / lh));
        if (lines < 2) return;
        var size = parseFloat(getComputedStyle(p).fontSize);
        var per = p.clientWidth / size;
        var em = emWidth(p.textContent.trim());
        var last = em - (lines - 1) * per;
        if (last > 0 && last <= 1.2) errors.push('孤字契约: 「' + p.textContent.trim().slice(0, 10) + '…」末行仅约 1 字挂行');
      });
    });

    /* 契约④ 图片吸附:高度 ≡ n×模块+(n−1)沟——来自「任意宽高比」事故 */
    document.querySelectorAll('[data-fields]').forEach(function (el) {
      if (window.innerWidth <= 1024) return;
      var h = el.getBoundingClientRect().height;
      var rem = (h + LINE) % (5 * LINE);
      if (rem > 2 && rem < 5 * LINE - 2) warnings.push('吸附契约: 图片高 ' + Math.round(h) + 'px 不等于整数模块+沟');
    });

    /* 契约⑤ 原子不折行:按钮/胶囊/数据行内部不得换行或溢出——来自「网格线开」竖排事故 */
    document.querySelectorAll('[data-atom]').forEach(function (el) {
      var cs = getComputedStyle(el);
      var lh = parseFloat(cs.lineHeight) || LINE;
      var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      var borY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      var oneLine = lh + padY + borY;
      var h = el.getBoundingClientRect().height;
      if (el.classList.contains('meta-rail') || el.classList.contains('skin-tile')) return; // 刻意多行的原子不适用单行契约
      if (h > oneLine + 2) errors.push('原子契约: 「' + el.textContent.trim().slice(0, 8) + '」内部折行 (' + Math.round(h) + 'px > ' + Math.round(oneLine) + 'px)');
      if (el.scrollWidth > el.clientWidth + 1) warnings.push('原子契约: 「' + el.textContent.trim().slice(0, 8) + '」横向溢出');
    });

    return { errors: errors, warnings: warnings };
  }

  /* 包装 __v2Validate:引擎结果 + 五条契约合并,徽标与门禁同看合并结果 */
  var wrap = function () {
    var orig = window.__v2Validate;
    if (!orig) { setTimeout(wrap, 50); return; }
    window.__v2Validate = function () {
      return orig().then(function (r) {
        var ex = extraChecks();
        r.errors = r.errors.concat(ex.errors);
        r.warnings = r.warnings.concat(ex.warnings);
        r.v3 = true;
        window.__v2ValidationResult = r;
        var badge = document.querySelector('#v2badge');
        if (badge) {
          badge.className = r.errors.length ? 'fail' : r.warnings.length ? 'warn' : 'ok';
          badge.textContent = '✕ ' + r.errors.length + '  ⚠ ' + r.warnings.length + '  ℹ ' + r.infos.length;
        }
        ex.errors.forEach(function (e) { console.error('[v3]', e); });
        ex.warnings.forEach(function (w) { console.warn('[v3]', w); });
        return r;
      });
    };
    window.__v2Validate();                                     // 首次合并复验,覆盖引擎的裸结果
  };
  wrap();
})();
