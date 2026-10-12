/* 화면. 계산은 ledger.js, 도넛은 charts.js. 시트 번호는 주소 #k= 에만 둔다. */
(function () {
  'use strict';

  const H = window.Household;
  const Charts = window.LedgerCharts;
  const esc = H.escHtml;
  const params = new URLSearchParams(location.search);
  const FIXTURE = params.get('fixture') || '';
  const DEMO = params.get('demo') === '1' || !!FIXTURE;

  const SHEET_KEY = 'coupleLedgerSheetId';
  const CACHE_KEY = 'coupleLedgerCacheV1';
  const LEDGER_TAB = '가계부';
  const CATEGORY_TABS = ['분류대응', '분류표', '분류'];

  const $ = function (id) { return document.getElementById(id); };

  let sheetId = DEMO ? '' : readSheetId();
  let booting = !DEMO && !!sheetId;
  let syncing = false;
  let gvizSeq = 0;

  const state = {
    tab: 'summary',
    mode: 'month',
    anchor: '',
    today: '',
    drill: '',
    q: '',
    dir: 'all',
    catFilter: '',
    limit: 40,
    chartYm: ''
  };

  let DATA = {
    transactions: [],
    error: null,
    mapNote: '',
    banner: '',
    bannerKind: 'info',
    source: '',
    hhmm: ''
  };

  function readSheetId() {
    const m = /[#&]k=([A-Za-z0-9_-]{20,})/.exec(location.hash || '');
    if (m) {
      try { localStorage.setItem(SHEET_KEY, m[1]); } catch (e) {}
      return m[1];
    }
    try { return localStorage.getItem(SHEET_KEY) || ''; } catch (e) { return ''; }
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || raw.v !== 1 || typeof raw.ledgerText !== 'string') return null;
      return raw;
    } catch (e) { return null; }
  }

  function writeCache(ledgerText, categoryText, hhmm) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        hhmm: hhmm,
        ledgerText: ledgerText,
        categoryText: categoryText || ''
      }));
    } catch (e) {}
  }

  function stamp(d) {
    const x = d || new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return (x.getMonth() + 1) + '/' + x.getDate() + ' ' + p(x.getHours()) + ':' + p(x.getMinutes());
  }

  function hhmm(d) {
    const x = d || new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(x.getHours()) + ':' + p(x.getMinutes());
  }

  function fixtureNote() {
    if (FIXTURE === 'shuffled') return '열 순서를 바꾼 예시입니다. 머리글 이름으로 읽고 있어요.';
    if (FIXTURE === 'empty') return '빈 시트 예시입니다.';
    if (FIXTURE === 'noheader') return '머리글이 없는 시트 예시입니다.';
    if (DEMO) return '가짜로 만든 예시입니다. 실제 가계부가 아닙니다.';
    return '';
  }

  function defaultAnchor(transactions) {
    const cur = H.seoulYm();
    if (!DEMO) return cur;
    const live = (transactions || []).some(function (tx) {
      return tx.ym === cur && tx.kind !== 'carry';
    });
    if (live) return cur;
    let latest = '';
    (transactions || []).forEach(function (tx) {
      if (tx.ym > latest) latest = tx.ym;
    });
    return latest || cur;
  }

  function ensureAnchor() {
    if (!DATA.transactions.length) return;
    if (!state.today) {
      state.today = defaultAnchor(DATA.transactions);
      state.anchor = state.today;
      return;
    }
    if (!DEMO) state.today = H.seoulYm();
  }

  function applyParsed(parsed, source) {
    DATA.transactions = parsed.transactions || [];
    DATA.error = parsed.error || null;
    DATA.mapNote = parsed.mapNote || '';
    DATA.skipNote = parsed.skipNote || '';
    DATA.source = source;
    DATA.banner = fixtureNote();
    DATA.bannerKind = parsed.error && parsed.error.code !== 'empty' ? 'err' : 'info';
    ensureAnchor();
  }

  function setStatus(text) {
    const el = $('syncStatus');
    if (el) el.textContent = text || '';
  }

  function hasRows() { return DATA.transactions.length > 0; }

  function view() {
    return H.buildView(DATA.transactions, {
      mode: state.mode,
      anchor: state.anchor || state.today || H.seoulYm(),
      largeWon: H.LARGE_WON
    });
  }

  function moneyLabel(tx) {
    if (tx.kind === 'carry') return tx.balance == null ? '이월' : '잔액 ' + H.won(tx.balance);
    if (tx.kind === 'income' || tx.kind === 'refund') return '+' + H.won(Math.abs(tx.amount));
    return '−' + H.won(Math.abs(tx.amount));
  }

  function shortDate(ymd) {
    const p = String(ymd || '').split('-');
    if (p.length < 3) return ymd || '';
    return Number(p[1]) + '월 ' + Number(p[2]) + '일';
  }

  function amtClass(tx) {
    if (tx.kind === 'income' || tx.kind === 'refund') return 'in';
    if (tx.kind === 'carry') return 'carry';
    return 'out';
  }

  function txItem(tx) {
    const bits = [tx.category, tx.memo].filter(Boolean).join(' · ');
    return '<li class="tx"><div><div class="tx-title">' + esc(tx.content || '이월') + '</div><div class="tx-meta">' +
      esc(shortDate(tx.ymd) + (bits ? ' · ' + bits : '')) + '</div></div><div class="tx-amt ' + amtClass(tx) + '">' +
      esc(moneyLabel(tx)) + '</div></li>';
  }

  function barButton(row, max, color) {
    const width = max > 0 ? Math.max(4, Math.round(row.amount / max * 100)) : 0;
    return '<button type="button" class="bar-btn" data-action="drill" data-cat="' + esc(row.name) + '">' +
      '<span class="bar-top"><span>' + esc(row.name) + '</span><strong>' + esc(H.won(row.amount)) + '</strong></span>' +
      '<span class="track"><span class="fill" style="width:' + width + '%;background:' + color + '"></span></span></button>';
  }

  function columnChart(series, picked) {
    let max = 1;
    series.forEach(function (s) { max = Math.max(max, s.expense, s.income); });
    return '<div class="hscroll"><div class="cols">' + series.map(function (s) {
      const eh = s.expense > 0 ? Math.max(4, Math.round(s.expense / max * 120)) : 0;
      const ih = s.income > 0 ? Math.max(4, Math.round(s.income / max * 120)) : 0;
      const on = s.ym === picked ? ' on' : '';
      const month = Number(s.ym.slice(5)) + '월';
      return '<button type="button" class="col' + on + '" data-action="pick" data-ym="' + esc(s.ym) + '" aria-label="' + esc(H.koYm(s.ym)) + '">' +
        '<span class="col-plot"><span class="col-bar in" style="height:' + ih + 'px"></span><span class="col-bar out" style="height:' + eh + 'px"></span></span>' +
        '<span class="col-lab">' + esc(month) + '</span></button>';
    }).join('') + '</div></div>';
  }

  function yearColumns(years) {
    const months = years.months.filter(function (m) { return m.month <= years.throughMonth; });
    let max = 1;
    months.forEach(function (m) { max = Math.max(max, m.expense, m.prevExpense); });
    return '<div class="hscroll"><div class="cols">' + months.map(function (m) {
      const eh = m.expense > 0 ? Math.max(4, Math.round(m.expense / max * 120)) : 0;
      const oh = m.prevExpense > 0 ? Math.max(4, Math.round(m.prevExpense / max * 120)) : 0;
      return '<div class="col"><div class="col-plot"><span class="col-bar old" style="height:' + oh + 'px"></span><span class="col-bar out" style="height:' + eh + 'px"></span></div><span class="col-lab">' + m.month + '월</span></div>';
    }).join('') + '</div></div>';
  }

  function nextBlocked() {
    if (!state.anchor || !state.today) return true;
    if (state.mode === 'year') return Number(state.anchor.slice(0, 4)) >= Number(state.today.slice(0, 4));
    return state.anchor >= state.today;
  }

  function chipOn(mode) {
    if (mode === 'month') return state.mode === 'month' && state.anchor === state.today ? ' on' : '';
    if (mode === 'prev') return state.mode === 'month' && state.anchor === H.addMonths(state.today, -1) ? ' on' : '';
    if (mode === '3') return state.mode === '3' ? ' on' : '';
    if (mode === 'year') return state.mode === 'year' ? ' on' : '';
    return '';
  }

  function renderPeriod(v) {
    const box = $('period');
    if (!box) return;
    if (!hasRows()) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="stepper">' +
        '<button type="button" class="step" data-action="step" data-step="-1" aria-label="이전 기간">‹</button>' +
        '<p class="step-label">' + esc(v.label) + '</p>' +
        '<button type="button" class="step" data-action="step" data-step="1" aria-label="다음 기간"' + (nextBlocked() ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      '<div class="chips">' +
        '<button type="button" class="chip' + chipOn('month') + '" data-action="mode" data-mode="month">이번 달</button>' +
        '<button type="button" class="chip' + chipOn('prev') + '" data-action="mode" data-mode="prev">지난달</button>' +
        '<button type="button" class="chip' + chipOn('3') + '" data-action="mode" data-mode="3">3개월</button>' +
        '<button type="button" class="chip' + chipOn('year') + '" data-action="mode" data-mode="year">올해</button>' +
      '</div>';
  }

  function renderBanner() {
    const box = $('banner');
    if (!box) return;
    const parts = [];
    if (DATA.banner) parts.push(DATA.banner);
    if (DATA.skipNote) parts.push(DATA.skipNote);
    if (DATA.mapNote) parts.push(DATA.mapNote);
    if (!parts.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.className = 'banner ' + (DATA.bannerKind || 'info');
    box.innerHTML = parts.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
  }

  function renderSummary(v) {
    const tone = v.cur.expense === v.prev.expense ? 'flat' : (v.expenseUp ? 'up' : 'down');
    const cats = v.categories.slice(0, 4);
    const max = cats.length ? cats[0].amount : 0;
    let large = '';
    if (v.large.length) {
      large = '<section class="card alert"><h2>큰 지출 ' + v.large.length + '건</h2><p class="note">한 건에 ' + esc(H.won(H.LARGE_WON)) + ' 이상</p><ul class="tx-list">' +
        v.large.slice(0, 3).map(txItem).join('') + '</ul>' +
        '<button type="button" class="text-btn more" data-action="tab" data-tab="watch">모두 보기</button></section>';
    }
    return '<section class="hero"><p class="kicker">지출</p><p class="hero-num">' + esc(H.won(v.cur.expense)) + '</p>' +
      '<p class="delta ' + tone + '">' + esc(v.expenseSentence) + '</p>' +
      '<p class="sub">' + esc(v.incomeSentence) + '</p>' +
      '<ul class="stat-list">' +
        '<li><span>수입</span><strong>' + esc(H.won(v.cur.income)) + '</strong></li>' +
        '<li><span>수입 − 지출</span><strong>' + esc(H.won(v.cur.net)) + '</strong></li>' +
        (v.balance == null ? '' : '<li><span>최근 잔액</span><strong>' + esc(H.won(v.balance)) + '</strong></li>') +
        '<li><span>지출 건수</span><strong>' + v.cur.countOut + '건</strong></li>' +
      '</ul></section>' +
      (cats.length ? '<h2>많이 쓴 분류</h2>' + cats.map(function (row, i) {
        return barButton(row, max, Charts.COLORS[i % Charts.COLORS.length]);
      }).join('') : '<p class="empty">이 기간에 지출이 없어요.</p>') +
      large +
      '<p class="note foot-note">여기서는 고치지 않아요. 수정은 구글 시트에서 합니다.</p>';
  }

  function renderCategory(v) {
    if (state.drill) {
      const rows = H.filterTransactions(DATA.transactions, {
        from: v.range.from, to: v.range.to, category: state.drill
      });
      const shown = rows.slice(0, state.limit);
      const sum = rows.reduce(function (s, tx) {
        if (tx.kind === 'carry') return s;
        return s + tx.amount;
      }, 0);
      return '<button type="button" class="back" data-action="back">분류 전체</button>' +
        '<h2>' + esc(state.drill) + '</h2>' +
        '<p class="sub">' + rows.length + '건 · ' + esc(H.won(sum)) + '</p>' +
        (shown.length ? '<ul class="tx-list card">' + shown.map(txItem).join('') + '</ul>' : '<p class="empty">이 기간에 이 분류 거래가 없어요.</p>') +
        (rows.length > shown.length ? '<button type="button" class="text-btn more" data-action="more">더 보기</button>' : '');
    }
    if (!v.categories.length) {
      return '<h2>분류별 지출</h2><p class="empty">이 기간에 지출이 없어요.</p>';
    }
    const max = v.categories[0].amount;
    const income = v.incomes.length
      ? '<h3>들어온 돈</h3><ul class="stat-list card">' + v.incomes.map(function (row) {
        return '<li><span>' + esc(row.name) + '</span><strong>' + esc(H.won(row.amount)) + '</strong></li>';
      }).join('') + '</ul>'
      : '';
    return '<h2>분류별 지출</h2><p class="sub">' + esc(v.label) + ' · ' + esc(H.won(v.cur.expense)) + '</p>' +
      '<div class="donut-wrap">' + Charts.donut(v.categories) + '</div>' +
      '<p class="note">분류를 누르면 그 거래만 봅니다.</p>' +
      v.categories.map(function (row, i) {
        return barButton(row, max, Charts.COLORS[i % Charts.COLORS.length]);
      }).join('') + income;
  }

  function renderTx(v) {
    const names = {};
    DATA.transactions.forEach(function (tx) {
      if (tx.ym >= v.range.from && tx.ym <= v.range.to && tx.kind !== 'carry') names[tx.category] = true;
    });
    const options = Object.keys(names).sort().map(function (name) {
      return '<option value="' + esc(name) + '"' + (name === state.catFilter ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
    const dirs = ['all', 'expense', 'income', 'carry'];
    const dirLabel = { all: '전체', expense: '지출', income: '수입', carry: '이월' };
    return '<h2>거래 내역</h2>' +
      '<form class="search" id="searchForm">' +
        '<label for="q">검색</label>' +
        '<input id="q" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(state.q) + '" placeholder="내용, 분류, 메모">' +
        '<label for="catFilter">분류</label>' +
        '<select id="catFilter"><option value="">모든 분류</option>' + options + '</select>' +
      '</form>' +
      '<div class="dirs">' + dirs.map(function (d) {
        return '<button type="button" class="dir' + (state.dir === d ? ' on' : '') + '" data-action="dir" data-dir="' + d + '">' + dirLabel[d] + '</button>';
      }).join('') + '</div>' +
      '<div id="txList">' + txResultHtml(v) + '</div>';
  }

  function txResultHtml(v) {
    const rows = H.filterTransactions(DATA.transactions, {
      from: v.range.from,
      to: v.range.to,
      q: state.q,
      dir: state.dir,
      category: state.catFilter
    });
    const shown = rows.slice(0, state.limit);
    return '<p class="sub">' + rows.length + '건</p>' +
      (shown.length ? '<ul class="tx-list">' + shown.map(txItem).join('') + '</ul>' : '<p class="empty">찾는 거래가 없어요.</p>') +
      (rows.length > shown.length ? '<button type="button" class="text-btn more" data-action="more">더 보기</button>' : '');
  }

  function renderTrend(v) {
    const picked = (state.chartYm && v.series.some(function (s) { return s.ym === state.chartYm; }))
      ? state.chartYm : state.anchor;
    const point = v.series.filter(function (s) { return s.ym === picked; })[0] || { income: 0, expense: 0, ym: picked };
    const sumOut = v.series.reduce(function (s, row) { return s + row.expense; }, 0);
    const sumIn = v.series.reduce(function (s, row) { return s + row.income; }, 0);
    const y = v.years;
    const diff = y.curYtd.expense - y.prevYtd.expense;
    const yearLine = diff === 0
      ? '지난해 같은 기간과 지출이 같아요'
      : (diff > 0 ? '지난해 같은 기간보다 지출이 ' + H.won(diff) + ' 많아요' : '지난해 같은 기간보다 지출이 ' + H.won(Math.abs(diff)) + ' 적어요');
    return '<h2>월별 추이</h2>' +
      '<p class="sub">막대를 누르면 그 달 금액이 바뀝니다. 최근 12개월입니다.</p>' +
      '<section class="card"><p class="kicker">' + esc(H.koYm(point.ym)) + '</p>' +
        '<p class="hero-num">' + esc(H.won(point.expense)) + '</p>' +
        '<p class="sub">수입 ' + esc(H.won(point.income)) + '</p></section>' +
      '<p class="legend"><span><i class="swatch in"></i>수입</span><span><i class="swatch out"></i>지출</span></p>' +
      columnChart(v.series, picked) +
      '<p class="note">12개월 지출 ' + esc(H.won(sumOut)) + ' · 수입 ' + esc(H.won(sumIn)) + '</p>' +
      '<h2>연간 비교</h2>' +
      '<section class="card"><p>' + y.year + '년 1–' + y.throughMonth + '월 지출 ' + esc(H.won(y.curYtd.expense)) + '</p>' +
        '<p>' + (y.year - 1) + '년 같은 기간 지출 ' + esc(H.won(y.prevYtd.expense)) + '</p>' +
        '<p class="delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat') + '">' + esc(yearLine) + '</p>' +
        '<p class="sub">수입은 ' + esc(H.won(y.curYtd.income)) + ' / 지난해 ' + esc(H.won(y.prevYtd.income)) + '</p></section>' +
      '<p class="legend"><span><i class="swatch old"></i>지난해</span><span><i class="swatch out"></i>올해</span></p>' +
      yearColumns(y);
  }

  function renderWatch(v) {
    const large = v.large.length
      ? '<ul class="tx-list">' + v.large.map(txItem).join('') + '</ul>'
      : '<p class="empty">이 기간에 ' + esc(H.won(H.LARGE_WON)) + ' 이상 쓴 건이 없어요.</p>';
    const fixed = v.fixed.length
      ? '<ul class="tx-list">' + v.fixed.map(function (row) {
        return '<li class="tx"><div><div class="tx-title">' + esc(row.content) + '</div><div class="tx-meta">' +
          esc(row.category) + ' · ' + row.months + '개월 · 최근 ' + esc(H.koYm(row.lastYm)) +
          '</div></div><div class="tx-amt out">매달 ' + esc(H.won(row.amount)) + '</div></li>';
      }).join('') + '</ul>'
      : '<p class="empty">반복되는 고정지출을 아직 못 찾았어요.</p>';
    return '<h2>큰 지출</h2><p class="note">한 건에 ' + esc(H.won(H.LARGE_WON)) + ' 이상인 지출입니다. 지금 선택한 기간만 봅니다.</p>' + large +
      '<h2>고정지출</h2><p class="note">같은 내용이 세 달 이상, 한 달에 한 번 정도, 비슷한 금액이면 고정으로 봅니다. 기간과 상관없이 시트 전체를 봅니다.</p>' + fixed;
  }

  function renderConnect() {
    return '<section class="hero setup"><p class="kicker">조회 전용</p><h2>시트를 연결해 주세요</h2>' +
      '<p>가계부는 구글 시트에 적고, 이 화면은 그 내용을 보여 주기만 합니다.</p>' +
      '<ol><li>가계부 탭에 년도, 월, 날짜, 내용, 분류, 사용금액, 잔액, 메모 머리글을 둡니다.</li>' +
      '<li>시트를 ‘링크가 있는 사람 보기’로 공유합니다.</li>' +
      '<li>이 앱 주소 뒤에 #k=시트번호를 붙여 엽니다. 시트 번호는 시트 주소에서 /d/ 와 /edit 사이입니다.</li></ol>' +
      '<a class="btn" href="?demo=1">예시 가계부 보기</a></section>';
  }

  function renderMessage(text) {
    return '<section class="hero"><h2>가계부</h2><p>' + esc(text) + '</p></section>';
  }

  function render() {
    const qEl = $('q');
    const keepQ = qEl && document.activeElement === qEl;
    const sel = keepQ ? [qEl.selectionStart, qEl.selectionEnd] : null;
    renderBanner();
    document.querySelectorAll('.tabbar [data-tab]').forEach(function (btn) {
      const on = btn.dataset.tab === state.tab;
      btn.classList.toggle('on', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    const gate = !DATA.source && !booting;
    document.body.classList.toggle('gate', gate || (booting && !hasRows() && !DATA.error));
    const main = $('main');
    if (booting && !hasRows() && !DATA.error) {
      $('period').innerHTML = '';
      main.innerHTML = '<div class="boot"><div class="spin"></div><p>시트를 불러오는 중</p></div>';
      return;
    }
    if (!hasRows()) {
      $('period').innerHTML = '';
      if (!DATA.source) main.innerHTML = renderConnect();
      else main.innerHTML = renderMessage((DATA.error && DATA.error.message) || H.MESSAGES.empty);
      document.body.classList.toggle('gate', !DATA.source);
      return;
    }
    document.body.classList.remove('gate');
    const v = view();
    renderPeriod(v);
    let html = '';
    if (state.tab === 'summary') html = renderSummary(v);
    else if (state.tab === 'category') html = renderCategory(v);
    else if (state.tab === 'tx') html = renderTx(v);
    else if (state.tab === 'trend') html = renderTrend(v);
    else html = renderWatch(v);
    main.innerHTML = html;
    if (keepQ) {
      const again = $('q');
      if (again) {
        again.focus();
        if (sel[0] != null) again.setSelectionRange(sel[0], sel[1]);
      }
    }
  }

  function step(delta) {
    if (!state.anchor) return;
    if (state.mode === 'year') {
      const y = Number(state.anchor.slice(0, 4)) + delta;
      const todayY = Number(state.today.slice(0, 4));
      if (y > todayY) return;
      let m = state.anchor.slice(5, 7);
      if (y === todayY && m > state.today.slice(5, 7)) m = state.today.slice(5, 7);
      state.anchor = y + '-' + m;
    } else {
      const next = H.addMonths(state.anchor, delta);
      if (next > state.today) return;
      state.anchor = next;
    }
    state.limit = 40;
    state.chartYm = '';
    render();
  }

  function setMode(mode) {
    if (mode === 'prev') {
      state.mode = 'month';
      state.anchor = H.addMonths(state.today, -1);
    } else if (mode === 'month') {
      state.mode = 'month';
      state.anchor = state.today;
    } else if (mode === '3') {
      state.mode = '3';
      state.anchor = state.today;
    } else if (mode === 'year') {
      state.mode = 'year';
      state.anchor = state.today;
    }
    state.limit = 40;
    state.chartYm = '';
    render();
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = el.dataset.action;
    if (action === 'tab') {
      state.tab = el.dataset.tab;
      state.drill = '';
      state.limit = 40;
      render();
    } else if (action === 'mode') setMode(el.dataset.mode);
    else if (action === 'step') step(Number(el.dataset.step));
    else if (action === 'drill') {
      state.tab = 'category';
      state.drill = el.dataset.cat || '';
      state.limit = 40;
      render();
    } else if (action === 'back') {
      state.drill = '';
      render();
    } else if (action === 'dir') {
      state.dir = el.dataset.dir;
      state.limit = 40;
      render();
    } else if (action === 'more') {
      state.limit += 40;
      render();
    } else if (action === 'pick') {
      state.chartYm = el.dataset.ym || '';
      render();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    state.q = e.target.value;
    state.limit = 40;
    const box = $('txList');
    if (box && state.tab === 'tx' && hasRows()) {
      box.innerHTML = txResultHtml(view());
      return;
    }
    render();
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'catFilter') return;
    state.catFilter = e.target.value;
    state.limit = 40;
    render();
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'searchForm') e.preventDefault();
  });

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function csvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(rows) {
    return (rows || []).map(function (row) { return row.map(csvCell).join(','); }).join('\n');
  }

  function gvizTableRows(resp) {
    const table = resp.table;
    const nc = table.cols.length;
    return (table.rows || []).map(function (r) {
      const out = [];
      for (let i = 0; i < nc; i++) {
        const c = (r.c || [])[i];
        if (c == null) out.push('');
        else if (c.f != null && String(c.f) !== '') out.push(String(c.f));
        else out.push(c.v == null ? '' : String(c.v));
      }
      return out;
    });
  }

  async function fetchText(url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(H.MESSAGES.loadFail);
      const text = await res.text();
      if (!text || /^\s*<(!doctype|html)/i.test(text)) throw new Error(H.MESSAGES.loadFail);
      return text;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('시트가 응답하지 않았어요. 잠시 후 다시 눌러 주세요.');
      throw e;
    } finally { clearTimeout(tm); }
  }

  function fetchGviz(name) {
    return new Promise(function (resolve, reject) {
      const cb = '__coupleLedgerCb' + (++gvizSeq) + '_' + Date.now();
      const sc = document.createElement('script');
      let settled = false;
      const finish = function (fn) {
        if (settled) return;
        settled = true;
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        sc.remove();
        clearTimeout(tm);
        fn();
      };
      const tm = setTimeout(function () {
        finish(function () { reject(new Error('시트가 응답하지 않았어요. 잠시 후 다시 눌러 주세요.')); });
      }, 8000);
      window[cb] = function (resp) {
        finish(function () {
          if (!resp || resp.status === 'error' || !resp.table) reject(new Error(H.MESSAGES.loadFail));
          else resolve(rowsToCsv(gvizTableRows(resp)));
        });
      };
      sc.onerror = function () { finish(function () { reject(new Error(H.MESSAGES.loadFail)); }); };
      sc.src = 'https://docs.google.com/spreadsheets/d/' + sheetId +
        '/gviz/tq?tqx=out:json;responseHandler:' + cb + '&headers=0&sheet=' +
        encodeURIComponent(name) + '&t=' + Date.now();
      document.head.appendChild(sc);
    });
  }

  async function loadNamedOnce(name) {
    const csvUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(name) + '&t=' + Date.now();
    try { return await fetchText(csvUrl); }
    catch (e) { return fetchGviz(name); }
  }

  async function loadNamed(name) {
    let last;
    const waits = [0, 400, 900];
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await delay(waits[i]);
      try { return await loadNamedOnce(name); }
      catch (e) { last = e; }
    }
    throw last;
  }

  async function loadLedgerText() {
    try {
      return await loadNamed(LEDGER_TAB);
    } catch (err) {
      try {
        const text = await fetchText('https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv&t=' + Date.now());
        const probe = H.loadFromTexts(text, '');
        if (!probe.error || probe.error.code === 'empty') return text;
      } catch (e2) {}
      throw err;
    }
  }

  async function loadCategoryText() {
    for (let i = 0; i < CATEGORY_TABS.length; i++) {
      try { return await loadNamed(CATEGORY_TABS[i]); }
      catch (e) { /* 다음 이름 */ }
    }
    return '';
  }

  function showParsed(parsed, source) {
    applyParsed(parsed, source);
  }

  async function syncFromSheet() {
    if (DEMO) { await bootDemo(); return; }
    if (!sheetId) {
      DATA.banner = H.MESSAGES.noSheet;
      DATA.bannerKind = 'err';
      render();
      return;
    }
    syncing = true;
    const btn = $('syncBtn');
    if (btn) { btn.disabled = true; btn.textContent = '불러오는 중'; }
    setStatus('구글 시트에서 불러오는 중');
    const had = hasRows();
    try {
      const ledgerText = await loadLedgerText();
      const categoryText = await loadCategoryText();
      const parsed = H.loadFromTexts(ledgerText, categoryText);
      const now = new Date();
      const viewFail = parsed.error ? H.syncFailureView(parsed.error, had, DATA.hhmm) : null;
      if (viewFail && viewFail.keepCache) {
        DATA.banner = viewFail.banner;
        DATA.bannerKind = 'err';
        setStatus('머리글 확인');
      } else if (parsed.error && parsed.error.code === 'empty') {
        showParsed(parsed, 'sheet', hhmm(now));
        writeCache(ledgerText, categoryText, hhmm(now));
        DATA.hhmm = hhmm(now);
        setStatus('시트 ' + stamp(now));
      } else if (parsed.error) {
        const fail = H.syncFailureView(parsed.error, had, DATA.hhmm);
        if (!had) {
          DATA.source = 'sheet';
          DATA.error = parsed.error;
          DATA.transactions = [];
          DATA.banner = fail.banner;
          DATA.bannerKind = 'err';
        } else {
          DATA.banner = fail.banner;
          DATA.bannerKind = fail.kind === 'stale' ? 'warn' : 'err';
        }
        setStatus('시트를 불러오지 못했어요');
      } else {
        showParsed(parsed, 'sheet', hhmm(now));
        writeCache(ledgerText, categoryText, hhmm(now));
        DATA.hhmm = hhmm(now);
        DATA.banner = '';
        setStatus('시트 ' + stamp(now));
      }
    } catch (err) {
      const fail = H.syncFailureView(err, had, DATA.hhmm);
      if (!had) {
        DATA.source = 'sheet';
        DATA.transactions = [];
        DATA.error = err;
        DATA.banner = fail.banner;
        DATA.bannerKind = 'err';
      } else {
        DATA.banner = fail.banner;
        DATA.bannerKind = 'warn';
      }
      setStatus(had ? '저장본 ' + (DATA.hhmm || '') : '시트를 불러오지 못했어요');
    } finally {
      syncing = false;
      booting = false;
      if (btn) { btn.disabled = false; btn.textContent = '새로고침'; }
      render();
    }
  }

  async function bootDemo() {
    const file = {
      shuffled: 'sample_ledger_shuffled.csv',
      empty: 'sample_ledger_empty.csv',
      noheader: 'sample_ledger_noheader.csv'
    }[FIXTURE] || 'sample_ledger.csv';
    const btn = $('syncBtn');
    if (btn) btn.disabled = true;
    setStatus('예시를 읽는 중');
    try {
      const ledgerText = await fetch(file).then(function (r) {
        if (!r.ok) throw new Error('예시 파일을 열지 못했어요');
        return r.text();
      });
      let categoryText = '';
      if (!FIXTURE || FIXTURE === 'shuffled') {
        const catRes = await fetch('sample_categories.csv');
        if (catRes.ok) categoryText = await catRes.text();
      }
      const parsed = H.loadFromTexts(ledgerText, categoryText);
      showParsed(parsed, 'demo', '');
      if (parsed.error) setStatus('예시');
      else setStatus('예시 · ' + parsed.transactions.length + '건');
    } catch (err) {
      DATA.source = 'demo';
      DATA.banner = err.message || '예시 파일을 열지 못했어요';
      DATA.bannerKind = 'err';
      setStatus('예시');
    } finally {
      booting = false;
      if (btn) { btn.disabled = false; btn.textContent = '새로고침'; }
      render();
    }
  }

  function bootCache() {
    const cache = readCache();
    if (!cache) return false;
    const parsed = H.loadFromTexts(cache.ledgerText, cache.categoryText);
    if (parsed.error && parsed.error.code !== 'empty') return false;
    showParsed(parsed, 'cache', '', 'info');
    DATA.hhmm = cache.hhmm || '';
    setStatus(cache.hhmm ? '저장본 ' + cache.hhmm : '저장본');
    return true;
  }

  $('syncBtn').addEventListener('click', function () {
    if (syncing) return;
    if (DEMO) bootDemo();
    else syncFromSheet();
  });

  render();
  if (DEMO) bootDemo();
  else if (!sheetId) {
    booting = false;
    const cached = bootCache();
    if (cached) {
      DATA.banner = '저장된 내용입니다. 시트 번호가 있는 주소로 열면 최신으로 바꿉니다.';
      DATA.bannerKind = 'info';
    }
    setStatus(cached ? '저장본' : '');
    const btn = $('syncBtn');
    if (btn && !cached) btn.hidden = true;
    render();
  } else {
    bootCache();
    render();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !syncing) syncFromSheet();
    });
    syncFromSheet();
  }
})();
