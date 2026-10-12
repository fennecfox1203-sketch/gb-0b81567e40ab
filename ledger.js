/* 가계부 계산. 브라우저와 시험이 같이 쓴다. 화면 없음. */
(function (root) {
  'use strict';

  const LARGE_WON = 100000;

  const FIELDS = {
    year: ['년도', '연도'],
    month: ['월'],
    day: ['날짜', '일자', '거래일', '거래날짜'],
    content: ['내용', '적요', '거래내용', '항목'],
    category: ['분류', '카테고리', '분류명'],
    amount: ['사용금액', '금액', '사용액', '거래금액'],
    balance: ['잔액', '통장잔액', '잔고'],
    memo: ['메모', '비고', '참고']
  };

  const FIELD_ORDER = ['amount', 'content', 'category', 'day', 'year', 'month', 'balance', 'memo'];

  const INCOME_KEYS = ['급여', '월급', '상여', '보너스', '수입', '이자', '환급', '용돈', '부수입', '연금', '배당'];

  const MESSAGES = {
    missingHeader: '가계부 시트에서 머리글을 찾지 못했어요. 내용, 사용금액, 그리고 날짜(또는 년도와 월) 열 이름을 확인해 주세요.',
    empty: '거래가 아직 없어요. 머리글 다음 행부터 적으면 여기에 나타납니다.',
    noSheet: '가계부 주소가 필요해요. 받은 링크 전체(#k= 뒤의 시트 번호까지)로 다시 열어 주세요.',
    loadFail: '시트를 불러오지 못했어요. ‘링크가 있는 사람 보기’로 공유돼 있는지 확인해 주세요.',
    categoryMiss: '분류 대응표는 읽지 못했어요. 가계부 시트의 분류 열만 사용합니다.',
    noDate: '날짜를 읽은 거래가 없어요. 년도, 월, 날짜 열을 확인해 주세요.'
  };

  function skippedMessage(n) {
    return '날짜를 읽지 못한 ' + n + '행은 건너뛰었습니다.';
  }

  function staleMessage(hhmm) {
    const when = hhmm ? hhmm + '에 저장해 둔' : '이전에 저장해 둔';
    return '시트를 지금 불러오지 못했어요. ' + when + ' 내용을 보여 드리고 있어요.';
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function headerKey(v) {
    return String(v == null ? '' : v)
      .trim()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[*＊:：;；.．·・()（）\[\]【】"'“”「」]/g, '')
      .toLowerCase();
  }

  function normKey(v) {
    return String(v == null ? '' : v).trim().replace(/\s+/g, '').toLowerCase();
  }

  function won(n) {
    const v = Math.round(Number(n) || 0);
    const sign = v < 0 ? '-' : '';
    const body = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + body + '원';
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function indexOfHeader(header, name) {
    const want = headerKey(name);
    const h = header || [];
    for (let i = 0; i < h.length; i++) {
      if (headerKey(h[i]) === want) return i;
    }
    return -1;
  }

  function resolveCols(header) {
    const used = new Set();
    const cols = {};
    FIELD_ORDER.forEach(function (key) {
      cols[key] = -1;
      const names = FIELDS[key];
      for (let n = 0; n < names.length; n++) {
        const idx = indexOfHeader(header, names[n]);
        if (idx >= 0 && !used.has(idx)) {
          cols[key] = idx;
          used.add(idx);
          break;
        }
      }
      /* 제목이 년도 칸에 붙는 경우. 예: ‘치치와 코코의 가계부 년도’ */
      if (key === 'year' && cols.year < 0) {
        const h = header || [];
        for (let i = 0; i < h.length; i++) {
          if (used.has(i)) continue;
          const k = headerKey(h[i]);
          if (k.endsWith('년도') || k.endsWith('연도')) {
            cols.year = i;
            used.add(i);
            break;
          }
        }
      }
    });
    return cols;
  }

  function headerScore(header) {
    const cols = resolveCols(header);
    if (cols.content < 0 || cols.amount < 0) return -1;
    if (cols.day < 0 && (cols.year < 0 || cols.month < 0)) return -1;
    let score = 2;
    ['year', 'month', 'day', 'category', 'balance', 'memo'].forEach(function (key) {
      if (cols[key] >= 0) score += 1;
    });
    return score;
  }

  function findHeader(rows) {
    let best = -1;
    let bestScore = -1;
    const limit = Math.min((rows || []).length, 40);
    for (let i = 0; i < limit; i++) {
      const score = headerScore(rows[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    return { index: best, cols: resolveCols(rows[best]), score: bestScore };
  }

  function cell(row, idx) {
    if (idx < 0 || !row || idx >= row.length) return '';
    return row[idx];
  }

  function parseAmount(v) {
    let t = String(v == null ? '' : v).trim().replace(/[₩원,\s\u00a0，]/g, '');
    if (t === '' || t === '-' || t === '+') return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t.charAt(0) === '+') t = t.slice(1);
    const n = Number(t);
    if (!isFinite(n)) return null;
    return neg ? -Math.round(n) : Math.round(n);
  }

  function ymd(y, m, d) {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function parseFullDate(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return '';
    let m = /^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})/.exec(t);
    if (m) return ymd(Number(m[1]), Number(m[2]) + 1, Number(m[3]));
    m = /(20\d{2}|19\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/.exec(t);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    return '';
  }

  function parseYear(v) {
    const m = /(20\d{2}|19\d{2})/.exec(String(v == null ? '' : v));
    return m ? Number(m[1]) : 0;
  }

  function parseMonth(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return 0;
    const simple = /^(\d{1,2})\s*월?$/.exec(t);
    if (simple) {
      const n = Number(simple[1]);
      return n >= 1 && n <= 12 ? n : 0;
    }
    const full = parseFullDate(t);
    return full ? Number(full.slice(5, 7)) : 0;
  }

  function parseDayNumber(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return 0;
    const simple = /^(\d{1,2})\s*일?$/.exec(t);
    if (!simple) return 0;
    const n = Number(simple[1]);
    return n >= 1 && n <= 31 ? n : 0;
  }

  /* 7/1, 9/30, 7월 1일. 연도는 없다. */
  function parseMonthDay(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return null;
    let m = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})$/.exec(t);
    if (!m) m = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(t);
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month: month, day: day };
  }

  function composeYmd(yearCell, monthCell, dayCell, hasDayCol) {
    const full = parseFullDate(dayCell) || parseFullDate(yearCell);
    if (full) return full;
    const y = parseYear(yearCell) || parseYear(dayCell) || parseYear(monthCell);
    /* 날짜 칸의 월/일이 월 칸보다 우선이다. 둘이 달라도 날짜 칸을 쓴다. */
    const md = parseMonthDay(dayCell);
    if (y && md) return ymd(y, md.month, md.day);
    const m = parseMonth(monthCell);
    const d = parseDayNumber(dayCell);
    if (y && m && d) return ymd(y, m, d);
    if (y && m && !hasDayCol) return ymd(y, m, 1);
    return '';
  }

  function isBlankCategory(v) {
    const k = headerKey(v);
    return !k || k === '미분류' || k === '-' || k === '없음' || k === 'null';
  }

  function isCarry(content, category) {
    return headerKey(content).indexOf('이월') >= 0 || headerKey(category).indexOf('이월') >= 0;
  }

  function isIncomeCategory(category) {
    const k = headerKey(category);
    if (!k) return false;
    if (k.indexOf('수입') === 0) return true;
    for (let i = 0; i < INCOME_KEYS.length; i++) {
      const name = headerKey(INCOME_KEYS[i]);
      if (k === name || k.indexOf(name) === 0) return true;
    }
    return false;
  }

  /* 사용금액이 음수면 수입. 양수여도 급여·이자 같은 분류는 수입. */
  function kindOf(content, category, amount) {
    if (isCarry(content, category)) return 'carry';
    if (amount < 0) return 'income';
    if (isIncomeCategory(category)) return 'income';
    return 'expense';
  }

  function looksLikeHeaderRow(row, cols) {
    return headerKey(cell(row, cols.content)) === '내용'
      && headerKey(cell(row, cols.amount)) === headerKey('사용금액');
  }

  function parseLedgerRows(rows) {
    const found = findHeader(rows);
    if (!found) {
      const err = new Error(MESSAGES.missingHeader);
      err.code = 'missing-header';
      return { transactions: [], error: err, headerRow: -1, cols: null };
    }
    const cols = found.cols;
    const transactions = [];
    let undated = 0;
    for (let i = found.index + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (!row.some(function (c) { return String(c || '').trim() !== ''; })) continue;
      if (looksLikeHeaderRow(row, cols)) continue;
      const content = String(cell(row, cols.content) || '').trim();
      const categoryRaw = String(cell(row, cols.category) || '').trim();
      const memo = String(cell(row, cols.memo) || '').trim();
      const amount = parseAmount(cell(row, cols.amount));
      const carry = isCarry(content, categoryRaw);
      if (!carry && amount == null) continue;
      if (!carry && !content) continue;
      const date = composeYmd(
        cell(row, cols.year),
        cell(row, cols.month),
        cell(row, cols.day),
        cols.day >= 0
      );
      if (!date) {
        if (content || carry || amount != null) undated += 1;
        continue;
      }
      const signed = amount == null ? 0 : amount;
      const category = isBlankCategory(categoryRaw) ? '' : categoryRaw;
      transactions.push({
        ymd: date,
        ym: date.slice(0, 7),
        content: content,
        category: category,
        categorySource: category ? 'sheet' : 'none',
        amount: signed,
        balance: parseAmount(cell(row, cols.balance)),
        memo: memo,
        kind: kindOf(content, category || categoryRaw, signed),
        row: i + 1
      });
    }
    if (!transactions.length) {
      const err = new Error(undated ? MESSAGES.noDate : MESSAGES.empty);
      err.code = undated ? 'no-date' : 'empty';
      err.skipped = undated;
      return { transactions: [], error: err, headerRow: found.index, cols: cols, skipped: undated, skipNote: '' };
    }
    return {
      transactions: transactions,
      error: null,
      headerRow: found.index,
      cols: cols,
      skipped: undated,
      skipNote: undated ? skippedMessage(undated) : ''
    };
  }

  function parseCategoryRows(rows) {
    const list = rows || [];
    let headerAt = -1;
    let contentCol = -1;
    let categoryCol = -1;
    const limit = Math.min(list.length, 20);
    for (let i = 0; i < limit; i++) {
      const cols = resolveCols(list[i]);
      if (cols.content >= 0 && cols.category >= 0) {
        headerAt = i;
        contentCol = cols.content;
        categoryCol = cols.category;
        break;
      }
    }
    if (headerAt < 0) {
      const err = new Error(MESSAGES.categoryMiss);
      err.code = 'category-miss';
      return { entries: [], error: err };
    }
    const entries = [];
    for (let i = headerAt + 1; i < list.length; i++) {
      const row = list[i] || [];
      const content = String(cell(row, contentCol) || '').trim();
      const category = String(cell(row, categoryCol) || '').trim();
      if (!content || isBlankCategory(category)) continue;
      if (headerKey(content) === '내용') continue;
      entries.push({ content: content, category: category });
    }
    return { entries: entries, error: null };
  }

  function applyCategoryMap(transactions, entries) {
    const map = new Map();
    (entries || []).forEach(function (e) {
      map.set(normKey(e.content), e.category);
    });
    return transactions.map(function (tx) {
      if (tx.kind === 'carry' || tx.category) return tx;
      const found = map.get(normKey(tx.content));
      if (!found) return tx;
      const next = Object.assign({}, tx, {
        category: found,
        categorySource: 'map'
      });
      next.kind = kindOf(next.content, next.category, next.amount);
      return next;
    }).map(function (tx) {
      if (tx.category) return tx;
      return Object.assign({}, tx, { category: '미분류' });
    });
  }

  function loadFromTexts(ledgerText, categoryText) {
    const parsed = parseLedgerRows(parseCsv(ledgerText));
    if (parsed.error) {
      return {
        transactions: [],
        error: parsed.error,
        mapNote: '',
        headerRow: parsed.headerRow,
        cols: parsed.cols,
        skipped: parsed.skipped || 0,
        skipNote: ''
      };
    }
    let entries = [];
    let mapNote = '';
    if (categoryText && String(categoryText).trim()) {
      const cat = parseCategoryRows(parseCsv(categoryText));
      if (cat.error) mapNote = cat.error.message;
      else entries = cat.entries;
    }
    return {
      transactions: applyCategoryMap(parsed.transactions, entries),
      error: null,
      mapNote: mapNote,
      headerRow: parsed.headerRow,
      cols: parsed.cols,
      skipped: parsed.skipped || 0,
      skipNote: parsed.skipNote || ''
    };
  }

  function addMonths(ym, delta) {
    let y = Number(String(ym).slice(0, 4));
    let m = Number(String(ym).slice(5, 7));
    if (!y || !m) return ym;
    m += delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return y + '-' + pad(m);
  }

  function shiftYear(ym, delta) {
    const y = Number(String(ym).slice(0, 4)) + delta;
    return y + '-' + String(ym).slice(5, 7);
  }

  function monthSpan(from, to) {
    let n = 1;
    let ym = from;
    while (ym < to && n < 240) {
      ym = addMonths(ym, 1);
      n += 1;
    }
    return n;
  }

  function periodWindow(mode, anchorYm) {
    if (mode === '3') return { from: addMonths(anchorYm, -2), to: anchorYm };
    if (mode === 'year') return { from: String(anchorYm).slice(0, 4) + '-01', to: anchorYm };
    return { from: anchorYm, to: anchorYm };
  }

  function comparisonWindow(range, mode) {
    if (mode === 'year') {
      return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) };
    }
    const len = monthSpan(range.from, range.to);
    const to = addMonths(range.from, -1);
    return { from: addMonths(to, -(len - 1)), to: to };
  }

  function inRange(tx, from, to) {
    return tx.ym >= from && tx.ym <= to;
  }

  function totals(transactions, from, to) {
    let income = 0;
    let expense = 0;
    let countIn = 0;
    let countOut = 0;
    const byCat = {};
    (transactions || []).forEach(function (tx) {
      if (!inRange(tx, from, to) || tx.kind === 'carry') return;
      if (tx.kind === 'income') {
        income += Math.abs(tx.amount);
        countIn += 1;
        return;
      }
      expense += tx.amount;
      if (tx.kind === 'expense') countOut += 1;
      const name = tx.category || '미분류';
      byCat[name] = (byCat[name] || 0) + tx.amount;
    });
    return {
      income: income,
      expense: expense,
      net: income - expense,
      countIn: countIn,
      countOut: countOut,
      byCat: byCat
    };
  }

  function categoryBreakdown(total) {
    return Object.keys(total.byCat || {}).map(function (name) {
      return { name: name, amount: total.byCat[name] };
    }).filter(function (row) { return row.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount || (a.name < b.name ? -1 : 1); });
  }

  function incomeBreakdown(transactions, from, to) {
    const map = {};
    (transactions || []).forEach(function (tx) {
      if (tx.kind !== 'income' || !inRange(tx, from, to)) return;
      const name = tx.category || '미분류';
      map[name] = (map[name] || 0) + Math.abs(tx.amount);
    });
    return Object.keys(map).map(function (name) {
      return { name: name, amount: map[name] };
    }).sort(function (a, b) { return b.amount - a.amount || (a.name < b.name ? -1 : 1); });
  }

  function monthSeries(transactions, endYm, count) {
    const n = count || 12;
    const start = addMonths(endYm, -(n - 1));
    const out = [];
    for (let ym = start, guard = 0; ym <= endYm && guard < 36; ym = addMonths(ym, 1), guard++) {
      const t = totals(transactions, ym, ym);
      out.push({ ym: ym, income: t.income, expense: t.expense });
    }
    return out;
  }

  function yearCompare(transactions, year, throughMonth) {
    const end = throughMonth >= 1 && throughMonth <= 12 ? throughMonth : 12;
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = year + '-' + pad(m);
      const prev = (year - 1) + '-' + pad(m);
      const cur = totals(transactions, ym, ym);
      const old = totals(transactions, prev, prev);
      months.push({
        month: m,
        expense: cur.expense,
        income: cur.income,
        prevExpense: old.expense,
        prevIncome: old.income
      });
    }
    const from = year + '-01';
    const to = year + '-' + pad(end);
    const curYtd = totals(transactions, from, to);
    const prevYtd = totals(transactions, (year - 1) + '-01', (year - 1) + '-' + pad(end));
    return { year: year, throughMonth: end, months: months, curYtd: curYtd, prevYtd: prevYtd };
  }

  function largeExpenses(transactions, from, to, threshold) {
    const line = threshold == null ? LARGE_WON : threshold;
    const fixedKeys = {};
    fixedExpenses(transactions).forEach(function (row) {
      fixedKeys[normKey(row.content)] = true;
    });
    return (transactions || []).filter(function (tx) {
      return tx.kind === 'expense' && inRange(tx, from, to) && tx.amount >= line && !fixedKeys[normKey(tx.content)];
    }).sort(function (a, b) {
      return b.amount - a.amount || b.ymd.localeCompare(a.ymd);
    });
  }

  function median(nums) {
    const a = nums.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    if (a.length % 2) return a[mid];
    return (a[mid - 1] + a[mid]) / 2;
  }

  function fixedExpenses(transactions) {
    const groups = new Map();
    (transactions || []).forEach(function (tx) {
      if (tx.kind !== 'expense' || tx.amount <= 0) return;
      const key = normKey(tx.content);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx);
    });
    const out = [];
    groups.forEach(function (rows) {
      const months = [];
      const seen = {};
      rows.forEach(function (tx) {
        if (!seen[tx.ym]) { seen[tx.ym] = 0; months.push(tx.ym); }
        seen[tx.ym] += 1;
      });
      if (months.length < 3) return;
      const avg = rows.length / months.length;
      if (avg > 1.25) return;
      const amounts = rows.map(function (tx) { return tx.amount; });
      const mid = median(amounts);
      const max = Math.max.apply(null, amounts);
      const min = Math.min.apply(null, amounts);
      if (!(mid > 0) || (max - min) / mid > 0.15) return;
      const catCount = {};
      rows.forEach(function (tx) {
        const name = tx.category || '미분류';
        catCount[name] = (catCount[name] || 0) + 1;
      });
      let category = rows[0].category;
      let best = -1;
      Object.keys(catCount).forEach(function (name) {
        if (catCount[name] > best) { best = catCount[name]; category = name; }
      });
      months.sort();
      out.push({
        content: rows[rows.length - 1].content,
        category: category,
        amount: Math.round(mid),
        months: months.length,
        lastYm: months[months.length - 1]
      });
    });
    out.sort(function (a, b) { return b.amount - a.amount || (a.content < b.content ? -1 : 1); });
    return out;
  }

  function latestBalance(transactions, toYm) {
    const end = toYm + '-31';
    let best = null;
    (transactions || []).forEach(function (tx) {
      if (!tx.ymd || tx.ymd > end || tx.balance == null) return;
      if (!best || tx.ymd > best.ymd || (tx.ymd === best.ymd && tx.row > best.row)) best = tx;
    });
    return best ? best.balance : null;
  }

  function compareSentence(cur, prev, mode) {
    const diff = cur.expense - prev.expense;
    const base = mode === 'year' ? '지난해 같은 기간보다' : (mode === '3' ? '앞의 3개월보다' : '지난달보다');
    if (!cur.expense && !prev.expense) return '비교할 지출이 없어요';
    if (diff === 0) return base + ' 지출이 같아요';
    const dir = diff > 0 ? '더 썼어요' : '덜 썼어요';
    let pct = '';
    if (prev.expense > 0) pct = ' (' + Math.round(Math.abs(diff) / prev.expense * 100) + '%)';
    return base + ' ' + won(Math.abs(diff)) + ' ' + dir + pct;
  }

  function incomeSentence(cur, prev, mode) {
    const diff = cur.income - prev.income;
    const base = mode === 'year' ? '수입은 지난해 같은 기간보다' : (mode === '3' ? '수입은 앞의 3개월보다' : '수입은 지난달보다');
    if (!cur.income && !prev.income) return '비교할 수입이 없어요';
    if (diff === 0) return base + ' 같아요';
    return base + ' ' + won(Math.abs(diff)) + (diff > 0 ? ' 많아요' : ' 적어요');
  }

  function koYm(ym) {
    if (!ym || String(ym).indexOf('-') < 0) return ym || '';
    const p = String(ym).split('-');
    return p[0] + '년 ' + Number(p[1]) + '월';
  }

  function rangeLabel(range) {
    if (range.from === range.to) return koYm(range.from);
    return koYm(range.from) + ' – ' + koYm(range.to);
  }

  function filterTransactions(transactions, opts) {
    const o = opts || {};
    const query = normKey(o.q || '');
    return (transactions || []).filter(function (tx) {
      if (o.from && tx.ym < o.from) return false;
      if (o.to && tx.ym > o.to) return false;
      if (o.category && tx.category !== o.category) return false;
      if (o.dir === 'expense' && tx.kind !== 'expense' && tx.kind !== 'refund') return false;
      if (o.dir === 'income' && tx.kind !== 'income') return false;
      if (o.dir === 'carry' && tx.kind !== 'carry') return false;
      if (query) {
        const blob = normKey([tx.content, tx.category, tx.memo, tx.amount].join(' '));
        if (blob.indexOf(query) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      return b.ymd.localeCompare(a.ymd) || b.row - a.row;
    });
  }

  function buildView(transactions, opts) {
    const o = opts || {};
    const mode = o.mode || 'month';
    const anchor = o.anchor;
    const range = periodWindow(mode, anchor);
    const compare = comparisonWindow(range, mode);
    const cur = totals(transactions, range.from, range.to);
    const prev = totals(transactions, compare.from, compare.to);
    const through = Number(String(anchor).slice(5, 7));
    const year = Number(String(anchor).slice(0, 4));
    return {
      range: range,
      compare: compare,
      label: rangeLabel(range),
      cur: cur,
      prev: prev,
      categories: categoryBreakdown(cur),
      incomes: incomeBreakdown(transactions, range.from, range.to),
      series: monthSeries(transactions, anchor, 12),
      years: yearCompare(transactions, year, through),
      large: largeExpenses(transactions, range.from, range.to, o.largeWon),
      fixed: fixedExpenses(transactions),
      balance: latestBalance(transactions, range.to),
      expenseSentence: compareSentence(cur, prev, mode),
      incomeSentence: incomeSentence(cur, prev, mode),
      expenseUp: cur.expense > prev.expense
    };
  }

  function seoulYm(date) {
    const d = date || new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit'
      }).formatToParts(d);
      const get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
      return get('year') + '-' + get('month');
    } catch (e) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1);
    }
  }

  function syncFailureView(err, hasCache, hhmm) {
    if (err && (err.code === 'missing-header' || err.code === 'no-date')) {
      return { kind: 'schema', banner: err.message, keepCache: !!hasCache };
    }
    if (err && err.code === 'empty') {
      return { kind: 'empty', banner: err.message, keepCache: false };
    }
    if (hasCache) return { kind: 'stale', banner: staleMessage(hhmm), keepCache: true };
    const banner = err && err.message ? String(err.message) : MESSAGES.loadFail;
    return { kind: 'fail', banner: banner, keepCache: false };
  }

  root.Household = {
    LARGE_WON: LARGE_WON,
    MESSAGES: MESSAGES,
    staleMessage: staleMessage,
    skippedMessage: skippedMessage,
    headerKey: headerKey,
    won: won,
    escHtml: escHtml,
    parseCsv: parseCsv,
    parseAmount: parseAmount,
    resolveCols: resolveCols,
    findHeader: findHeader,
    parseLedgerRows: parseLedgerRows,
    parseCategoryRows: parseCategoryRows,
    loadFromTexts: loadFromTexts,
    addMonths: addMonths,
    periodWindow: periodWindow,
    comparisonWindow: comparisonWindow,
    totals: totals,
    categoryBreakdown: categoryBreakdown,
    monthSeries: monthSeries,
    yearCompare: yearCompare,
    largeExpenses: largeExpenses,
    fixedExpenses: fixedExpenses,
    latestBalance: latestBalance,
    filterTransactions: filterTransactions,
    buildView: buildView,
    seoulYm: seoulYm,
    koYm: koYm,
    rangeLabel: rangeLabel,
    syncFailureView: syncFailureView
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
