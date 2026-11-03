/* 单词大冒险 —— 英语单词学习游戏
 * 纯前端实现，无需构建。进度保存在浏览器 localStorage。
 */
(() => {
  'use strict';

  const STORE_KEY = 'word-quest-v1';
  const DAY = 24 * 60 * 60 * 1000;
  // 莱特纳盒子：答对升级、答错回到 1 级；每级对应的复习间隔（天）
  const INTERVALS = [0, 0, 1, 2, 4, 7, 15];
  const MAX_BOX = INTERVALS.length - 1;
  const MASTER_BOX = 5;
  const QUIZ_TIME = 12000;

  const $app = document.getElementById('app');
  const $stats = document.getElementById('topbar-stats');
  const $toast = document.getElementById('toast');

  /* ======================= 存储 ======================= */
  const defaults = () => ({
    bookId: 'primary',
    xp: 0,
    streak: 0,
    lastStudyDay: null,
    today: { date: null, count: 0, goalDone: false },
    goal: 20,
    sound: true,
    theme: 'auto',
    progress: {},
    custom: [],
    best: {},
    stats: { answered: 0, correct: 0, bestCombo: 0, games: 0, perfect: 0, fastMatch: false, bestBlitz: 0, bestRainLevel: 0, bossWins: 0, bestWhack: 0, bestJudge: 0 },
    achievements: [],
    seenModes: [],
    adventure: {},
  });

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const d = defaults();
        return { ...d, ...data, stats: { ...d.stats, ...(data.stats || {}) }, today: { ...d.today, ...(data.today || {}) } };
      }
    } catch (e) { /* 隐私模式等情况下忽略 */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  let state = load();

  /* ======================= 工具 ======================= */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const dayStr = (t = Date.now()) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const normalize = (s) => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();

  function toast(msg, ms = 1800) {
    $toast.textContent = msg;
    $toast.hidden = false;
    $toast.style.animation = 'none';
    void $toast.offsetWidth;
    $toast.style.animation = '';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
  }

  function confetti() {
    const colors = ['#6c5ce7', '#1fae6b', '#f5a524', '#e5484d', '#3fa7ff', '#ff7ac6'];
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
      p.style.animationDelay = Math.random() * 0.4 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3800);
  }

  /* ======================= 音效 & 朗读 ======================= */
  let actx = null;
  function tone(freqs, dur = 0.12, type = 'sine', vol = 0.14) {
    if (!state.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      freqs.forEach((f, i) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type;
        o.frequency.value = f;
        const s = t + i * dur;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(vol, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
        o.connect(g).connect(actx.destination);
        o.start(s);
        o.stop(s + dur + 0.02);
      });
    } catch (e) { /* ignore */ }
  }
  const sfx = {
    good: () => tone([660, 990], 0.09),
    bad: () => tone([240, 170], 0.14, 'triangle', 0.18),
    win: () => tone([523, 659, 784, 1047], 0.11),
    flip: () => tone([520], 0.05, 'sine', 0.08),
  };

  const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  function pickVoice() {
    try {
      const vs = speechSynthesis.getVoices();
      return vs.find((v) => /en[-_]US/i.test(v.lang) && /Google|Samantha|Microsoft/i.test(v.name))
        || vs.find((v) => /en[-_]US/i.test(v.lang))
        || vs.find((v) => /^en/i.test(v.lang)) || null;
    } catch (e) { return null; }
  }
  function speak(text, rate = 0.9) {
    if (!canSpeak || !state.sound) return null;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      const v = pickVoice();
      if (v) u.voice = v;
      speechSynthesis.speak(u);
      return u;
    } catch (e) { return null; }
  }
  if (canSpeak) { try { speechSynthesis.getVoices(); } catch (e) { /* ignore */ } }

  /* ======================= 词库 & 进度 ======================= */
  const toWord = (a) => ({ w: a[0], ph: a[1] || '', pos: a[2] || '', cn: a[3] || '', ex: a[4] || '', exCn: a[5] || '' });

  function allBooks() {
    const books = window.WORD_BOOKS.map((b) => ({ ...b, words: b.words.map(toWord) }));
    if (state.custom.length) {
      books.push({ id: 'custom', name: '我的词库', icon: '✏️', desc: '自定义导入的单词', words: state.custom.map(toWord) });
    }
    return books;
  }
  function currentBook() {
    const books = allBooks();
    return books.find((b) => b.id === state.bookId) || books[0];
  }
  const pKey = (book, word) => book.id + ':' + word.w;
  const prog = (book, word) => state.progress[pKey(book, word)];
  const isMastered = (book, word) => (prog(book, word)?.box || 0) >= MASTER_BOX;

  function bookStats(book) {
    let learned = 0, mastered = 0, due = 0;
    const now = Date.now();
    for (const w of book.words) {
      const p = prog(book, w);
      if (!p) continue;
      learned++;
      if (p.box >= MASTER_BOX) mastered++;
      if (p.due <= now) due++;
    }
    return { total: book.words.length, learned, mastered, due };
  }

  function wrongWords(book) {
    return book.words
      .filter((w) => { const p = prog(book, w); return p && p.wrong > 0 && p.box <= 2; })
      .sort((a, b) => prog(book, b).wrong - prog(book, a).wrong);
  }

  // 智能选词：到期复习 > 新词 > 未到期的低等级词
  function pickWords(book, n, pool = book.words) {
    const now = Date.now();
    const scored = pool.map((w) => {
      const p = prog(book, w);
      let s;
      if (!p) s = 1 + Math.random();
      else if (p.due <= now) s = 3 - p.box * 0.3 + Math.random() * 0.5;
      else s = -p.box + Math.random() * 0.5;
      return { w, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return shuffle(scored.slice(0, n).map((x) => x.w));
  }

  // 无尽模式的出词器：先出最需要复习的词，之后整本循环打乱
  function wordStream(book, pool = book.words) {
    let queue = [];
    let first = true;
    let last = null;
    return () => {
      if (!queue.length) {
        queue = first ? pickWords(book, Math.min(15, pool.length), pool) : shuffle(pool);
        first = false;
        if (queue.length > 1 && queue[0] === last) queue.push(queue.shift());
      }
      last = queue.shift();
      return last;
    };
  }

  // 把释义拆成义项，用来避开意思重叠的干扰项（如 crucial / vital）
  const senses = (cn) => cn.replace(/（[^）]*）|\([^)]*\)/g, '').split(/[；;，,、]/).map((x) => x.trim()).filter(Boolean);
  function meaningOverlap(a, b) {
    const A = senses(a.cn), B = senses(b.cn);
    return A.some((x) => B.some((y) => x.includes(y) || y.includes(x)));
  }

  // 生成四选一题目。dir: en2cn 英译中 / cn2en 中译英 / listen 听音 / cloze 例句填空
  function buildQuestion(book, w, dir) {
    const label = (x) => (dir === 'en2cn' ? x.cn : normalize(x.w));
    const others = shuffle(book.words.filter((x) => x.w !== w.w));
    const tiers = [
      others.filter((x) => !meaningOverlap(x, w) && (dir !== 'cloze' || x.pos === w.pos)),
      others.filter((x) => !meaningOverlap(x, w)),
      others,
    ];
    const seen = new Set([label(w)]);
    const distract = [];
    for (const tier of tiers) {
      for (const x of tier) {
        if (distract.length >= 3) break;
        if (seen.has(label(x))) continue;
        seen.add(label(x));
        distract.push(x);
      }
    }
    const q = { w, dir, options: shuffle([w, ...distract]) };
    if (dir === 'cloze') q.cloze = findInSentence(w);
    return q;
  }

  // 在例句中找到目标词，允许常见词形变化：-s/-es/-d/-ed/-ing、双写辅音、e 结尾 +ing、y→i
  function isFormOf(t, w) {
    if (t === w) return true;
    if (t.startsWith(w)) {
      const rest = t.slice(w.length);
      if (['s', 'es', 'd', 'ed', 'ing'].includes(rest)) return true;
      if (rest[0] === w[w.length - 1] && ['ed', 'ing'].includes(rest.slice(1))) return true;
    }
    if (w.endsWith('e') && t === w.slice(0, -1) + 'ing') return true;
    if (w.endsWith('y') && ['ies', 'ied'].some((x) => t === w.slice(0, -1) + x)) return true;
    return false;
  }
  function findInSentence(w) {
    const word = w.w.toLowerCase();
    if (!w.ex || !/^[a-z]+$/.test(word)) return null;
    const re = /[A-Za-z]+/g;
    let m;
    while ((m = re.exec(w.ex))) {
      if (isFormOf(m[0].toLowerCase(), word)) return { start: m.index, end: m.index + m[0].length, form: m[0] };
    }
    return null;
  }
  const clozePool = (book) => book.words.filter((w) => w.exCn && findInSentence(w));
  const shortMeaning = (w) => senses(w.cn)[0] || w.cn;

  // 连词成句：把例句拆成单词块，句末标点单独保留
  function sentenceParts(ex) {
    let text = ex.trim();
    const m = text.match(/[.?!]+$/);
    const end = m ? m[0] : '';
    if (end) text = text.slice(0, -end.length).trim();
    return { tokens: text.split(/\s+/), end };
  }
  const sentencePool = (book) => book.words.filter((w) => {
    if (!w.ex || !w.exCn) return false;
    const n = sentenceParts(w.ex).tokens.length;
    return n >= 3 && n <= 12;
  });

  function touchDay() {
    const today = dayStr();
    if (state.lastStudyDay !== today) {
      const yesterday = dayStr(Date.now() - DAY);
      state.streak = state.lastStudyDay === yesterday ? state.streak + 1 : 1;
      state.lastStudyDay = today;
    }
    if (state.today.date !== today) state.today = { date: today, count: 0, goalDone: false };
  }

  // quality: 'good' 掌握 / 'hard' 模糊 / 'again' 不会
  function record(book, word, quality) {
    const k = pKey(book, word);
    const p = state.progress[k] || { box: 0, due: 0, right: 0, wrong: 0 };
    if (quality === 'good') { p.box = Math.min(MAX_BOX, Math.max(p.box, 1) + 1); p.right++; }
    else if (quality === 'hard') { p.box = Math.max(1, p.box); p.right++; }
    else { p.box = 1; p.wrong++; }
    p.due = Date.now() + INTERVALS[p.box] * DAY;
    p.last = Date.now();
    state.progress[k] = p;

    touchDay();
    state.today.count++;
    state.stats.answered++;
    if (quality !== 'again') state.stats.correct++;
    if (!state.today.goalDone && state.today.count >= state.goal) {
      state.today.goalDone = true;
      setTimeout(() => { toast('🎯 今日目标达成！'); confetti(); sfx.win(); }, 300);
    }
    save();
  }

  /* ======================= 等级 & 成就 ======================= */
  const TITLES = ['单词新手', '词汇学徒', '拼读小将', '记忆能手', '词汇达人', '语言骑士', '单词大师', '词汇宗师', '传奇学霸'];
  function levelInfo(xp) {
    const level = Math.floor((1 + Math.sqrt(1 + (4 * xp) / 50)) / 2);
    const base = 50 * level * (level - 1);
    const next = 50 * (level + 1) * level;
    return { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], cur: xp - base, need: next - base };
  }
  function addXP(n) {
    const before = levelInfo(state.xp).level;
    state.xp += n;
    const after = levelInfo(state.xp);
    save();
    if (after.level > before) {
      setTimeout(() => { toast(`🎉 升级！Lv.${after.level} ${after.title}`, 2500); confetti(); sfx.win(); }, 400);
    }
    renderTopbar();
  }

  function masteredTotal() {
    return Object.values(state.progress).filter((p) => p.box >= MASTER_BOX).length;
  }
  const ACHIEVEMENTS = [
    { id: 'first', icon: '👣', name: '初次登场', desc: '答对第一道题', test: () => state.stats.correct >= 1 },
    { id: 'combo10', icon: '🔥', name: '连击达人', desc: '单局连对 10 题', test: () => state.stats.bestCombo >= 10 },
    { id: 'perfect', icon: '💯', name: '满分通关', desc: '一局全部答对', test: () => state.stats.perfect >= 1 },
    { id: 'fast', icon: '⚡', name: '闪电手', desc: '20 秒内完成连连看', test: () => state.stats.fastMatch },
    { id: 'blitz20', icon: '⏱️', name: '争分夺秒', desc: '60 秒挑战答对 20 题', test: () => state.stats.bestBlitz >= 20 },
    { id: 'rain3', icon: '🌧️', name: '雨中英雄', desc: '单词雨坚持到第 3 波', test: () => state.stats.bestRainLevel >= 3 },
    { id: 'whack20', icon: '🔨', name: '神锤手', desc: '打地鼠一局打中 20 只', test: () => (state.stats.bestWhack || 0) >= 20 },
    { id: 'judge30', icon: '⚖️', name: '火眼金睛', desc: '对错快判连续答对 30 题', test: () => (state.stats.bestJudge || 0) >= 30 },
    { id: 'stage1', icon: '🗡️', name: '初战告捷', desc: '在单词闯关中通过一关', test: () => Object.values(state.adventure || {}).some((a) => Array.isArray(a) && a.some((x) => x > 0)) },
    { id: 'boss', icon: '🐉', name: '屠龙勇士', desc: '打败任意一个 BOSS', test: () => (state.stats.bossWins || 0) >= 1 },
    { id: 'm10', icon: '🌟', name: '小有所成', desc: '掌握 10 个单词', test: () => masteredTotal() >= 10 },
    { id: 'm50', icon: '👑', name: '词汇达人', desc: '掌握 50 个单词', test: () => masteredTotal() >= 50 },
    { id: 's3', icon: '📅', name: '三天打卡', desc: '连续学习 3 天', test: () => state.streak >= 3 },
    { id: 's7', icon: '🏅', name: '坚持一周', desc: '连续学习 7 天', test: () => state.streak >= 7 },
    { id: 'q500', icon: '📚', name: '刷题狂人', desc: '累计答题 500 次', test: () => state.stats.answered >= 500 },
    { id: 'xp1000', icon: '💎', name: '千分学霸', desc: '累计获得 1000 经验', test: () => state.xp >= 1000 },
  ];
  function checkAchievements() {
    const fresh = ACHIEVEMENTS.filter((a) => !state.achievements.includes(a.id) && a.test());
    if (!fresh.length) return;
    fresh.forEach((a) => state.achievements.push(a.id));
    save();
    fresh.forEach((a, i) => setTimeout(() => { toast(`🏆 解锁成就：${a.icon} ${a.name}`, 2400); sfx.win(); }, 900 + i * 2600));
  }

  /* ======================= 路由 ======================= */
  let cleanups = [];
  let onKey = null;
  const onCleanup = (fn) => cleanups.push(fn);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (onKey) onKey(e);
  });

  function go(name, arg) {
    cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    cleanups = [];
    onKey = null;
    $app.onclick = null;
    $app.oninput = null;
    if (canSpeak) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    window.scrollTo(0, 0);
    SCREENS[name](arg);
    renderTopbar();
  }

  function renderTopbar() {
    $stats.innerHTML = `
      <span class="pill" title="连续学习天数">🔥 ${state.streak}</span>
      <span class="pill" title="经验值">⭐ ${state.xp}</span>
      <button class="icon-btn" data-top="sound" aria-label="${state.sound ? '关闭声音' : '开启声音'}" title="${state.sound ? '关闭声音' : '开启声音'}">${state.sound ? '🔊' : '🔇'}</button>`;
  }
  $stats.addEventListener('click', (e) => {
    if (e.target.closest('[data-top="sound"]')) {
      state.sound = !state.sound;
      save();
      renderTopbar();
      toast(state.sound ? '声音已开启' : '已静音');
    }
  });
  document.querySelector('.brand').addEventListener('click', () => go('home'));

  // "跟随系统"时还原页面原有的主题设置（例如宿主页面指定的主题）
  const hostTheme = document.documentElement.getAttribute('data-theme');
  function applyTheme() {
    const t = state.theme === 'auto' ? hostTheme : state.theme;
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  // 页面内二次确认：第一次点击变为确认提示，3 秒内再点一次才执行
  function armConfirm(el, label) {
    if (el.dataset.armed === '1') return true;
    const original = el.textContent;
    el.dataset.armed = '1';
    el.textContent = label;
    setTimeout(() => {
      if (!el.isConnected) return;
      el.dataset.armed = '';
      el.textContent = original;
    }, 3000);
    return false;
  }

  /* ======================= 首页 ======================= */
  const MODES = [
    { id: 'flash', group: 'learn', icon: '🃏', name: '闪卡记忆', desc: '翻卡片，认识新单词', color: '#ffd978' },
    { id: 'review', group: 'learn', icon: '📕', name: '错题复习', desc: '攻克易错单词', color: '#ffbf9e' },
    { id: 'quiz', group: 'practice', icon: '⚡', name: '极速选择', desc: '限时作答，连击加分', color: '#b9a8ff' },
    { id: 'listen', group: 'practice', icon: '🎧', name: '听音辨词', desc: '听发音，选出单词', color: '#9fd0ff' },
    { id: 'spell', group: 'practice', icon: '⌨️', name: '拼写大师', desc: '看释义，拼出单词', color: '#8fe0b8' },
    { id: 'dictation', group: 'practice', icon: '🖊️', name: '听写', desc: '听发音，写出单词', color: '#f5c6a5', isNew: true },
    { id: 'cloze', group: 'practice', icon: '📝', name: '例句填空', desc: '读懂句子，选词填空', color: '#d6e88f' },
    { id: 'sentence', group: 'practice', icon: '🧱', name: '连词成句', desc: '按中文意思排好句子', color: '#c5b8f0', isNew: true },
    { id: 'judge', group: 'game', icon: '⚖️', name: '对错快判', desc: '意思配不配？一错就结束', color: '#b5e48c', isNew: true },
    { id: 'scramble', group: 'game', icon: '🔤', name: '字母拼拼', desc: '点字母，拼出单词', color: '#a7e3e6' },
    { id: 'match', group: 'game', icon: '🧩', name: '连连看', desc: '英汉配对，挑战最快', color: '#ffb3c6' },
    { id: 'whack', group: 'game', icon: '🔨', name: '单词打地鼠', desc: '找到意思对的地鼠，敲它', color: '#e8cf9a', isNew: true },
    { id: 'blitz', group: 'game', icon: '⏱️', name: '60 秒挑战', desc: '一分钟内答对越多越好', color: '#ff9f9f' },
    { id: 'rain', group: 'game', icon: '🌧️', name: '单词雨', desc: '打字消灭落下的单词', color: '#c3d0e0' },
  ];
  const MODE_GROUPS = [
    { id: 'learn', title: '📖 学习' },
    { id: 'practice', title: '✍️ 练习' },
    { id: 'game', title: '🎮 游戏' },
  ];

  function modeBest(id, book) {
    const b = state.best[id + ':' + book.id];
    if (b == null) return '';
    if (id === 'match') return `最快 ${b.toFixed(1)} 秒`;
    if (id === 'blitz') return `最佳 ${b} 题`;
    if (id === 'rain') return `最高 ${b} 分`;
    if (id === 'whack') return `最佳 ${b} 只`;
    if (id === 'judge') return `最佳连对 ${b} 题`;
    return '';
  }

  function modeCard(m, book, wrongCount) {
    const best = modeBest(m.id, book);
    let badge = '';
    if (m.id === 'review' && wrongCount) badge = `<span class="badge">${wrongCount}</span>`;
    else if (m.isNew && !state.seenModes.includes(m.id)) badge = '<span class="badge new">新</span>';
    return `<button class="mode" data-action="mode" data-id="${m.id}">
      <div class="mode-icon" style="background:color-mix(in srgb, ${m.color} 75%, var(--surface))">${m.icon}</div>
      <div class="mode-name">${m.name}</div>
      <div class="mode-desc">${m.desc}</div>
      ${best ? `<div class="mode-best">🏅 ${best}</div>` : ''}
      ${badge}
    </button>`;
  }

  function renderHome() {
    touchDayView();
    const book = currentBook();
    const lv = levelInfo(state.xp);
    const todayCount = state.today.date === dayStr() ? state.today.count : 0;
    const wrongCount = wrongWords(book).length;
    const bs = bookStats(book);

    $app.innerHTML = `
      <section class="card hero">
        <div class="level-badge">Lv.<b>${lv.level}</b></div>
        <div>
          <div class="hero-title">${esc(lv.title)}</div>
          <div class="muted small">经验 ${lv.cur} / ${lv.need}</div>
          <div class="bar"><i style="width:${Math.min(100, (lv.cur / lv.need) * 100)}%"></i></div>
          <div class="hero-goal">🎯 今日目标 <b>${Math.min(todayCount, state.goal)}</b> / ${state.goal} 词次 ${todayCount >= state.goal ? '✅' : ''}</div>
          <div class="bar"><i style="width:${Math.min(100, (todayCount / state.goal) * 100)}%"></i></div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">📚 选择词库</h2>
        <div class="books">
          ${allBooks().map((b) => {
            const s = bookStats(b);
            return `<button class="book" data-action="book" data-id="${esc(b.id)}" aria-pressed="${b.id === book.id}">
              <div class="book-name">${b.icon} ${esc(b.name)}</div>
              <div class="muted small">${esc(b.desc)}</div>
              <div class="muted small">已掌握 ${s.mastered} / ${s.total}</div>
              <div class="bar"><i style="width:${(s.mastered / s.total) * 100}%"></i></div>
            </button>`;
          }).join('')}
        </div>
        <p class="muted small">当前词库：已学 ${bs.learned} 词，待复习 ${bs.due} 词，已掌握 ${bs.mastered} 词</p>
      </section>

      <section class="section">
        <h2 class="section-title">⚔️ 冒险</h2>
        ${adventureBanner(book)}
      </section>
      ${MODE_GROUPS.map((grp) => {
        const ms = MODES.filter((m) => m.group === grp.id);
        return `<section class="section">
          <h2 class="section-title">${grp.title}</h2>
          <div class="modes count-${ms.length}">${ms.map((m) => modeCard(m, book, wrongCount)).join('')}</div>
        </section>`;
      }).join('')}

      <section class="section">
        <h2 class="section-title">🧰 更多</h2>
        <div class="row">
          <button class="btn ghost sm" data-action="nav" data-to="words">📖 单词表</button>
          <button class="btn ghost sm" data-action="nav" data-to="import">✏️ 导入词库</button>
          <button class="btn ghost sm" data-action="nav" data-to="profile">🏆 我的成就 & 设置</button>
        </div>
      </section>`;

    $app.onclick = (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'book') { state.bookId = el.dataset.id; save(); renderHome(); }
      else if (a === 'mode') startMode(el.dataset.id);
      else if (a === 'nav') go(el.dataset.to);
    };
  }
  // 跨天后只更新"今日"计数显示，不改变连续天数
  function touchDayView() {
    if (state.today.date !== dayStr()) state.today = { date: dayStr(), count: 0, goalDone: false };
    if (state.lastStudyDay && state.lastStudyDay !== dayStr() && state.lastStudyDay !== dayStr(Date.now() - DAY)) {
      state.streak = 0;
    }
  }

  function startMode(id) {
    const book = currentBook();
    if (!state.seenModes.includes(id)) { state.seenModes.push(id); save(); }
    if (id === 'flash') go('flash', { words: pickWords(book, 10) });
    else if (id === 'quiz') go('choice', { kind: 'quiz', title: '极速选择', words: pickWords(book, 10), timer: true, hearts: true });
    else if (id === 'listen') {
      if (!canSpeak) toast('当前浏览器不支持语音朗读，将以音标代替', 2600);
      go('choice', { kind: 'listen', title: '听音辨词', words: pickWords(book, 10), timer: false, hearts: true });
    }
    else if (id === 'spell') go('spell', { words: pickWords(book, 8) });
    else if (id === 'match') go('match', { words: pickWords(book, 6) });
    else if (id === 'review') {
      const ws = wrongWords(book).slice(0, 10);
      if (!ws.length) { toast('暂无错题，继续保持！👍'); return; }
      go('choice', { kind: 'review', title: '错题复习', words: shuffle(ws), timer: false, hearts: false });
    }
    else if (id === 'cloze') {
      const pool = clozePool(book);
      if (pool.length < 4) { toast('这个词库没有可用的例句，换个内置词库试试', 2600); return; }
      go('choice', { kind: 'cloze', title: '例句填空', words: pickWords(book, Math.min(10, pool.length), pool), timer: false, hearts: false });
    }
    else if (id === 'scramble') {
      const pool = book.words.filter((w) => w.w.replace(/[^A-Za-z]/g, '').length >= 2);
      if (!pool.length) { toast('这个词库没有合适的单词'); return; }
      go('scramble', { words: pickWords(book, Math.min(8, pool.length), pool) });
    }
    else if (id === 'blitz') go('blitz');
    else if (id === 'rain') go('rain');
    else if (id === 'whack') go('whack');
    else if (id === 'judge') go('judge');
    else if (id === 'adventure') go('adventure');
    else if (id === 'dictation') {
      if (!canSpeak) toast('当前浏览器不支持语音朗读，将以音标代替', 2600);
      go('spell', { words: pickWords(book, 8), dictation: true });
    }
    else if (id === 'sentence') {
      const pool = sentencePool(book);
      if (!pool.length) { toast('这个词库没有可用的例句，换个内置词库试试', 2600); return; }
      go('sentence', { words: pickWords(book, Math.min(6, pool.length), pool) });
    }
  }

  /* ======================= 通用组件 ======================= */
  function gameHead(i, total, extra = '') {
    return `<div class="game-head">
      <button class="icon-btn" data-action="quit" aria-label="退出" title="退出 (Esc)">✕</button>
      <div class="bar"><i style="width:${(i / total) * 100}%; background: var(--primary)"></i></div>
      <span class="small muted">${i}/${total}</span>
      ${extra}
    </div>`;
  }
  // 字母格子随单词长度缩放，长单词在手机上也排成一行
  const slotsAttrs = (n) => `class="slots ${n > 11 ? 'compact tiny' : n > 8 ? 'compact' : ''}" style="--n:${n}"`;
  const speakBtn = (w) => `<button class="speak" data-action="speak" data-w="${esc(w)}" aria-label="朗读 ${esc(w)}">🔊</button>`;
  const wordDetail = (w, showEx = true) => `
    <div><b style="font-family:var(--font-word);font-size:18px">${esc(w.w)}</b> ${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>
    <div><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div>
    ${showEx && w.ex ? `<div class="example">${esc(w.ex)}</div>${w.exCn ? `<div class="ex-cn">${esc(w.exCn)}</div>` : ''}` : ''}`;

  function quitHandler(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return false;
    if (el.dataset.action === 'quit') { go('home'); return true; }
    if (el.dataset.action === 'speak') { speak(el.dataset.w); return true; }
    return false;
  }

  function optionsHtml(q) {
    const cn = q.dir === 'en2cn';
    return `<div class="options">${q.options.map((o, idx) => `
      <button class="option ${cn ? '' : 'word'}" data-action="pick" data-idx="${idx}">
        <span class="key">${idx + 1}</span><span>${esc(cn ? o.cn : o.w)}</span>
      </button>`).join('')}</div>`;
  }
  function markOptions(q, idx) {
    $app.querySelectorAll('.option').forEach((b, i) => {
      b.disabled = true;
      if (q.options[i] === q.w) b.classList.add('correct');
      else if (i === idx) b.classList.add('wrong');
    });
  }

  // 四选一题目的题干（选择、听力、例句填空、闯关共用）
  function promptHtml(q) {
    const w = q.w;
    if (q.dir === 'en2cn') {
      return `<div class="prompt-label">选择正确的中文释义</div>
        <div class="prompt-word">${esc(w.w)}</div>
        <div>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>`;
    }
    if (q.dir === 'cn2en') {
      return `<div class="prompt-label">选择对应的英文单词</div>
        <div class="prompt-cn">${esc(w.cn)}</div>
        <div><span class="pos">${esc(w.pos)}</span></div>`;
    }
    if (q.dir === 'cloze') {
      const c = q.cloze;
      return `<div class="prompt-label">读句子，选出空格里的单词</div>
        <div class="cloze-cn">${esc(w.exCn)}</div>
        <div class="cloze-en">${esc(w.ex.slice(0, c.start))}<span class="blank" id="blank" style="min-width:${Math.max(3, c.form.length)}ch"></span>${esc(w.ex.slice(c.end))}</div>`;
    }
    return `<div class="prompt-label">听发音，选出正确的单词</div>
      <button class="big-speaker" data-action="replay" aria-label="再听一遍 (R)">🔊</button>
      <div class="row" style="justify-content:center">
        <button class="btn ghost sm" data-action="replay">🔁 再听一遍</button>
        <button class="btn ghost sm" data-action="slow">🐢 慢速</button>
      </div>
      ${!canSpeak || !state.sound ? `<div class="phonetic" style="margin-top:8px">${state.sound ? '浏览器不支持朗读' : '声音已关闭'}，提示音标：${esc(w.ph || '—')}</div>` : ''}`;
  }

  // 揭晓答案：标记选项、填好例句空格、朗读，返回解析内容
  function revealAnswer(q, idx, ok) {
    markOptions(q, idx);
    const isCloze = q.dir === 'cloze';
    if (isCloze) {
      const blank = document.getElementById('blank');
      if (blank) {
        blank.textContent = q.cloze.form;
        blank.classList.add(ok ? 'ok' : 'bad');
      }
    }
    if (!ok || q.dir !== 'listen') speak(isCloze ? q.w.ex : q.w.w);
    const formNote = isCloze && normalize(q.cloze.form) !== normalize(q.w.w)
      ? `<div class="small">句中形式：<b>${esc(q.cloze.form)}</b>（${esc(q.w.w)} 的变形）</div>` : '';
    return formNote + wordDetail(q.w, !isCloze);
  }

  function restartAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // 带自动清理的 setTimeout：离开当前页面时一并取消
  function makeLater() {
    const pending = new Set();
    onCleanup(() => pending.forEach(clearTimeout));
    return (fn, ms) => {
      const t = setTimeout(() => { pending.delete(t); fn(); }, ms);
      pending.add(t);
      return t;
    };
  }

  // 挑战类玩法的开始页：说明规则、显示纪录
  function introScreen({ icon, title, rules, best, onStart }) {
    $app.innerHTML = `
      <div class="game-head"><button class="icon-btn" data-action="quit" aria-label="退出">✕</button></div>
      <section class="card intro">
        <div class="intro-icon">${icon}</div>
        <h2>${title}</h2>
        <ul class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
        ${best ? `<span class="pill">🏅 ${esc(best)}</span>` : ''}
        <button class="btn" data-action="start">开始 ↵</button>
      </section>`;
    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      if (e.target.closest('[data-action="start"]')) onStart();
    };
    onKey = (e) => {
      if (e.key === 'Escape') go('home');
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); onStart(); }
    };
  }

  /* ======================= 选择题（极速 / 听力 / 错题） ======================= */
  function renderChoice(cfg) {
    const book = currentBook();
    const g = { i: 0, hearts: cfg.hearts ? 3 : null, combo: 0, bestCombo: 0, score: 0, correct: 0, wrong: [], answered: false, q: null };
    let timerId = null, autoId = null;
    onCleanup(() => { clearInterval(timerId); clearTimeout(autoId); });

    function buildQ() {
      const w = cfg.words[g.i];
      const dir = cfg.kind === 'listen' ? 'listen' : cfg.kind === 'cloze' ? 'cloze' : Math.random() < 0.5 ? 'en2cn' : 'cn2en';
      return buildQuestion(book, w, dir);
    }

    function headExtra() {
      const hearts = g.hearts === null ? '' : `<span class="hearts" aria-label="剩余生命 ${g.hearts}">${'❤️'.repeat(g.hearts)}${'🤍'.repeat(3 - g.hearts)}</span>`;
      return `${hearts}<span class="combo" id="combo">${g.combo >= 2 ? `🔥x${g.combo}` : ''}</span>`;
    }

    function render() {
      const q = g.q;
      const prompt = promptHtml(q);
      $app.innerHTML = `
        ${gameHead(g.i, cfg.words.length, headExtra())}
        ${cfg.timer ? '<div class="timer"><i id="timer-bar" style="width:100%"></i></div>' : ''}
        <section class="card prompt">${prompt}</section>
        ${optionsHtml(q)}
        <div id="fb"></div>`;
    }

    function startTimer() {
      if (!cfg.timer) return;
      const t0 = performance.now();
      clearInterval(timerId);
      timerId = setInterval(() => {
        const left = Math.max(0, 1 - (performance.now() - t0) / QUIZ_TIME);
        const bar = document.getElementById('timer-bar');
        if (bar) bar.style.width = left * 100 + '%';
        g.timeLeft = left;
        if (left <= 0) { clearInterval(timerId); pick(-1); }
      }, 50);
    }

    function pick(idx) {
      if (g.answered) return;
      g.answered = true;
      clearInterval(timerId);
      const q = g.q;
      const ok = idx >= 0 && q.options[idx] === q.w;
      const isCloze = q.dir === 'cloze';
      const detail = revealAnswer(q, idx, ok);
      record(book, q.w, ok ? 'good' : 'again');
      const fb = document.getElementById('fb');
      if (ok) {
        g.combo++;
        g.bestCombo = Math.max(g.bestCombo, g.combo);
        const bonus = cfg.timer ? Math.round((g.timeLeft ?? 0) * 5) : 0;
        const gain = 10 + Math.min(g.combo - 1, 5) * 2 + bonus;
        g.score += gain;
        g.correct++;
        addXP(gain);
        sfx.good();
        fb.innerHTML = `<div class="feedback good">
          <div class="feedback-text"><div class="feedback-title">✓ 回答正确 +${gain}${g.combo >= 2 ? ` · 连击 x${g.combo}` : ''}</div>${detail}</div>
          <button class="btn good" data-action="next">下一题 ↵</button></div>`;
        autoId = setTimeout(next, isCloze ? 2600 : 1400);
      } else {
        g.combo = 0;
        if (g.hearts !== null) g.hearts--;
        g.wrong.push(q.w);
        sfx.bad();
        fb.innerHTML = `<div class="feedback bad">
          <div class="feedback-text"><div class="feedback-title">${idx < 0 ? '⏰ 时间到！' : '✗ 答错了'} 正确答案：</div>${detail}</div>
          <button class="btn bad" data-action="next">继续 ↵</button></div>`;
      }
      const hearts = $app.querySelector('.hearts');
      if (hearts && g.hearts !== null) hearts.textContent = '❤️'.repeat(g.hearts) + '🤍'.repeat(3 - g.hearts);
      const combo = document.getElementById('combo');
      combo.textContent = g.combo >= 2 ? `🔥x${g.combo}` : '';
      if (ok && g.combo >= 2) { combo.classList.remove('pop'); void combo.offsetWidth; combo.classList.add('pop'); }
    }

    function next() {
      clearTimeout(autoId);
      if (!g.answered) return;
      g.i++;
      if (g.i >= cfg.words.length || g.hearts === 0) return finish();
      g.q = buildQ();
      g.answered = false;
      render();
      startTimer();
      if (g.q.dir === 'listen') setTimeout(() => speak(g.q.w.w), 250);
    }

    function finish() {
      state.stats.bestCombo = Math.max(state.stats.bestCombo, g.bestCombo);
      go('result', {
        title: cfg.title,
        correct: g.correct,
        total: cfg.words.length,
        answered: g.i,
        score: g.score,
        bestCombo: g.bestCombo,
        wrong: g.wrong,
        note: g.hearts === 0 && g.i < cfg.words.length ? '💔 生命值耗尽，下次加油！' : '',
        again: () => startMode(cfg.kind),
      });
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'pick') pick(Number(el.dataset.idx));
      else if (a === 'next') next();
      else if (a === 'replay') speak(g.q.w.w);
      else if (a === 'slow') speak(g.q.w.w, 0.55);
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (!g.answered && /^[1-4]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key) - 1); }
      else if (g.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'r' && g.q.dir === 'listen') speak(g.q.w.w);
    };

    g.q = buildQ();
    render();
    startTimer();
    if (g.q.dir === 'listen') setTimeout(() => speak(g.q.w.w), 350);
  }

  /* ======================= 闪卡 ======================= */
  function renderFlash({ words }) {
    const book = currentBook();
    const g = { i: 0, flipped: false, known: 0, wrong: [], score: 0 };

    function render() {
      const w = words[g.i];
      $app.innerHTML = `
        ${gameHead(g.i, words.length)}
        <div class="flash-wrap">
          <div class="flash ${g.flipped ? 'flipped' : ''}" id="flash" role="button" tabindex="0" data-action="flip" aria-label="翻转卡片 (空格)">
            <div class="flash-face">
              <div class="prompt-word">${esc(w.w)}</div>
              <div>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>
              <div class="flash-hint">点击卡片或按空格查看释义</div>
            </div>
            <div class="flash-face flash-back">
              <div class="prompt-word" style="font-size:28px">${esc(w.w)}</div>
              <div class="prompt-cn"><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div>
              ${w.ex ? `<div class="example">“${esc(w.ex)}”</div>` : ''}
              ${w.exCn ? `<div class="ex-cn">${esc(w.exCn)}</div>` : ''}
              <div>${speakBtn(w.ex || w.w)}</div>
            </div>
          </div>
        </div>
        <div class="rate" id="rate" ${g.flipped ? '' : 'hidden'}>
          <button class="btn bad" data-action="rate" data-q="again">😵 不认识<span class="small">·1</span></button>
          <button class="btn warn" data-action="rate" data-q="hard">🤔 模糊<span class="small">·2</span></button>
          <button class="btn good" data-action="rate" data-q="good">😎 认识<span class="small">·3</span></button>
        </div>
        ${g.flipped ? '' : '<p class="muted small" id="flash-tip" style="text-align:center">先想一想它的意思，再翻开卡片</p>'}`;
    }

    function flip() {
      g.flipped = !g.flipped;
      sfx.flip();
      document.getElementById('flash').classList.toggle('flipped', g.flipped);
      const rate = document.getElementById('rate');
      if (g.flipped) { rate.hidden = false; document.getElementById('flash-tip')?.remove(); }
    }

    function rate(q) {
      if (!g.flipped) return;
      const w = words[g.i];
      record(book, w, q);
      const gain = q === 'good' ? 5 : q === 'hard' ? 3 : 1;
      g.score += gain;
      addXP(gain);
      if (q === 'good') g.known++;
      if (q === 'again') g.wrong.push(w);
      g.i++;
      g.flipped = false;
      if (g.i >= words.length) {
        return go('result', { title: '闪卡记忆', correct: g.known, total: words.length, answered: words.length, score: g.score, wrong: g.wrong, again: () => startMode('flash'), correctLabel: '认识' });
      }
      render();
      speak(words[g.i].w);
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      if (el.dataset.action === 'flip') flip();
      else if (el.dataset.action === 'rate') rate(el.dataset.q);
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
      else if (g.flipped && ['1', '2', '3'].includes(e.key)) rate(['again', 'hard', 'good'][Number(e.key) - 1]);
    };
    render();
    setTimeout(() => speak(words[0].w), 300);
  }

  /* ======================= 拼写 ======================= */
  function renderSpell({ words, dictation = false }) {
    const book = currentBook();
    const later = makeLater();
    const g = { i: 0, attempts: 0, hints: 0, meaning: false, done: false, correct: 0, score: 0, wrong: [] };
    const revealMeaning = () => {
      const el = document.getElementById('spell-cn');
      if (el) el.hidden = false;
    };

    function render() {
      const w = words[g.i];
      $app.innerHTML = `
        ${gameHead(g.i, words.length)}
        <section class="card prompt">
          ${dictation ? `
          <div class="prompt-label">听写：听发音，写出单词</div>
          <button class="big-speaker" data-action="replay" aria-label="再听一遍">🔊</button>
          <div class="row" style="justify-content:center">
            <button class="btn ghost sm" data-action="replay">🔁 再听一遍</button>
            <button class="btn ghost sm" data-action="slow">🐢 慢速</button>
          </div>
          ${!canSpeak || !state.sound ? `<div class="phonetic" style="margin-top:8px">${state.sound ? '浏览器不支持朗读' : '声音已关闭'}，提示音标：${esc(w.ph || '—')}</div>` : ''}
          <div class="prompt-cn" id="spell-cn" ${g.meaning ? '' : 'hidden'}><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div>` : `
          <div class="prompt-label">根据释义拼写单词</div>
          <div class="prompt-cn">${esc(w.cn)}</div>
          <div><span class="pos">${esc(w.pos)}</span>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>`}
          <div ${slotsAttrs(w.w.length)} id="slots"></div>
          <div class="muted small">共 ${w.w.replace(/ /g, '').length} 个字母</div>
        </section>
        <div style="margin-top:14px">
          <input id="spell" class="spell-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
            maxlength="${w.w.length}" placeholder="在这里输入单词" aria-label="输入单词拼写" />
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost" data-action="hint" id="hint-btn">${dictation && !g.meaning ? '💡 看释义' : '💡 提示字母'}</button>
          <span class="spacer"></span>
          <button class="btn" data-action="check" id="check-btn">提交 ↵</button>
        </div>
        <div id="fb"></div>`;
      updateSlots();
      const input = document.getElementById('spell');
      input.addEventListener('input', updateSlots);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); g.done ? next() : check(); }
      });
      input.focus();
    }

    function updateSlots(reveal) {
      const w = words[g.i];
      const input = document.getElementById('spell');
      const typed = reveal === true ? w.w : input.value;
      document.getElementById('slots').innerHTML = Array.from(w.w).map((ch, i) => {
        if (ch === ' ') return '<span class="slot space"></span>';
        const t = typed[i] || '';
        const cls = ['slot', t ? 'filled' : '', i < g.hints ? 'hint' : ''].join(' ');
        return `<span class="${cls}">${esc(t)}</span>`;
      }).join('');
    }

    function hint() {
      if (g.done) return;
      const w = words[g.i];
      if (dictation && !g.meaning) {
        g.meaning = true;
        revealMeaning();
        document.getElementById('hint-btn').textContent = '💡 提示字母';
        document.getElementById('spell').focus();
        return;
      }
      g.hints++;
      const input = document.getElementById('spell');
      if (g.hints >= w.w.length) { input.value = w.w; return fail(); }
      input.value = w.w.slice(0, g.hints);
      updateSlots();
      input.focus();
    }

    function check() {
      if (g.done) return;
      const w = words[g.i];
      const input = document.getElementById('spell');
      const val = normalize(input.value);
      if (!val) { input.focus(); return; }
      if (val === normalize(w.w)) return success();
      g.attempts++;
      sfx.bad();
      input.classList.remove('wrong');
      void input.offsetWidth;
      input.classList.add('wrong');
      if (g.attempts < 2) { toast('不太对，再试一次！'); input.select(); }
      else fail();
    }

    function success() {
      const w = words[g.i];
      g.done = true;
      revealMeaning();
      const q = g.hints === 0 && g.attempts === 0 ? 'good' : 'hard';
      record(book, w, q);
      const gain = Math.max(4, 15 - g.hints * 4 - g.attempts * 4);
      g.score += gain;
      g.correct++;
      addXP(gain);
      sfx.good();
      speak(w.w);
      const input = document.getElementById('spell');
      input.classList.add('correct');
      input.readOnly = true;
      document.getElementById('fb').innerHTML = `<div class="feedback good">
        <div class="feedback-text"><div class="feedback-title">✓ 拼写正确 +${gain}</div>${wordDetail(w)}</div>
        <button class="btn good" data-action="next">下一个 ↵</button></div>`;
      document.getElementById('check-btn').disabled = true;
    }

    function fail() {
      const w = words[g.i];
      g.done = true;
      revealMeaning();
      record(book, w, 'again');
      g.wrong.push(w);
      sfx.bad();
      speak(w.w);
      updateSlots(true);
      const input = document.getElementById('spell');
      input.readOnly = true;
      document.getElementById('fb').innerHTML = `<div class="feedback bad">
        <div class="feedback-text"><div class="feedback-title">✗ 正确拼写：</div>${wordDetail(w)}</div>
        <button class="btn bad" data-action="next">继续 ↵</button></div>`;
      document.getElementById('check-btn').disabled = true;
    }

    function next() {
      g.i++;
      if (g.i >= words.length) {
        return go('result', { title: dictation ? '听写' : '拼写大师', correct: g.correct, total: words.length, score: g.score, wrong: g.wrong, again: () => startMode(dictation ? 'dictation' : 'spell') });
      }
      Object.assign(g, { attempts: 0, hints: 0, meaning: false, done: false });
      render();
      if (dictation) later(() => speak(words[g.i].w), 300);
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'hint') hint();
      else if (a === 'check') check();
      else if (a === 'next') next();
      else if (a === 'replay') speak(words[g.i].w);
      else if (a === 'slow') speak(words[g.i].w, 0.55);
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (e.key === 'Enter' && g.done) { e.preventDefault(); next(); }
    };
    render();
    if (dictation) later(() => speak(words[0].w), 400);
  }

  /* ======================= 连连看 ======================= */
  function renderMatch({ words }) {
    const book = currentBook();
    const g = { sel: { en: null, cn: null }, matched: 0, mistakes: 0, wrongSet: new Set(), start: Date.now(), locked: false };
    const left = shuffle(words.map((w, k) => ({ w, k })));
    const right = shuffle(words.map((w, k) => ({ w, k })));
    let clock = null;
    onCleanup(() => clearInterval(clock));

    $app.innerHTML = `
      <div class="game-head">
        <button class="icon-btn" data-action="quit" aria-label="退出">✕</button>
        <div class="bar"><i id="match-bar" style="width:0%; background: var(--primary)"></i></div>
        <span class="pill">⏱ <span id="clock">0.0</span>s</span>
        <span class="pill">❌ <span id="mistakes">0</span></span>
      </div>
      <p class="muted small" style="margin-top:0">把英文单词和中文释义配成一对，越快越好！${state.best['match:' + book.id] ? `最佳纪录 ${state.best['match:' + book.id].toFixed(1)}s` : ''}</p>
      <div class="match-grid">
        <div class="match-col">${left.map((x) => `<button class="tile en" data-action="tile" data-side="en" data-k="${x.k}">${esc(x.w.w)}</button>`).join('')}</div>
        <div class="match-col">${right.map((x) => `<button class="tile" data-action="tile" data-side="cn" data-k="${x.k}">${esc(x.w.cn)}</button>`).join('')}</div>
      </div>`;

    clock = setInterval(() => {
      const el = document.getElementById('clock');
      if (el) el.textContent = ((Date.now() - g.start) / 1000).toFixed(1);
    }, 100);

    const tileEl = (side, k) => $app.querySelector(`.tile[data-side="${side}"][data-k="${k}"]`);

    function tap(side, k) {
      if (g.locked) return;
      const el = tileEl(side, k);
      if (el.classList.contains('done')) return;
      if (g.sel[side] === k) { g.sel[side] = null; el.classList.remove('selected'); return; }
      if (g.sel[side] !== null) tileEl(side, g.sel[side]).classList.remove('selected');
      g.sel[side] = k;
      el.classList.add('selected');
      if (side === 'en') speak(words[k].w);
      else sfx.flip();
      if (g.sel.en === null || g.sel.cn === null) return;

      const a = tileEl('en', g.sel.en), b = tileEl('cn', g.sel.cn);
      if (g.sel.en === g.sel.cn) {
        const w = words[g.sel.en];
        a.classList.add('done'); b.classList.add('done');
        a.classList.remove('selected'); b.classList.remove('selected');
        record(book, w, g.wrongSet.has(g.sel.en) ? 'again' : 'good');
        g.matched++;
        sfx.good();
        document.getElementById('match-bar').style.width = (g.matched / words.length) * 100 + '%';
        g.sel = { en: null, cn: null };
        if (g.matched === words.length) setTimeout(finish, 450);
      } else {
        g.mistakes++;
        g.wrongSet.add(g.sel.en);
        document.getElementById('mistakes').textContent = g.mistakes;
        sfx.bad();
        a.classList.add('wrong'); b.classList.add('wrong');
        g.locked = true;
        setTimeout(() => {
          a.classList.remove('wrong', 'selected'); b.classList.remove('wrong', 'selected');
          g.sel = { en: null, cn: null };
          g.locked = false;
        }, 450);
      }
    }

    function finish() {
      clearInterval(clock);
      const secs = (Date.now() - g.start) / 1000;
      const key = 'match:' + book.id;
      const prevBest = state.best[key];
      const newBest = !prevBest || secs < prevBest;
      if (newBest) state.best[key] = secs;
      if (secs < 20) state.stats.fastMatch = true;
      const score = Math.max(10, Math.round(words.length * 8 + Math.max(0, 40 - secs) - g.mistakes * 4));
      addXP(score);
      save();
      go('result', {
        title: '连连看',
        correct: words.length - g.wrongSet.size,
        total: words.length,
        answered: words.length,
        score,
        wrong: Array.from(g.wrongSet).map((k) => words[k]),
        note: `⏱ 用时 ${secs.toFixed(1)} 秒，失误 ${g.mistakes} 次${newBest ? ' · 🎉 新纪录！' : `（最佳 ${prevBest.toFixed(1)}s）`}`,
        again: () => startMode('match'),
      });
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action="tile"]');
      if (el) tap(el.dataset.side, Number(el.dataset.k));
    };
    onKey = (e) => { if (e.key === 'Escape') go('home'); };
  }

  /* ======================= 字母拼拼 ======================= */
  function renderScramble({ words }) {
    const book = currentBook();
    const later = makeLater();
    const g = { i: 0, correct: 0, score: 0, wrong: [] };
    let s = null;

    function setup() {
      const w = words[g.i];
      const chars = Array.from(w.w);
      const letters = chars.filter((c) => /[A-Za-z]/.test(c)).map((c) => c.toLowerCase());
      const decoys = letters.length >= 8 ? 2 : letters.length >= 5 ? 1 : 0;
      const pool = letters.slice();
      for (let k = 0; k < decoys; k++) pool.push('abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]);
      let order = shuffle(pool);
      for (let t = 0; t < 10 && order.join('').startsWith(letters.join('')); t++) order = shuffle(pool);
      s = {
        w,
        decoys,
        slots: chars.map((c) => (/[A-Za-z]/.test(c)
          ? { want: c.toLowerCase(), ch: '', tile: null, hint: false, fixed: false }
          : { want: c, ch: c, tile: null, hint: false, fixed: true })),
        tiles: order.map((ch) => ({ ch, used: false })),
        stack: [],
        hints: 0,
        tries: 0,
        done: false,
        success: false,
        busy: false,
      };
    }

    function render() {
      const w = s.w;
      $app.innerHTML = `
        ${gameHead(g.i, words.length)}
        <section class="card prompt">
          <div class="prompt-label">点击字母，拼出单词${s.decoys ? `（有 ${s.decoys} 个多余字母）` : ''}</div>
          <div class="prompt-cn">${esc(w.cn)}</div>
          <div><span class="pos">${esc(w.pos)}</span>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''}</div>
          <div ${slotsAttrs(s.slots.length)} id="slots"></div>
        </section>
        <div class="letter-pool" id="pool"></div>
        <div class="row" style="margin-top:14px">
          <button class="btn ghost sm" data-action="undo">⌫ 撤销</button>
          <button class="btn ghost sm" data-action="hint">💡 提示</button>
          <span class="spacer"></span>
          ${speakBtn(w.w)}
        </div>
        <div id="fb"></div>`;
      draw();
    }

    function draw() {
      document.getElementById('slots').innerHTML = s.slots.map((sl, i) => {
        if (sl.fixed) return `<span class="slot space">${sl.want === ' ' ? '' : esc(sl.want)}</span>`;
        const look = s.done ? (s.success ? 'ok' : 'reveal') : '';
        const cls = ['slot', sl.ch ? 'filled' : '', sl.hint ? 'hint' : '', look].join(' ');
        const locked = !sl.ch || sl.hint || s.done;
        return `<button class="${cls}" data-action="slot" data-i="${i}" ${locked ? 'disabled' : ''} aria-label="第 ${i + 1} 格${sl.ch ? '：' + esc(sl.ch) : '，空'}">${esc(sl.ch)}</button>`;
      }).join('');
      document.getElementById('pool').innerHTML = s.tiles.map((t, k) =>
        `<button class="letter ${t.used ? 'used' : ''}" data-action="tile" data-k="${k}" ${t.used || s.done ? 'disabled' : ''} aria-label="字母 ${esc(t.ch)}">${esc(t.ch)}</button>`).join('');
    }

    function placeTile(k, i, hint = false) {
      if (i < 0) return;
      s.tiles[k].used = true;
      Object.assign(s.slots[i], { ch: s.tiles[k].ch, tile: k, hint });
      if (!hint) s.stack.push(i);
    }
    function unplace(i) {
      const sl = s.slots[i];
      if (!sl || sl.fixed || sl.tile == null) return;
      s.tiles[sl.tile].used = false;
      Object.assign(sl, { ch: '', tile: null, hint: false });
    }
    const firstEmpty = () => s.slots.findIndex((sl) => !sl.fixed && !sl.ch);

    function afterChange() {
      draw();
      if (s.slots.every((sl) => sl.fixed || sl.ch)) check();
    }

    function tapTile(k) {
      if (s.done || s.busy || s.tiles[k].used) return;
      placeTile(k, firstEmpty());
      sfx.flip();
      afterChange();
    }
    function tapSlot(i) {
      if (s.done || s.busy) return;
      const sl = s.slots[i];
      if (sl.fixed || sl.hint || !sl.ch) return;
      unplace(i);
      s.stack = s.stack.filter((x) => x !== i);
      draw();
    }
    function undo() {
      if (s.done || s.busy) return;
      while (s.stack.length) {
        const i = s.stack.pop();
        const sl = s.slots[i];
        if (sl.ch && !sl.hint) { unplace(i); break; }
      }
      draw();
    }

    function hint() {
      if (s.done || s.busy) return;
      const i = s.slots.findIndex((sl) => !sl.fixed && !sl.hint && sl.ch !== sl.want);
      if (i < 0) return;
      const want = s.slots[i].want;
      unplace(i);
      let k = s.tiles.findIndex((t) => !t.used && t.ch === want);
      if (k < 0) {
        // 需要的字母被放错了位置：优先从放错的格子里取回
        const holders = s.slots
          .map((sl, idx) => idx)
          .filter((idx) => { const sl = s.slots[idx]; return !sl.fixed && !sl.hint && sl.tile != null && s.tiles[sl.tile].ch === want; });
        unplace(holders.find((idx) => s.slots[idx].want !== want) ?? holders[0]);
        k = s.tiles.findIndex((t) => !t.used && t.ch === want);
      }
      placeTile(k, i, true);
      s.stack = s.stack.filter((x) => s.slots[x].ch && !s.slots[x].hint);
      s.hints++;
      if (s.hints >= s.slots.filter((sl) => !sl.fixed).length) return fail();
      afterChange();
    }

    function check() {
      if (s.slots.every((sl) => sl.fixed || sl.ch === sl.want)) return success();
      s.tries++;
      sfx.bad();
      const box = document.getElementById('slots');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      if (s.tries >= 2) return fail();
      toast('顺序不对，再试一次！');
      s.busy = true;
      later(() => {
        s.slots.forEach((sl, i) => { if (!sl.hint) unplace(i); });
        s.stack = [];
        s.busy = false;
        draw();
      }, 550);
    }

    function success() {
      s.done = true;
      s.success = true;
      record(book, s.w, s.hints === 0 && s.tries === 0 ? 'good' : 'hard');
      const gain = Math.max(4, 14 - s.hints * 4 - s.tries * 3);
      g.score += gain;
      g.correct++;
      addXP(gain);
      sfx.good();
      speak(s.w.w);
      draw();
      document.getElementById('fb').innerHTML = `<div class="feedback good">
        <div class="feedback-text"><div class="feedback-title">✓ 拼对了 +${gain}</div>${wordDetail(s.w)}</div>
        <button class="btn good" data-action="next">下一个 ↵</button></div>`;
    }

    function fail() {
      s.done = true;
      s.success = false;
      record(book, s.w, 'again');
      g.wrong.push(s.w);
      s.slots.forEach((sl) => { if (!sl.fixed) sl.ch = sl.want; });
      sfx.bad();
      speak(s.w.w);
      draw();
      document.getElementById('fb').innerHTML = `<div class="feedback bad">
        <div class="feedback-text"><div class="feedback-title">✗ 正确拼写：</div>${wordDetail(s.w)}</div>
        <button class="btn bad" data-action="next">继续 ↵</button></div>`;
    }

    function next() {
      if (!s.done) return;
      g.i++;
      if (g.i >= words.length) {
        return go('result', { title: '字母拼拼', correct: g.correct, total: words.length, score: g.score, wrong: g.wrong, again: () => startMode('scramble') });
      }
      setup();
      render();
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'tile') tapTile(Number(el.dataset.k));
      else if (a === 'slot') tapSlot(Number(el.dataset.i));
      else if (a === 'undo') undo();
      else if (a === 'hint') hint();
      else if (a === 'next') next();
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (s.done) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); undo(); return; }
      if (/^[a-zA-Z]$/.test(e.key)) {
        const k = s.tiles.findIndex((t) => !t.used && t.ch === e.key.toLowerCase());
        if (k >= 0) tapTile(k);
      }
    };

    setup();
    render();
  }

  /* ======================= 60 秒挑战 ======================= */
  function renderBlitz() {
    const book = currentBook();
    const key = 'blitz:' + book.id;
    const TOTAL = 60000;
    const PENALTY = 3000;
    const prev = state.best[key];

    introScreen({
      icon: '⏱️',
      title: '60 秒挑战',
      rules: [
        '60 秒内尽可能多地答对题目',
        '英译中、中译英随机出现，也可以按 1–4 键作答',
        '答错扣 3 秒；连续答对，经验加成越高',
      ],
      best: prev != null ? `${book.name} · 最佳 ${prev} 题` : '',
      onStart: start,
    });

    function start() {
      const later = makeLater();
      const stream = wordStream(book);
      const g = { left: TOTAL, last: 0, count: 0, answered: 0, combo: 0, bestCombo: 0, xp: 0, wrong: [], q: null, lock: true, over: false };
      let raf = 0;
      onCleanup(() => cancelAnimationFrame(raf));

      $app.innerHTML = `
        <div class="game-head">
          <button class="icon-btn" data-action="quit" aria-label="退出">✕</button>
          <div class="bar"><i id="blitz-bar" style="width:100%; background: var(--warn)"></i></div>
          <span class="clock-wrap" id="clock-wrap"><span class="blitz-clock" id="clock">60.0</span></span>
          <span class="pill" title="答对题数">✅ <b id="count">0</b></span>
          <span class="combo" id="combo"></span>
        </div>
        <div id="blitz-q"></div>`;
      const clock = document.getElementById('clock');
      const bar = document.getElementById('blitz-bar');

      function nextQ() {
        if (g.over) return;
        const dir = Math.random() < 0.5 ? 'en2cn' : 'cn2en';
        const q = (g.q = buildQuestion(book, stream(), dir));
        document.getElementById('blitz-q').innerHTML = `
          <section class="card prompt compact">
            ${dir === 'en2cn'
              ? `<div class="prompt-label">选择中文释义</div><div class="prompt-word">${esc(q.w.w)}</div>${q.w.ph ? `<div class="phonetic">${esc(q.w.ph)}</div>` : ''}`
              : `<div class="prompt-label">选择英文单词</div><div class="prompt-cn">${esc(q.w.cn)}</div><div><span class="pos">${esc(q.w.pos)}</span></div>`}
          </section>
          ${optionsHtml(q)}`;
        g.lock = false;
      }

      function pick(idx) {
        if (g.lock || g.over) return;
        g.lock = true;
        const q = g.q;
        const ok = q.options[idx] === q.w;
        markOptions(q, idx);
        g.answered++;
        record(book, q.w, ok ? 'good' : 'again');
        if (ok) {
          g.count++;
          g.combo++;
          g.bestCombo = Math.max(g.bestCombo, g.combo);
          const gain = 4 + Math.min(g.combo, 6);
          g.xp += gain;
          addXP(gain);
          sfx.good();
          document.getElementById('count').textContent = g.count;
          later(nextQ, 250);
        } else {
          g.combo = 0;
          g.left -= PENALTY;
          if (!g.wrong.includes(q.w)) g.wrong.push(q.w);
          sfx.bad();
          const p = document.createElement('span');
          p.className = 'penalty';
          p.textContent = '-3s';
          document.getElementById('clock-wrap').appendChild(p);
          later(() => p.remove(), 900);
          later(nextQ, 800);
        }
        document.getElementById('combo').textContent = g.combo >= 2 ? `🔥x${g.combo}` : '';
      }

      function tick(now) {
        if (g.over) return;
        g.left -= Math.min(now - g.last, 100);
        g.last = now;
        const secs = Math.max(0, g.left) / 1000;
        clock.textContent = secs.toFixed(1);
        clock.classList.toggle('low', secs <= 10);
        bar.style.width = (Math.max(0, g.left) / TOTAL) * 100 + '%';
        if (g.left <= 0) finish();
        else raf = requestAnimationFrame(tick);
      }

      function finish() {
        g.over = true;
        const newBest = g.count > 0 && (prev == null || g.count > prev);
        if (newBest) state.best[key] = g.count;
        state.stats.bestBlitz = Math.max(state.stats.bestBlitz || 0, g.count);
        state.stats.bestCombo = Math.max(state.stats.bestCombo, g.bestCombo);
        save();
        go('result', {
          title: '60 秒挑战',
          correct: g.count,
          total: g.answered,
          score: g.xp,
          bestCombo: g.bestCombo,
          wrong: g.wrong,
          stars: g.count >= 20 ? 3 : g.count >= 12 ? 2 : g.count >= 6 ? 1 : 0,
          note: `⏱ 60 秒答对 ${g.count} 题${newBest ? ' · 🎉 新纪录！' : prev != null ? `（最佳 ${prev} 题）` : ''}`,
          again: () => startMode('blitz'),
        });
      }

      $app.onclick = (e) => {
        if (quitHandler(e)) return;
        const el = e.target.closest('[data-action="pick"]');
        if (el) pick(Number(el.dataset.idx));
      };
      onKey = (e) => {
        if (e.key === 'Escape') return go('home');
        if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key) - 1); }
      };

      nextQ();
      raf = requestAnimationFrame((now) => { g.last = now; tick(now); });
    }
  }

  /* ======================= 单词雨 ======================= */
  function renderRain() {
    const book = currentBook();
    const key = 'rain:' + book.id;
    const prev = state.best[key];

    introScreen({
      icon: '🌧️',
      title: '单词雨',
      rules: [
        '中文释义会像雨滴一样落下，下面提示首字母和字母个数',
        '在它落地之前输入对应的英文单词，拼对就会消除',
        '每消除 6 个进入下一波，雨越下越快；漏掉 3 个游戏结束',
      ],
      best: prev != null ? `${book.name} · 最高 ${prev} 分` : '',
      onStart: start,
    });

    function start() {
      const later = makeLater();
      const stream = wordStream(book);
      const g = { lives: 3, score: 0, pops: 0, misses: 0, level: 1, xp: 0, drops: [], wrong: [], last: 0, spawnIn: 0, paused: false, over: false, noteEl: null };
      let raf = 0;
      const onVis = () => { if (document.hidden) setPaused(true); };
      document.addEventListener('visibilitychange', onVis);
      onCleanup(() => {
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
      });

      $app.innerHTML = `
        <div class="game-head">
          <button class="icon-btn" data-action="quit" aria-label="退出">✕</button>
          <span class="hearts" id="hearts" aria-label="生命值">❤️❤️❤️</span>
          <span class="spacer"></span>
          <span class="pill">第 <b id="lvl">1</b> 波</span>
          <span class="pill">得分 <b id="score">0</b></span>
          <button class="icon-btn" data-action="pause" id="pause-btn" aria-label="暂停">⏸</button>
        </div>
        <div class="rain-field" id="field">
          <div class="rain-ground"></div>
          <button class="rain-pause" id="pause-cover" data-action="resume" hidden>⏸ 已暂停，点击继续</button>
        </div>
        <input id="rain-input" class="spell-input rain-input" type="text" autocomplete="off" autocapitalize="off"
          autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="看释义，输入英文单词" aria-label="输入英文单词" />`;
      const field = document.getElementById('field');
      const input = document.getElementById('rain-input');
      const scoreEl = document.getElementById('score');
      const lvlEl = document.getElementById('lvl');
      const heartsEl = document.getElementById('hearts');

      const fallTime = () => Math.max(5000, 12000 - (g.level - 1) * 1200);
      const spawnGap = () => Math.max(1000, 2800 - (g.level - 1) * 300);
      const maxDrops = () => Math.min(2 + g.level, 6);
      const shortCn = (w) => senses(w.cn)[0] || w.cn;

      function spawn() {
        let w = null;
        for (let t = 0; t < 6 && !w; t++) {
          const c = stream();
          if (!g.drops.some((d) => d.w === c)) w = c;
        }
        if (!w) return;
        const el = document.createElement('div');
        el.className = 'drop';
        const hint = w.w.charAt(0) + w.w.slice(1).replace(/[A-Za-z]/g, '_');
        el.innerHTML = `<span class="drop-cn">${esc(shortCn(w))}</span><span class="drop-hint">${esc(hint)}</span>`;
        field.appendChild(el);
        const h = el.offsetHeight;
        const x = 6 + Math.random() * Math.max(0, field.clientWidth - el.offsetWidth - 12);
        el.style.left = x + 'px';
        const d = { w, el, h, y: -h, speed: (field.clientHeight + h) / fallTime() };
        el.style.transform = `translateY(${d.y}px)`;
        g.drops.push(d);
      }

      function removeDrop(d, cls) {
        g.drops = g.drops.filter((x) => x !== d);
        d.el.style.setProperty('--y', d.y + 'px');
        d.el.classList.remove('target');
        d.el.classList.add(cls);
        later(() => d.el.remove(), 450);
      }

      function note(text) {
        if (g.noteEl) g.noteEl.remove();
        const n = (g.noteEl = document.createElement('div'));
        n.className = 'rain-note';
        n.textContent = text;
        field.appendChild(n);
        later(() => n.remove(), 2200);
      }

      function banner(text) {
        const b = document.createElement('div');
        b.className = 'rain-banner';
        b.textContent = text;
        field.appendChild(b);
        later(() => b.remove(), 1300);
        tone([523, 784], 0.1);
      }

      function miss(d) {
        removeDrop(d, 'missed');
        g.misses++;
        g.lives--;
        record(book, d.w, 'again');
        if (!g.wrong.includes(d.w)) g.wrong.push(d.w);
        sfx.bad();
        const lives = Math.max(0, g.lives);
        heartsEl.textContent = '❤️'.repeat(lives) + '🤍'.repeat(3 - lives);
        note(`${d.w.w} = ${shortCn(d.w)}`);
        if (g.lives <= 0) gameOver();
      }

      function onType() {
        input.classList.remove('wrong');
        if (g.over || g.paused) return;
        const val = normalize(input.value);
        let hit = null;
        for (const d of g.drops) {
          const target = normalize(d.w.w);
          d.el.classList.toggle('target', val.length > 0 && target.startsWith(val));
          if (val && target === val) hit = d;
        }
        if (!hit) return;
        input.value = '';
        g.drops.forEach((d) => d.el.classList.remove('target'));
        removeDrop(hit, 'popped');
        g.pops++;
        g.score += 10 + (g.level - 1) * 5;
        const gain = 4 + g.level;
        g.xp += gain;
        addXP(gain);
        record(book, hit.w, 'good');
        sfx.good();
        speak(hit.w.w);
        scoreEl.textContent = g.score;
        const level = 1 + Math.floor(g.pops / 6);
        if (level > g.level) {
          g.level = level;
          lvlEl.textContent = level;
          banner(`第 ${level} 波！`);
        }
      }

      function setPaused(p) {
        if (g.over || g.paused === p) return;
        g.paused = p;
        document.getElementById('pause-cover').hidden = !p;
        const btn = document.getElementById('pause-btn');
        btn.textContent = p ? '▶' : '⏸';
        btn.setAttribute('aria-label', p ? '继续' : '暂停');
        input.disabled = p;
        if (!p) input.focus();
      }

      function frame(now) {
        if (g.over) return;
        const dt = Math.min(now - g.last, 50);
        g.last = now;
        if (!g.paused) {
          g.spawnIn -= dt;
          if (g.spawnIn <= 0 && g.drops.length < maxDrops()) {
            spawn();
            g.spawnIn = spawnGap();
          }
          const floor = field.clientHeight - 10;
          for (const d of g.drops.slice()) {
            d.y += d.speed * dt;
            d.el.style.transform = `translateY(${d.y}px)`;
            if (d.y + d.h >= floor) miss(d);
            if (g.over) return;
          }
        }
        raf = requestAnimationFrame(frame);
      }

      function gameOver() {
        g.over = true;
        cancelAnimationFrame(raf);
        input.disabled = true;
        const newBest = g.score > 0 && (prev == null || g.score > prev);
        if (newBest) state.best[key] = g.score;
        state.stats.bestRainLevel = Math.max(state.stats.bestRainLevel || 0, g.level);
        save();
        later(() => go('result', {
          title: '单词雨',
          correct: g.pops,
          total: g.pops + g.misses,
          correctLabel: '消除',
          score: g.xp,
          wrong: g.wrong,
          stars: g.pops >= 25 ? 3 : g.pops >= 15 ? 2 : g.pops >= 6 ? 1 : 0,
          note: `🌊 坚持到第 ${g.level} 波，得分 ${g.score}${newBest ? ' · 🎉 新纪录！' : prev != null ? `（最高 ${prev} 分）` : ''}`,
          again: () => startMode('rain'),
        }), 900);
      }

      $app.onclick = (e) => {
        if (quitHandler(e)) return;
        const el = e.target.closest('[data-action]');
        if (el && el.dataset.action === 'pause') { setPaused(!g.paused); return; }
        if (el && el.dataset.action === 'resume') { setPaused(false); return; }
        if (!g.paused && !g.over && e.target.closest('#field')) input.focus();
      };
      onKey = (e) => { if (e.key === 'Escape') go('home'); };
      input.addEventListener('input', onType);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!input.value.trim()) return;
        sfx.bad();
        input.classList.remove('wrong');
        void input.offsetWidth;
        input.classList.add('wrong');
        input.value = '';
        g.drops.forEach((d) => d.el.classList.remove('target'));
      });

      input.focus();
      raf = requestAnimationFrame((now) => { g.last = now; frame(now); });
    }
  }


  /* ======================= 连词成句 ======================= */
  function renderSentence({ words }) {
    const book = currentBook();
    const later = makeLater();
    const g = { i: 0, correct: 0, score: 0, wrong: [] };
    let s = null;

    function setup() {
      const w = words[g.i];
      const { tokens, end } = sentenceParts(w.ex);
      const hit = findInSentence(w);
      const keyForm = hit ? hit.form.toLowerCase() : '';
      const chips = tokens.map((t) => ({ t, used: false, key: !!keyForm && t.replace(/[^A-Za-z]/g, '').toLowerCase() === keyForm }));
      let order = shuffle(chips);
      for (let n = 0; n < 10 && order.map((c) => c.t).join(' ') === tokens.join(' '); n++) order = shuffle(chips);
      s = { w, tokens, end, chips: order, answer: [], locked: 0, hints: 0, tries: 0, done: false, success: false, busy: false };
    }

    function render() {
      $app.innerHTML = `
        ${gameHead(g.i, words.length)}
        <section class="card prompt">
          <div class="prompt-label">连词成句：按中文意思排好单词</div>
          <div class="cloze-cn">${esc(s.w.exCn)}</div>
          <div class="sentence-answer" id="answer"></div>
          <div class="muted small">本题单词：<b class="key-word">${esc(s.w.w)}</b> ${esc(s.w.cn)}</div>
        </section>
        <div class="chip-pool" id="pool"></div>
        <div class="row" style="margin-top:14px">
          <button class="btn ghost sm" data-action="undo">⌫ 撤销</button>
          <button class="btn ghost sm" data-action="clear">清空</button>
          <button class="btn ghost sm" data-action="hint">💡 提示</button>
        </div>
        <div id="fb"></div>`;
      draw();
    }

    function draw() {
      const full = s.answer.length === s.chips.length;
      document.getElementById('answer').innerHTML = s.answer.length
        ? s.answer.map((ci, pos) => {
            const c = s.chips[ci];
            const look = s.done ? (s.success ? 'ok' : 'reveal') : '';
            const cls = ['chip', c.key ? 'key' : '', pos < s.locked ? 'hint' : '', look].join(' ');
            const locked = pos < s.locked || s.done;
            return `<button class="${cls}" data-action="unpick" data-pos="${pos}" ${locked ? 'disabled' : ''}>${esc(c.t)}</button>`;
          }).join('') + (full ? `<span class="sentence-end">${esc(s.end)}</span>` : '')
        : '<span class="muted small">点下面的单词，按顺序组成句子</span>';
      document.getElementById('pool').innerHTML = s.chips.map((c, ci) =>
        `<button class="chip ${c.key ? 'key' : ''} ${c.used ? 'used' : ''}" data-action="pick" data-ci="${ci}" ${c.used || s.done ? 'disabled' : ''}>${esc(c.t)}</button>`).join('');
    }

    function removeFrom(p) {
      for (const ci of s.answer.slice(p)) s.chips[ci].used = false;
      s.answer.length = p;
    }
    const firstWrong = () => {
      let p = 0;
      while (p < s.answer.length && s.chips[s.answer[p]].t === s.tokens[p]) p++;
      return p;
    };

    function pick(ci) {
      if (s.done || s.busy || s.chips[ci].used) return;
      s.chips[ci].used = true;
      s.answer.push(ci);
      sfx.flip();
      draw();
      if (s.answer.length === s.chips.length) check();
    }
    function unpick(pos) {
      if (s.done || s.busy || pos < s.locked || pos >= s.answer.length) return;
      const [ci] = s.answer.splice(pos, 1);
      s.chips[ci].used = false;
      draw();
    }
    function undo() {
      if (s.answer.length > s.locked) unpick(s.answer.length - 1);
    }
    function clearAll() {
      if (s.done || s.busy) return;
      removeFrom(s.locked);
      draw();
    }

    function hint() {
      if (s.done || s.busy) return;
      const p = firstWrong();
      removeFrom(p);
      const ci = s.chips.findIndex((c) => !c.used && c.t === s.tokens[p]);
      s.chips[ci].used = true;
      s.answer.push(ci);
      s.locked = p + 1;
      s.hints++;
      draw();
      if (s.hints >= s.tokens.length) return fail();
      if (s.answer.length === s.chips.length) check();
    }

    function check() {
      const p = firstWrong();
      if (p === s.tokens.length) return success();
      s.tries++;
      sfx.bad();
      restartAnim(document.getElementById('answer'), 'shake');
      if (s.tries >= 2) return fail();
      toast(p > 0 ? `前 ${p} 个词是对的，再排排后面的` : '顺序不对，再试一次！', 2200);
      s.busy = true;
      later(() => {
        removeFrom(Math.max(p, s.locked));
        s.busy = false;
        draw();
      }, 650);
    }

    function success() {
      s.done = true;
      s.success = true;
      record(book, s.w, s.hints === 0 && s.tries === 0 ? 'good' : 'hard');
      const gain = Math.max(4, 16 - s.hints * 3 - s.tries * 4);
      g.score += gain;
      g.correct++;
      addXP(gain);
      sfx.good();
      speak(s.w.ex);
      draw();
      document.getElementById('fb').innerHTML = `<div class="feedback good">
        <div class="feedback-text"><div class="feedback-title">✓ 句子排对了 +${gain}</div>
          <div class="example">${esc(s.w.ex)} ${speakBtn(s.w.ex)}</div>${wordDetail(s.w, false)}</div>
        <button class="btn good" data-action="next">下一句 ↵</button></div>`;
    }

    function fail() {
      s.done = true;
      s.success = false;
      record(book, s.w, 'again');
      g.wrong.push(s.w);
      s.chips.forEach((c) => { c.used = false; });
      s.answer = s.tokens.map((t) => {
        const ci = s.chips.findIndex((c) => !c.used && c.t === t);
        s.chips[ci].used = true;
        return ci;
      });
      sfx.bad();
      speak(s.w.ex);
      draw();
      document.getElementById('fb').innerHTML = `<div class="feedback bad">
        <div class="feedback-text"><div class="feedback-title">✗ 正确的句子是：</div>
          <div class="example">${esc(s.w.ex)} ${speakBtn(s.w.ex)}</div>${wordDetail(s.w, false)}</div>
        <button class="btn bad" data-action="next">继续 ↵</button></div>`;
    }

    function next() {
      if (!s.done) return;
      g.i++;
      if (g.i >= words.length) {
        return go('result', { title: '连词成句', correct: g.correct, total: words.length, score: g.score, wrong: g.wrong, again: () => startMode('sentence') });
      }
      setup();
      render();
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'pick') pick(Number(el.dataset.ci));
      else if (a === 'unpick') unpick(Number(el.dataset.pos));
      else if (a === 'undo') undo();
      else if (a === 'clear') clearAll();
      else if (a === 'hint') hint();
      else if (a === 'next') next();
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (s.done) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    };

    setup();
    render();
  }

  /* ======================= 单词打地鼠 ======================= */
  function renderWhack() {
    const book = currentBook();
    const key = 'whack:' + book.id;
    const prev = state.best[key];
    const TOTAL = 45000;

    introScreen({
      icon: '🔨',
      title: '单词打地鼠',
      rules: [
        '上方显示一个中文意思，地鼠会举着英文单词冒出来',
        '找到意思对的那只，点它！电脑上也可以按 1–9 键',
        '45 秒内打中越多越好；打错了锤子会晕 1 秒',
      ],
      best: prev != null ? `${book.name} · 最佳 ${prev} 只` : '',
      onStart: start,
    });

    function start() {
      const later = makeLater();
      const stream = wordStream(book);
      const g = { left: TOTAL, last: 0, hits: 0, misses: 0, combo: 0, bestCombo: 0, xp: 0, wrong: [], target: null, targetFailed: false, sinceTarget: 0, seq: 0, stunUntil: 0, over: false };
      const holes = Array.from({ length: 9 }, () => ({ w: null, up: false, busy: false, id: 0 }));
      let raf = 0;
      onCleanup(() => cancelAnimationFrame(raf));

      $app.innerHTML = `
        <div class="game-head">
          <button class="icon-btn" data-action="quit" aria-label="退出">✕</button>
          <div class="bar"><i id="whack-bar" style="width:100%; background: var(--warn)"></i></div>
          <span class="blitz-clock" id="clock">45.0</span>
          <span class="pill" title="打中个数">🔨 <b id="hits">0</b></span>
        </div>
        <section class="card whack-target" id="target"></section>
        <div class="whack-grid" id="grid">
          ${holes.map((h, i) => `<button class="hole" data-action="hole" data-i="${i}" aria-label="第 ${i + 1} 个洞">
            <span class="hole-key">${i + 1}</span>
            <span class="mole"><span class="mole-word"></span><span class="mole-face">🐹</span></span>
            <span class="dirt"></span>
          </button>`).join('')}
        </div>
        <div class="whack-note" id="note" aria-live="polite"></div>`;
      const grid = document.getElementById('grid');
      const clock = document.getElementById('clock');
      const bar = document.getElementById('whack-bar');
      const holeEl = (i) => grid.children[i];
      const visible = (w) => holes.some((h) => h.up && h.w === w);
      const stayTime = () => Math.max(1100, 2100 - g.hits * 40);
      const gapTime = () => Math.max(420, 850 - g.hits * 18);

      function hideHole(i) {
        const h = holes[i];
        h.up = false;
        h.id = ++g.seq;
        holeEl(i).classList.remove('up');
      }

      function setTarget() {
        let w = stream();
        if (w === g.target) w = stream();
        g.target = w;
        g.targetFailed = false;
        g.sinceTarget = 99;
        // 意思相近的地鼠先缩回去，免得两只都“对”
        holes.forEach((h, i) => { if (h.up && h.w !== w && meaningOverlap(h.w, w)) hideHole(i); });
        document.getElementById('target').innerHTML = `
          <div class="prompt-label">🎯 打中这个意思的单词</div>
          <div class="prompt-cn">${esc(w.cn)}</div>
          <div><span class="pos">${esc(w.pos)}</span><span class="combo" id="combo">${g.combo >= 2 ? `🔥x${g.combo}` : ''}</span></div>`;
      }

      function pop() {
        if (g.over) return;
        const free = holes.map((h, i) => i).filter((i) => !holes[i].up && !holes[i].busy);
        if (!free.length) return;
        const i = free[Math.floor(Math.random() * free.length)];
        let w = null;
        if (!visible(g.target) && (g.sinceTarget >= 2 || Math.random() < 0.4)) {
          w = g.target;
        } else {
          const pool = book.words.filter((x) => x !== g.target && !visible(x) && !meaningOverlap(x, g.target));
          if (pool.length) w = pool[Math.floor(Math.random() * pool.length)];
          else if (!visible(g.target)) w = g.target;
          else return;
        }
        g.sinceTarget = w === g.target ? 0 : g.sinceTarget + 1;
        const h = holes[i];
        Object.assign(h, { w, up: true, id: ++g.seq });
        const el = holeEl(i);
        el.querySelector('.mole-face').textContent = '🐹';
        const label = el.querySelector('.mole-word');
        label.textContent = w.w;
        label.classList.toggle('long', w.w.length > 9);
        el.classList.remove('bonk', 'oops');
        el.classList.add('up');
        const id = h.id;
        later(() => { if (h.id === id && h.up) hideHole(i); }, stayTime());
      }

      function loop() {
        if (g.over) return;
        pop();
        later(loop, gapTime());
      }

      function knock(i, cls, face) {
        const h = holes[i];
        const el = holeEl(i);
        h.up = false;
        h.busy = true;
        h.id = ++g.seq;
        el.querySelector('.mole-face').textContent = face;
        el.classList.add(cls);
        later(() => { el.classList.remove('up', cls); h.busy = false; }, 420);
      }

      function note(text, ok) {
        const n = document.getElementById('note');
        n.textContent = text;
        n.className = 'whack-note ' + (ok ? 'ok' : 'bad');
      }

      function tap(i) {
        if (g.over) return;
        const h = holes[i];
        if (!h.up || h.busy || performance.now() < g.stunUntil) return;
        if (h.w === g.target) {
          g.hits++;
          g.combo++;
          g.bestCombo = Math.max(g.bestCombo, g.combo);
          const gain = 3 + Math.min(g.combo, 5);
          g.xp += gain;
          addXP(gain);
          if (!g.targetFailed) record(book, g.target, 'good');
          sfx.good();
          speak(h.w.w);
          knock(i, 'bonk', '😵');
          document.getElementById('hits').textContent = g.hits;
          note(`✓ ${h.w.w} = ${shortMeaning(h.w)}`, true);
          setTarget();
          later(pop, 200);
        } else {
          g.misses++;
          g.combo = 0;
          if (!g.targetFailed) {
            g.targetFailed = true;
            record(book, g.target, 'again');
            if (!g.wrong.includes(g.target)) g.wrong.push(g.target);
          }
          sfx.bad();
          knock(i, 'oops', '😝');
          note(`✗ ${h.w.w} 是「${shortMeaning(h.w)}」`, false);
          g.stunUntil = performance.now() + 1000;
          grid.classList.add('stunned');
          later(() => grid.classList.remove('stunned'), 1000);
          const combo = document.getElementById('combo');
          if (combo) combo.textContent = '';
        }
      }

      function tick(now) {
        if (g.over) return;
        g.left -= Math.min(now - g.last, 100);
        g.last = now;
        const secs = Math.max(0, g.left) / 1000;
        clock.textContent = secs.toFixed(1);
        clock.classList.toggle('low', secs <= 10);
        bar.style.width = (Math.max(0, g.left) / TOTAL) * 100 + '%';
        if (g.left <= 0) finish();
        else raf = requestAnimationFrame(tick);
      }

      function finish() {
        g.over = true;
        const newBest = g.hits > 0 && (prev == null || g.hits > prev);
        if (newBest) state.best[key] = g.hits;
        state.stats.bestWhack = Math.max(state.stats.bestWhack || 0, g.hits);
        state.stats.bestCombo = Math.max(state.stats.bestCombo, g.bestCombo);
        save();
        go('result', {
          title: '单词打地鼠',
          correct: g.hits,
          total: g.hits + g.misses,
          correctLabel: '打中',
          score: g.xp,
          bestCombo: g.bestCombo,
          wrong: g.wrong,
          stars: g.hits >= 20 ? 3 : g.hits >= 12 ? 2 : g.hits >= 6 ? 1 : 0,
          note: `🔨 45 秒打中 ${g.hits} 只${newBest ? ' · 🎉 新纪录！' : prev != null ? `（最佳 ${prev} 只）` : ''}`,
          again: () => startMode('whack'),
        });
      }

      $app.onclick = (e) => {
        if (quitHandler(e)) return;
        const el = e.target.closest('[data-action="hole"]');
        if (el) tap(Number(el.dataset.i));
      };
      onKey = (e) => {
        if (e.key === 'Escape') return go('home');
        if (/^[1-9]$/.test(e.key)) { e.preventDefault(); tap(Number(e.key) - 1); }
      };

      setTarget();
      later(pop, 300);
      later(loop, 700);
      raf = requestAnimationFrame((now) => { g.last = now; tick(now); });
    }
  }

  /* ======================= 单词闯关 ======================= */
  const ADV_MONSTERS = [
    { icon: '🦇', name: '蝙蝠', place: '蝙蝠洞' },
    { icon: '🐍', name: '毒蛇', place: '毒蛇林' },
    { icon: '🐺', name: '野狼', place: '野狼谷' },
    { icon: '👻', name: '幽灵', place: '幽灵古堡' },
    { icon: '🧟', name: '僵尸', place: '僵尸墓地' },
    { icon: '🦂', name: '巨蝎', place: '沙漠遗迹' },
    { icon: '🕷️', name: '毒蛛', place: '蛛网深渊' },
    { icon: '🐊', name: '鳄鱼', place: '迷雾沼泽' },
  ];
  const ADV_BOSSES = {
    primary: { icon: '🦖', name: '霸王龙', place: '恐龙岛' },
    junior: { icon: '🐙', name: '深海巨章', place: '深海神殿' },
    senior: { icon: '👹', name: '赤鬼王', place: '赤鬼城' },
    cet6: { icon: '🧙', name: '黑暗巫师', place: '暗影高塔' },
    kaoyan: { icon: '🐉', name: '远古巨龙', place: '巨龙之巅' },
  };
  const STAGE_SIZE = 10;

  // 每 10 个词一关，词数够 20 个时最后加一个 BOSS 关（题目来自整本词库）
  function advStages(book) {
    const n = book.words.length;
    const count = Math.max(1, Math.ceil(n / STAGE_SIZE));
    const stages = [];
    for (let i = 0; i < count; i++) {
      const m = ADV_MONSTERS[i % ADV_MONSTERS.length];
      stages.push({ idx: i, boss: false, icon: m.icon, name: m.name, place: m.place, words: book.words.slice(i * STAGE_SIZE, (i + 1) * STAGE_SIZE), hp: 90 + i * 10 });
    }
    if (n >= 2 * STAGE_SIZE) {
      const b = ADV_BOSSES[book.id] || { icon: '🐲', name: '神秘飞龙', place: '云中城' };
      stages.push({ idx: count, boss: true, icon: b.icon, name: b.name, place: b.place, words: book.words, hp: 240 });
    }
    return stages;
  }
  function advProgress(book) {
    if (!state.adventure || typeof state.adventure !== 'object') state.adventure = {};
    if (!Array.isArray(state.adventure[book.id])) state.adventure[book.id] = [];
    return state.adventure[book.id];
  }
  const advUnlocked = (prog, i) => i === 0 || (prog[i - 1] || 0) > 0;

  function adventureBanner(book) {
    const stages = advStages(book);
    const prog = advProgress(book);
    const cleared = stages.filter((st) => (prog[st.idx] || 0) > 0).length;
    const stars = stages.reduce((sum, st) => sum + (prog[st.idx] || 0), 0);
    const last = stages[stages.length - 1];
    return `<button class="adv-banner" data-action="mode" data-id="adventure">
      <span class="adv-art" aria-hidden="true">${last.icon}</span>
      <span class="adv-body">
        <span class="adv-title">单词闯关</span>
        <span class="adv-desc">答对就攻击怪物，一关关打到 BOSS</span>
        <span class="adv-meta">${esc(book.name)} · 已通关 ${cleared}/${stages.length} · ⭐ ${stars}/${stages.length * 3}</span>
      </span>
      <span class="adv-go">出发 →</span>
      ${state.seenModes.includes('adventure') ? '' : '<span class="badge new">新</span>'}
    </button>`;
  }

  function renderAdventure() {
    const book = currentBook();
    const stages = advStages(book);
    const prog = advProgress(book);
    const cleared = stages.filter((st) => (prog[st.idx] || 0) > 0).length;
    const stars = stages.reduce((sum, st) => sum + (prog[st.idx] || 0), 0);
    $app.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <button class="icon-btn" data-action="quit" aria-label="返回首页">←</button>
        <h2>⚔️ 单词闯关</h2>
      </div>
      <section class="card adv-summary">
        <div class="row"><b>${book.icon} ${esc(book.name)}</b><span class="spacer"></span><span class="pill">⭐ ${stars} / ${stages.length * 3}</span></div>
        <div class="muted small">已通关 ${cleared} / ${stages.length} 关</div>
        <div class="bar"><i style="width:${(cleared / stages.length) * 100}%"></i></div>
      </section>
      <ol class="stage-path">
        ${stages.map((st) => {
          const got = prog[st.idx] || 0;
          const open = advUnlocked(prog, st.idx);
          const current = open && !got;
          return `<li><button class="stage ${st.boss ? 'boss' : ''} ${current ? 'current' : ''}" data-action="stage" data-i="${st.idx}" ${open ? '' : 'disabled'}>
            <span class="stage-icon">${open ? st.icon : '🔒'}</span>
            <span class="stage-text">
              <b>${st.boss ? '👑 BOSS · ' : `第 ${st.idx + 1} 关 · `}${esc(st.place)}</b>
              <span class="muted small">${st.boss ? `整本 ${st.words.length} 词` : `${st.words.length} 个单词`} · ${esc(st.name)} · 生命 ${st.hp}</span>
            </span>
            <span class="stage-stars" aria-label="${got} 星">${open ? '★'.repeat(got) + '☆'.repeat(3 - got) : ''}</span>
          </button></li>`;
        }).join('')}
      </ol>
      <p class="muted small">答对一题就攻击一次，连续答对伤害更高，偶尔还会暴击。答错会被怪物反击，3 颗心用完就失败。通关时剩几颗心，就得几颗星。</p>`;

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action="stage"]');
      if (el && !el.disabled) go('stage', { idx: Number(el.dataset.i) });
    };
    onKey = (e) => { if (e.key === 'Escape') go('home'); };
  }

  function renderStage({ idx }) {
    const book = currentBook();
    const st = advStages(book)[idx];
    if (!st || !advUnlocked(advProgress(book), idx)) return go('adventure');
    $app.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <button class="icon-btn" data-action="map" aria-label="返回地图">←</button>
        <h2>${st.boss ? '👑 BOSS 关' : `第 ${idx + 1} 关`} · ${esc(st.place)}</h2>
      </div>
      <section class="card intro">
        <div class="intro-icon">${st.icon}</div>
        <h2>${esc(st.name)}</h2>
        <div class="muted">生命 ${st.hp} · ${st.boss ? `题目来自整本「${esc(book.name)}」` : '先认识本关的单词，再开始战斗'}</div>
        <button class="btn" data-action="fight">⚔️ 开始战斗 ↵</button>
      </section>
      ${st.boss ? '' : `<section class="section">
        <h2 class="section-title">📜 本关单词（${st.words.length}）</h2>
        <div class="stage-words">${st.words.map((w) => `<div class="word-item">
          <div class="main"><div class="w">${esc(w.w)} <span class="phonetic small">${esc(w.ph)}</span></div>
          <div class="m"><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div></div>
          ${speakBtn(w.w)}</div>`).join('')}</div>
      </section>`}`;

    $app.onclick = (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'map') go('adventure');
      else if (a === 'fight') go('battle', { idx });
      else if (a === 'speak') speak(el.dataset.w);
    };
    onKey = (e) => {
      if (e.key === 'Escape') go('adventure');
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); go('battle', { idx }); }
    };
  }

  function renderBattle({ idx }) {
    const book = currentBook();
    const st = advStages(book)[idx];
    const prog = advProgress(book);
    if (!st || !advUnlocked(prog, idx)) return go('adventure');
    const later = makeLater();
    const stream = wordStream(book, st.words);
    const g = { hp: st.hp, hearts: 3, combo: 0, bestCombo: 0, correct: 0, asked: 0, xp: 0, wrong: [], q: null, answered: true, ended: false, auto: 0 };
    const dirsFor = (w) => {
      const d = ['en2cn', 'cn2en'];
      if (w.exCn && findInSentence(w)) d.push('cloze');
      if (canSpeak && state.sound) d.push('listen');
      return d;
    };

    $app.innerHTML = `
      <div class="game-head">
        <button class="icon-btn" data-action="map" aria-label="返回地图">✕</button>
        <span class="hearts" id="hearts" aria-label="生命值">❤️❤️❤️</span>
        <span class="spacer"></span>
        <span class="combo" id="combo"></span>
        <span class="pill">${st.boss ? '👑 BOSS' : `第 ${idx + 1} 关`}</span>
      </div>
      <section class="card battle" id="battle">
        <div class="monster" id="monster">${st.icon}</div>
        <div class="battle-info">
          <div class="battle-name">${esc(st.name)}</div>
          <div class="bar hp"><i id="hp-bar" style="width:100%"></i></div>
          <div class="small muted">生命 <b id="hp">${st.hp}</b> / ${st.hp}</div>
        </div>
      </section>
      <div id="battle-q"></div>`;

    function ask() {
      const w = stream();
      const dirs = dirsFor(w);
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      g.q = buildQuestion(book, w, dir);
      g.answered = false;
      document.getElementById('battle-q').innerHTML = `
        <section class="card prompt compact">${promptHtml(g.q)}</section>
        ${optionsHtml(g.q)}
        <div id="fb"></div>`;
      if (dir === 'listen') later(() => speak(w.w), 300);
    }

    function pick(idxOpt) {
      if (g.answered || g.ended) return;
      g.answered = true;
      const q = g.q;
      const ok = q.options[idxOpt] === q.w;
      const detail = revealAnswer(q, idxOpt, ok);
      record(book, q.w, ok ? 'good' : 'again');
      g.asked++;
      const fb = document.getElementById('fb');
      const mon = document.getElementById('monster');
      if (ok) {
        g.correct++;
        g.combo++;
        g.bestCombo = Math.max(g.bestCombo, g.combo);
        const crit = Math.random() < 0.15;
        const dmg = (10 + Math.min(g.combo - 1, 5) * 3) * (crit ? 2 : 1);
        g.hp = Math.max(0, g.hp - dmg);
        const gain = 8 + Math.min(g.combo - 1, 5) * 2;
        g.xp += gain;
        addXP(gain);
        sfx.good();
        restartAnim(mon, 'hit');
        const n = document.createElement('span');
        n.className = 'dmg' + (crit ? ' crit' : '');
        n.textContent = (crit ? '暴击 ' : '') + '-' + dmg;
        document.getElementById('battle').appendChild(n);
        later(() => n.remove(), 1000);
        document.getElementById('hp').textContent = g.hp;
        document.getElementById('hp-bar').style.width = (g.hp / st.hp) * 100 + '%';
        const won = g.hp <= 0;
        if (won) later(() => mon.classList.add('defeated'), 350);
        fb.innerHTML = `<div class="feedback good">
          <div class="feedback-text"><div class="feedback-title">⚔️ ${crit ? '暴击！' : '命中！'}造成 ${dmg} 点伤害${g.combo >= 2 ? ` · 连击 x${g.combo}` : ''}</div>${detail}</div>
          <button class="btn good" data-action="next">${won ? '胜利 →' : '继续 ↵'}</button></div>`;
        g.auto = later(next, won ? 1800 : q.dir === 'cloze' ? 2400 : 1300);
      } else {
        g.combo = 0;
        g.hearts--;
        if (!g.wrong.includes(q.w)) g.wrong.push(q.w);
        sfx.bad();
        restartAnim(mon, 'attack');
        restartAnim(document.getElementById('battle'), 'hurt');
        const lives = Math.max(0, g.hearts);
        document.getElementById('hearts').textContent = '❤️'.repeat(lives) + '🤍'.repeat(3 - lives);
        fb.innerHTML = `<div class="feedback bad">
          <div class="feedback-text"><div class="feedback-title">💥 ${esc(st.name)}反击了！正确答案：</div>${detail}</div>
          <button class="btn bad" data-action="next">${g.hearts <= 0 ? '查看结果' : '继续 ↵'}</button></div>`;
      }
      document.getElementById('combo').textContent = g.combo >= 2 ? `🔥x${g.combo}` : '';
    }

    function next() {
      clearTimeout(g.auto);
      if (!g.answered || g.ended) return;
      if (g.hp <= 0) return finish(true);
      if (g.hearts <= 0) return finish(false);
      ask();
    }

    function finish(win) {
      if (g.ended) return;
      g.ended = true;
      const stars = win ? Math.max(1, g.hearts) : 0;
      const before = prog[idx] || 0;
      let bonus = 0;
      if (win) {
        prog[idx] = Math.max(before, stars);
        bonus = st.boss ? 80 : 30;
        g.xp += bonus;
        addXP(bonus);
        if (st.boss) state.stats.bossWins = (state.stats.bossWins || 0) + 1;
      }
      state.stats.bestCombo = Math.max(state.stats.bestCombo, g.bestCombo);
      save();
      const nxt = win ? advStages(book)[idx + 1] : null;
      const buttons = win
        ? [
            ...(nxt ? [{ label: '下一关 →', fn: () => go('stage', { idx: nxt.idx }) }] : []),
            { label: '🔄 再打一次', fn: () => go('battle', { idx }), ghost: !!nxt },
            { label: '🗺️ 返回地图', fn: () => go('adventure'), ghost: true },
          ]
        : [
            { label: '🔄 再试一次', fn: () => go('battle', { idx }) },
            { label: '📜 复习本关单词', fn: () => go('stage', { idx }), ghost: true },
            { label: '🗺️ 返回地图', fn: () => go('adventure'), ghost: true },
          ];
      go('result', {
        title: `${st.place} · ${win ? '胜利' : '失败'}`,
        heading: win ? `${st.place} · 胜利！` : `${st.place} · 挑战失败`,
        emoji: win ? (st.boss ? '👑' : '🏆') : '💀',
        message: win
          ? (st.boss ? `你打败了${st.name}，「${book.name}」全部通关！` : `你打败了${st.name}！`)
          : `${st.name}还剩 ${g.hp} 点生命，复习一下再来挑战！`,
        correct: g.correct,
        total: g.asked,
        score: g.xp,
        bestCombo: g.bestCombo,
        wrong: g.wrong,
        stars,
        note: win ? `剩余 ${g.hearts} 颗心 · 通关奖励 +${bonus} 经验${before && stars > before ? ' · 刷新最佳' : ''}` : '',
        buttons,
        escape: () => go('adventure'),
      });
    }

    $app.onclick = (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'map') go('adventure');
      else if (a === 'speak') speak(el.dataset.w);
      else if (a === 'pick') pick(Number(el.dataset.idx));
      else if (a === 'next') next();
      else if (a === 'replay') speak(g.q.w.w);
      else if (a === 'slow') speak(g.q.w.w, 0.55);
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('adventure');
      if (!g.answered && /^[1-4]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key) - 1); }
      else if (g.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'r' && g.q && g.q.dir === 'listen') speak(g.q.w.w);
    };

    ask();
  }


  /* ======================= 对错快判 ======================= */
  function renderJudge() {
    const book = currentBook();
    const key = 'judge:' + book.id;
    const prev = state.best[key];

    introScreen({
      icon: '⚖️',
      title: '对错快判',
      rules: [
        '每题给出一个单词和一个中文意思，判断它们配不配',
        '点「对」或「错」；电脑上也可以按 → 和 ← 键',
        '答错或超时就结束，越往后时间越短，看你能连对几题',
      ],
      best: prev != null ? `${book.name} · 最佳连对 ${prev} 题` : '',
      onStart: start,
    });

    function start() {
      const later = makeLater();
      const stream = wordStream(book);
      const g = { streak: 0, xp: 0, q: null, left: 0, limit: 1, last: 0, lock: true, over: false, result: null };
      let raf = 0;
      onCleanup(() => cancelAnimationFrame(raf));

      $app.innerHTML = `
        <div class="game-head">
          <button class="icon-btn" data-action="quit" aria-label="退出">✕</button>
          <div class="bar"><i id="judge-bar" style="width:100%; background: var(--warn)"></i></div>
          <span class="pill" title="连续答对">🔥 <b id="streak">0</b></span>
        </div>
        <section class="card judge-card" id="card"></section>
        <div class="judge-buttons">
          <button class="btn judge-btn no" data-action="judge" data-v="0">✗ 错<span class="judge-key">←</span></button>
          <button class="btn judge-btn yes" data-action="judge" data-v="1">✓ 对<span class="judge-key">→</span></button>
        </div>
        <p class="judge-tip" id="tip" aria-live="polite"></p>`;
      const bar = document.getElementById('judge-bar');

      function nextQ() {
        if (g.over) return;
        const w = stream();
        let shown = w;
        if (Math.random() < 0.5) {
          // 错的意思：挑同词性、意思不重叠的另一个词，避免“错”的其实也对
          const others = shuffle(book.words.filter((x) => x !== w && x.cn !== w.cn && !meaningOverlap(x, w)));
          shown = others.find((x) => x.pos === w.pos) || others[0] || w;
        }
        g.q = { w, shown, truth: shown === w };
        g.limit = Math.max(2000, 5000 - g.streak * 100);
        g.left = g.limit;
        const card = document.getElementById('card');
        card.className = 'card judge-card';
        card.innerHTML = `
          <div class="prompt-word">${esc(w.w)}</div>
          <div>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>
          <div class="judge-eq">的意思是</div>
          <div class="judge-cn">${esc(shown.cn)}</div>`;
        bar.style.width = '100%';
        bar.style.background = 'var(--warn)';
        g.lock = false;
        speak(w.w);
      }

      // v: true = 对，false = 错，null = 超时
      function answer(v) {
        if (g.lock || g.over) return;
        g.lock = true;
        const q = g.q;
        const ok = v !== null && v === q.truth;
        record(book, q.w, ok ? 'hard' : 'again');
        if (ok) {
          g.streak++;
          const gain = 3 + (g.streak % 10 === 0 ? 10 : 0);
          g.xp += gain;
          addXP(gain);
          sfx.good();
          document.getElementById('streak').textContent = g.streak;
          if (g.streak % 10 === 0) toast(`🔥 连对 ${g.streak} 题！`);
          document.getElementById('card').classList.add('ok');
          later(nextQ, 260);
        } else {
          lose(v === null);
        }
      }

      function lose(timeout) {
        g.over = true;
        cancelAnimationFrame(raf);
        const q = g.q;
        sfx.bad();
        document.getElementById('card').classList.add('bad');
        const explain = q.truth
          ? `「${q.w.w}」的意思就是「${shortMeaning(q.w)}」`
          : `「${q.w.w}」的意思是「${shortMeaning(q.w)}」，不是「${shortMeaning(q.shown)}」`;
        const message = (timeout ? '⏰ 时间到！' : '✗ ') + explain;
        document.getElementById('tip').textContent = message;
        const newBest = g.streak > 0 && (prev == null || g.streak > prev);
        if (newBest) state.best[key] = g.streak;
        state.stats.bestJudge = Math.max(state.stats.bestJudge || 0, g.streak);
        save();
        g.result = {
          title: '对错快判',
          correct: g.streak,
          total: g.streak + 1,
          score: g.xp,
          wrong: [q.w],
          stars: g.streak >= 30 ? 3 : g.streak >= 15 ? 2 : g.streak >= 5 ? 1 : 0,
          message,
          note: `连续答对 ${g.streak} 题${newBest ? ' · 🎉 新纪录！' : prev != null ? `（最佳 ${prev} 题）` : ''}`,
          again: () => startMode('judge'),
        };
        later(() => go('result', g.result), 1600);
      }

      function tick(now) {
        if (g.over) return;
        if (!g.lock) {
          g.left -= Math.min(now - g.last, 100);
          const frac = Math.max(0, g.left / g.limit);
          bar.style.width = frac * 100 + '%';
          bar.style.background = frac < 0.3 ? 'var(--bad)' : 'var(--warn)';
          if (g.left <= 0) {
            answer(null);
            return;
          }
        }
        g.last = now;
        raf = requestAnimationFrame(tick);
      }

      $app.onclick = (e) => {
        if (quitHandler(e)) return;
        const el = e.target.closest('[data-action="judge"]');
        if (el) answer(el.dataset.v === '1');
      };
      onKey = (e) => {
        if (e.key === 'Escape') return go('home');
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowRight' || k === 'j') { e.preventDefault(); answer(true); }
        else if (e.key === 'ArrowLeft' || k === 'f') { e.preventDefault(); answer(false); }
      };

      nextQ();
      raf = requestAnimationFrame((now) => { g.last = now; tick(now); });
    }
  }


  /* ======================= 结算 ======================= */
  function renderResult(r) {
    const acc = r.total ? r.correct / r.total : 0;
    const stars = r.stars ?? (acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0);
    const emoji = r.emoji || ['😅', '🙂', '😄', '🤩'][stars];
    const msg = r.message || ['别灰心，多练几次就会了！', '不错的开始，继续加油！', '很棒！离掌握又近了一步！', '太厉害了！完美表现！'][stars];
    const buttons = r.buttons || [
      { label: '🔄 再来一局', fn: r.again, action: 'again' },
      { label: '🏠 返回首页', fn: () => go('home'), action: 'home', ghost: true },
    ];
    state.stats.games++;
    if (r.correct === r.total && r.total >= 5) state.stats.perfect++;
    save();
    checkAchievements();
    if (stars === 3) { confetti(); sfx.win(); }

    $app.innerHTML = `
      <section class="card result">
        <div class="result-emoji">${emoji}</div>
        <h2>${esc(r.heading || `${r.title} · 本局结束`)}</h2>
        <div class="stars" aria-label="${stars} 星">${'★'.repeat(stars)}<span class="muted">${'☆'.repeat(3 - stars)}</span></div>
        <p class="muted">${msg}</p>
        ${r.note ? `<p><b>${esc(r.note)}</b></p>` : ''}
        <div class="stat-grid">
          <div class="stat"><b>${r.correct}/${r.total}</b><span>${r.correctLabel || '答对'}</span></div>
          <div class="stat"><b>${Math.round(acc * 100)}%</b><span>正确率</span></div>
          <div class="stat"><b>+${r.score}</b><span>经验值</span></div>
        </div>
        ${r.bestCombo >= 2 ? `<p class="muted small">本局最高连击 🔥x${r.bestCombo}</p>` : ''}
        <div class="row" style="justify-content:center">
          ${buttons.map((b, i) => `<button class="btn ${b.ghost ? 'ghost' : ''}" data-action="${b.action || 'btn'}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </section>
      ${r.wrong.length ? `
        <section class="section">
          <h2 class="section-title">📕 本局需要加强的单词（已加入错题本）</h2>
          <div class="word-list">
            ${r.wrong.map((w) => `<div class="word-item">
              <div class="main"><div class="w">${esc(w.w)} <span class="phonetic small">${esc(w.ph)}</span></div>
              <div class="m"><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div></div>
              ${speakBtn(w.w)}</div>`).join('')}
          </div>
        </section>` : ''}`;

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-i]');
      if (el && buttons[Number(el.dataset.i)]) buttons[Number(el.dataset.i)].fn();
    };
    onKey = (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); buttons[0].fn(); }
      else if (e.key === 'Escape') (r.escape || (() => go('home')))();
    };
  }

  /* ======================= 单词表 ======================= */
  function renderWords() {
    const book = currentBook();
    let filter = 'all';
    let query = '';
    const status = (w) => {
      const p = prog(book, w);
      if (!p) return 'new';
      return p.box >= MASTER_BOX ? 'master' : 'learning';
    };

    $app.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <button class="icon-btn" data-action="quit" aria-label="返回">←</button>
        <h2>${book.icon} ${esc(book.name)} · 单词表</h2>
      </div>
      <input class="search" id="q" type="search" placeholder="搜索单词或释义…" aria-label="搜索" />
      <div class="row" style="margin-bottom:12px" id="filters">
        ${[['all', '全部'], ['new', '未学'], ['learning', '学习中'], ['master', '已掌握']].map(([k, n]) =>
          `<button class="btn sm ${k === filter ? '' : 'ghost'}" data-action="filter" data-f="${k}">${n}</button>`).join('')}
      </div>
      <div class="word-list" id="list"></div>`;

    function draw() {
      const q = query.trim().toLowerCase();
      const list = book.words.filter((w) => (filter === 'all' || status(w) === filter) && (!q || w.w.toLowerCase().includes(q) || w.cn.includes(q)));
      document.getElementById('list').innerHTML = list.length ? list.map((w) => {
        const box = prog(book, w)?.box || 0;
        return `<div class="word-item">
          <div class="main"><div class="w">${esc(w.w)} <span class="phonetic small">${esc(w.ph)}</span></div>
          <div class="m"><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div></div>
          <div class="level-dots" title="熟练度 ${Math.min(box, 5)}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${box >= i ? 'on' : ''}"></i>`).join('')}</div>
          ${speakBtn(w.w)}</div>`;
      }).join('') : '<p class="muted">没有找到相关单词</p>';
      document.querySelectorAll('#filters .btn').forEach((b) => b.classList.toggle('ghost', b.dataset.f !== filter));
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action="filter"]');
      if (el) { filter = el.dataset.f; draw(); }
    };
    $app.oninput = (e) => { if (e.target.id === 'q') { query = e.target.value; draw(); } };
    onKey = (e) => { if (e.key === 'Escape' && e.target.id !== 'q') go('home'); };
    draw();
  }

  /* ======================= 导入词库 ======================= */
  const SAMPLE = `adventure | 冒险
brilliant | 灿烂的；聪明的
curious | 好奇的
discover | 发现
encourage | 鼓励
gentle | 温柔的`;

  function parseImport(text) {
    const out = [];
    const seen = new Set();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let m = line.match(/^([A-Za-z][A-Za-z'’ .\-]*?)\s*[\t|,，:：=]\s*(.+)$/) || line.match(/^([A-Za-z][A-Za-z'’.\-]*)\s+(.+)$/);
      if (!m) continue;
      const word = m[1].trim();
      let cn = m[2].trim();
      let pos = '';
      const pm = cn.match(/^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|phr)\.)\s*(.+)$/i);
      if (pm) { pos = pm[1]; cn = pm[2]; }
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([word, '', pos, cn, '']);
    }
    return out;
  }

  function renderImport() {
    const current = state.custom.map((w) => `${w[0]} | ${w[2] ? w[2] + ' ' : ''}${w[3]}`).join('\n');
    $app.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <button class="icon-btn" data-action="quit" aria-label="返回">←</button>
        <h2>✏️ 导入我的词库</h2>
      </div>
      <section class="card">
        <p style="margin-top:0">每行一个单词，单词和释义之间用 <b>|</b>、逗号、Tab 或空格分隔，可在释义前写词性。至少需要 4 个单词。</p>
        <p class="muted small">示例：<code>curious | adj. 好奇的</code>　或　<code>discover 发现</code></p>
        <textarea class="import" id="import-text" placeholder="${esc(SAMPLE)}">${esc(current)}</textarea>
        <p class="muted small" id="import-count"></p>
        <div class="row">
          <button class="btn" data-action="save">💾 保存并使用</button>
          <button class="btn ghost" data-action="sample">填入示例</button>
          <span class="spacer"></span>
          ${state.custom.length ? '<button class="btn ghost" data-action="clear">🗑 删除我的词库</button>' : ''}
        </div>
      </section>`;

    const ta = document.getElementById('import-text');
    const count = () => { document.getElementById('import-count').textContent = `识别到 ${parseImport(ta.value).length} 个单词`; };
    count();
    $app.oninput = count;
    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'sample') { ta.value = SAMPLE; count(); }
      else if (a === 'save') {
        const words = parseImport(ta.value);
        if (words.length < 4) { toast('至少需要 4 个有效单词哦'); return; }
        state.custom = words;
        state.bookId = 'custom';
        if (state.adventure) delete state.adventure.custom;
        save();
        toast(`已保存 ${words.length} 个单词 ✅`);
        go('home');
      } else if (a === 'clear') {
        if (!armConfirm(el, '再点一次确认删除（学习记录也会删除）')) return;
        state.custom = [];
        if (state.adventure) delete state.adventure.custom;
        Object.keys(state.progress).forEach((k) => { if (k.startsWith('custom:')) delete state.progress[k]; });
        if (state.bookId === 'custom') state.bookId = 'primary';
        save();
        go('home');
      }
    };
    onKey = (e) => { if (e.key === 'Escape') go('home'); };
  }

  /* ======================= 我的 ======================= */
  function renderProfile() {
    const lv = levelInfo(state.xp);
    const acc = state.stats.answered ? Math.round((state.stats.correct / state.stats.answered) * 100) : 0;
    $app.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <button class="icon-btn" data-action="quit" aria-label="返回">←</button>
        <h2>🏆 我的成就 & 设置</h2>
      </div>
      <section class="card">
        <div class="stat-grid" style="margin:0">
          <div class="stat"><b>Lv.${lv.level}</b><span>${esc(lv.title)}</span></div>
          <div class="stat"><b>${masteredTotal()}</b><span>已掌握单词</span></div>
          <div class="stat"><b>${state.streak}</b><span>连续天数</span></div>
          <div class="stat"><b>${state.stats.answered}</b><span>累计答题</span></div>
          <div class="stat"><b>${acc}%</b><span>总正确率</span></div>
          <div class="stat"><b>${state.stats.bestCombo}</b><span>最高连击</span></div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">🏅 成就（${state.achievements.length}/${ACHIEVEMENTS.length}）</h2>
        <div class="achievements">
          ${ACHIEVEMENTS.map((a) => `<div class="ach ${state.achievements.includes(a.id) ? '' : 'locked'}">
            <div class="ach-icon">${a.icon}</div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div>`).join('')}
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">⚙️ 设置</h2>
        <div class="card" style="display:grid; gap:14px">
          <div class="row"><span>🎯 每日目标</span><span class="spacer"></span>
            ${[10, 20, 30, 50].map((n) => `<button class="btn sm ${state.goal === n ? '' : 'ghost'}" data-action="goal" data-n="${n}">${n}</button>`).join('')}
          </div>
          <div class="row"><span>🔊 声音与朗读</span><span class="spacer"></span>
            <button class="btn sm ${state.sound ? '' : 'ghost'}" data-action="sound" data-v="1">开</button>
            <button class="btn sm ${state.sound ? 'ghost' : ''}" data-action="sound" data-v="0">关</button>
          </div>
          <div class="row"><span>🌗 主题</span><span class="spacer"></span>
            ${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, n]) => `<button class="btn sm ${state.theme === k ? '' : 'ghost'}" data-action="theme" data-v="${k}">${n}</button>`).join('')}
          </div>
          ${canSpeak ? '' : '<p class="muted small" style="margin:0">⚠️ 当前浏览器不支持语音朗读，建议使用 Chrome / Edge / Safari。</p>'}
          <div class="row"><span>🧹 清空所有学习进度</span><span class="spacer"></span>
            <button class="btn sm bad" data-action="reset">重置</button>
          </div>
        </div>
      </section>`;

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'goal') { state.goal = Number(el.dataset.n); state.today.goalDone = state.today.count >= state.goal; }
      else if (a === 'sound') state.sound = el.dataset.v === '1';
      else if (a === 'theme') { state.theme = el.dataset.v; applyTheme(); }
      else if (a === 'reset') {
        if (!armConfirm(el, '再点一次确认清空')) return;
        const keep = { custom: state.custom, theme: state.theme, sound: state.sound, goal: state.goal };
        state = { ...defaults(), ...keep };
        toast('进度已重置');
      }
      save();
      go('profile');
    };
    onKey = (e) => { if (e.key === 'Escape') go('home'); };
  }

  /* ======================= 启动 ======================= */
  const SCREENS = {
    home: renderHome,
    flash: renderFlash,
    choice: renderChoice,
    spell: renderSpell,
    match: renderMatch,
    scramble: renderScramble,
    blitz: renderBlitz,
    rain: renderRain,
    whack: renderWhack,
    judge: renderJudge,
    sentence: renderSentence,
    adventure: renderAdventure,
    stage: renderStage,
    battle: renderBattle,
    result: renderResult,
    words: renderWords,
    import: renderImport,
    profile: renderProfile,
  };

  applyTheme();
  go('home');
})();
