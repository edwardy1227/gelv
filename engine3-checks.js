/* ═══════════════════════════════════════════════════════════════
   ENGINE 3 CHECKS — 组排页的追加契约(只读)
   仅在 body[data-composed] 时生效;包装 window.__v2Validate 合并结果,
   engine2.js 本体不动。参照系 = 全局格律(原点 = nav 下沿),不是 band 局部。
   每条契约都来自一次真实事故。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!document.body || document.body.dataset.composed === undefined) return;

  var L = (document.body.dataset.lattice || '64,28,140').split(',').map(Number);
  var ORIGIN = L[0], ROW = L[1], PERIOD = L[2];
  var TOL = 1.5;                                            // 零容差:只容亚像素舍入
  var CJK = /[一-鿿　-〿！-｠]/;
  var docTop = function (el) { return el.getBoundingClientRect().top + window.scrollY; };
  var offGrid = function (y, unit) {
    var r = ((y % unit) + unit) % unit;
    return Math.min(r, unit - r);
  };
  var name = function (el) { return el.dataset.t || el.textContent.trim().slice(0, 10) || el.tagName.toLowerCase(); };

  function extraChecks() {
    var errors = [], warnings = [];
    if (window.innerWidth <= 1024) return { errors: errors, warnings: warnings };   // 窄屏走流式,不受格律约束

    /* ① band 落格:每个 band 顶压在周期线上 —— 一个不落,全页共用一套格律 */
    document.querySelectorAll('[data-band]').forEach(function (b) {
      if (b.dataset.band === 'nav') return;                 // nav 即原点
      var d = offGrid(docTop(b) - ORIGIN, PERIOD);
      if (d > TOL) errors.push('格律契约: band <' + (b.id || b.dataset.band) + '> 顶偏离周期线 ' + d.toFixed(1) + 'px(其后全页漂移)');
    });

    /* ② 文本落行:每个文本块顶压在行线上(全局参照,非 band 局部) */
    document.querySelectorAll('[data-role]').forEach(function (el) {
      var d = offGrid(docTop(el) - ORIGIN, ROW);
      if (d > TOL) warnings.push('行格契约: ' + name(el) + ' 偏离行线 ' + d.toFixed(1) + 'px');
    });

    /* ③ 每行字数:渲染宽÷字号 落在角色区间 —— 来自「字号/栏宽失配」 */
    document.querySelectorAll('[data-measure]').forEach(function (el) {
      if (!CJK.test(el.textContent)) return;
      var mm = el.dataset.measure.split(',').map(Number);
      var per = el.clientWidth / parseFloat(getComputedStyle(el).fontSize);
      if (per < mm[0] - 0.5) warnings.push('度量契约: ' + name(el) + ' 每行约 ' + per.toFixed(1) + ' 字 < 下限 ' + mm[0]);
      if (per > mm[1] + 1) warnings.push('度量契约: ' + name(el) + ' 每行约 ' + per.toFixed(1) + ' 字 > 上限 ' + mm[1]);
    });

    /* ④ 孤字:标题末行不得只剩一个字/词 —— 量真实行盒(Range 矩形),语言无关 */
    document.querySelectorAll('[data-cjk-heading]').forEach(function (el) {
      var kids = Array.prototype.filter.call(el.children, function (k) { return getComputedStyle(k).display === 'block'; });
      (kids.length ? kids : [el]).forEach(function (p) {
        var rng = document.createRange();
        rng.selectNodeContents(p);
        var rects = Array.prototype.filter.call(rng.getClientRects(), function (r) { return r.width > 1; });
        if (rects.length < 2) return;
        var size = parseFloat(getComputedStyle(p).fontSize);
        var lastW = rects[rects.length - 1].width;
        if (lastW < 1.6 * size) errors.push('孤字契约: 「' + p.textContent.trim().slice(0, 12) + '…」末行只剩一个字/词(' + Math.round(lastW) + 'px)');
      });
    });

    /* ⑤ 图片吸附:高 = n×模块 + (n−1)×沟 —— 来自「任意宽高比」 */
    document.querySelectorAll('[data-fields]').forEach(function (el) {
      var h = el.getBoundingClientRect().height;
      if (offGrid(h + ROW, PERIOD) > TOL) warnings.push('吸附契约: 图片高 ' + Math.round(h) + 'px ≠ 整数模块+沟');
    });

    /* ⑥ 原子不折行:按钮/胶囊/链接内部不换行不溢出 —— 来自「网格线开」竖排 */
    document.querySelectorAll('[data-atom]').forEach(function (el) {
      var cs = getComputedStyle(el);
      var one = (parseFloat(cs.lineHeight) || ROW) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      if (el.getBoundingClientRect().height > one + 2) errors.push('原子契约: 「' + name(el) + '」内部折行');
      if (el.scrollWidth > el.clientWidth + 1) warnings.push('原子契约: 「' + name(el) + '」横向溢出');
    });

    /* ⑦ 语言不变式:换语言不得改变任何 band 高度(块高按中英取大值组排) */
    var sig = [];
    document.querySelectorAll('[data-band]').forEach(function (b) { sig.push(Math.round(b.getBoundingClientRect().height)); });
    sig = sig.join(',');
    if (window.__gelvLangSig && window.__gelvLangSig !== sig) {
      errors.push('语言不变式: 换语言后 band 高度改变了(组排未按中英取大值)');
    }
    window.__gelvLangSig = sig;

    return { errors: errors, warnings: warnings };
  }

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
    window.__v2Validate();
  };
  wrap();
})();
