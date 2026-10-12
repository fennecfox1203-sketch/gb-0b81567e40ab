/* 분류 도넛. 숫자 표기는 화면의 글자에 두고, 그림만 그린다. */
(function (root) {
  'use strict';

  const COLORS = ['#8f3d2a', '#1e4a38', '#c47b2b', '#2f5d73', '#6b4c7a', '#3d6b4f', '#a65d4e', '#8a6a2f'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function arc(cx, cy, r, a0, a1) {
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.sin(a0);
    const y1 = cy - r * Math.cos(a0);
    const x2 = cx + r * Math.sin(a1);
    const y2 = cy - r * Math.cos(a1);
    return 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2);
  }

  function donut(categories) {
    const rows = (categories || []).filter(function (c) { return c.amount > 0; });
    if (!rows.length) return '';
    const top = rows.slice(0, 6).map(function (c, i) {
      return { name: c.name, amount: c.amount, color: COLORS[i % COLORS.length], click: true };
    });
    let rest = 0;
    rows.slice(6).forEach(function (c) { rest += c.amount; });
    if (rest > 0) top.push({ name: '기타', amount: rest, color: '#8a8175', click: false });
    const total = top.reduce(function (s, c) { return s + c.amount; }, 0);
    const size = 232;
    const cx = size / 2;
    const cy = size / 2;
    const r = 78;
    let html = '<svg class="donut" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="분류별 지출 비율">';
    if (top.length === 1) {
      const only = top[0];
      const act = only.click ? ' data-action="drill" data-cat="' + esc(only.name) + '"' : '';
      html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + only.color + '" stroke-width="34"' + act + '></circle>';
    } else {
      let angle = 0;
      top.forEach(function (part) {
        const sweep = (part.amount / total) * Math.PI * 2;
        const end = Math.min(angle + sweep, Math.PI * 2 - 0.0001);
        if (end - angle > 0.02) {
          const act = part.click ? ' data-action="drill" data-cat="' + esc(part.name) + '"' : '';
          html += '<path d="' + arc(cx, cy, r, angle + 0.015, end - 0.015) + '" fill="none" stroke="' + part.color + '" stroke-width="34" stroke-linecap="butt"' + act + '></path>';
        }
        angle += sweep;
      });
    }
    html += '<circle cx="' + cx + '" cy="' + cy + '" r="52" fill="#fffaf3"></circle>';
    html += '<text x="' + cx + '" y="' + (cy + 6) + '" text-anchor="middle" font-size="16" fill="#241c14">지출</text>';
    html += '</svg>';
    return html;
  }

  root.LedgerCharts = { donut: donut, COLORS: COLORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
