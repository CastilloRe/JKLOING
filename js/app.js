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
    stats: { answered: 0, correct: 0, bestCombo: 0, games: 0, perfect: 0, fastMatch: false },
    achievements: [],
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
  const toWord = (a) => ({ w: a[0], ph: a[1] || '', pos: a[2] || '', cn: a[3] || '', ex: a[4] || '' });

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
  function pickWords(book, n) {
    const now = Date.now();
    const scored = book.words.map((w) => {
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

  function applyTheme() {
    if (state.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state.theme);
  }

  /* ======================= 首页 ======================= */
  const MODES = [
    { id: 'flash', icon: '🃏', name: '闪卡记忆', desc: '翻卡片，认识新单词', color: '#ffd978' },
    { id: 'quiz', icon: '⚡', name: '极速选择', desc: '限时作答，连击加分', color: '#b9a8ff' },
    { id: 'spell', icon: '⌨️', name: '拼写大师', desc: '看释义，拼出单词', color: '#8fe0b8' },
    { id: 'listen', icon: '🎧', name: '听音辨词', desc: '听发音，选出单词', color: '#9fd0ff' },
    { id: 'match', icon: '🧩', name: '连连看', desc: '英汉配对，挑战最快', color: '#ffb3c6' },
    { id: 'review', icon: '📕', name: '错题复习', desc: '攻克易错单词', color: '#ffbf9e' },
  ];

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
        <h2 class="section-title">🎮 开始游戏</h2>
        <div class="modes">
          ${MODES.map((m) => `
            <button class="mode" data-action="mode" data-id="${m.id}">
              <div class="mode-icon" style="background:color-mix(in srgb, ${m.color} 75%, var(--surface))">${m.icon}</div>
              <div class="mode-name">${m.name}</div>
              <div class="mode-desc">${m.desc}</div>
              ${m.id === 'review' && wrongCount ? `<span class="badge">${wrongCount}</span>` : ''}
            </button>`).join('')}
        </div>
      </section>

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
  const speakBtn = (w) => `<button class="speak" data-action="speak" data-w="${esc(w)}" aria-label="朗读 ${esc(w)}">🔊</button>`;
  const wordDetail = (w) => `
    <div><b style="font-family:var(--font-word);font-size:18px">${esc(w.w)}</b> ${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>
    <div><span class="pos">${esc(w.pos)}</span>${esc(w.cn)}</div>
    ${w.ex ? `<div class="example">${esc(w.ex)}</div>` : ''}`;

  function quitHandler(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return false;
    if (el.dataset.action === 'quit') { go('home'); return true; }
    if (el.dataset.action === 'speak') { speak(el.dataset.w); return true; }
    return false;
  }

  /* ======================= 选择题（极速 / 听力 / 错题） ======================= */
  function renderChoice(cfg) {
    const book = currentBook();
    const g = { i: 0, hearts: cfg.hearts ? 3 : null, combo: 0, bestCombo: 0, score: 0, correct: 0, wrong: [], answered: false, q: null };
    let timerId = null, autoId = null;
    onCleanup(() => { clearInterval(timerId); clearTimeout(autoId); });

    function buildQ() {
      const w = cfg.words[g.i];
      const dir = cfg.kind === 'listen' ? 'listen' : Math.random() < 0.5 ? 'en2cn' : 'cn2en';
      const label = (x) => (dir === 'en2cn' ? x.cn : normalize(x.w));
      const seen = new Set([label(w)]);
      const distract = [];
      for (const x of shuffle(book.words)) {
        if (distract.length >= 3) break;
        if (x.w === w.w || seen.has(label(x))) continue;
        seen.add(label(x));
        distract.push(x);
      }
      return { w, dir, options: shuffle([w, ...distract]) };
    }

    function headExtra() {
      const hearts = g.hearts === null ? '' : `<span class="hearts" aria-label="剩余生命 ${g.hearts}">${'❤️'.repeat(g.hearts)}${'🤍'.repeat(3 - g.hearts)}</span>`;
      return `${hearts}<span class="combo" id="combo">${g.combo >= 2 ? `🔥x${g.combo}` : ''}</span>`;
    }

    function render() {
      const q = g.q;
      let prompt;
      if (q.dir === 'en2cn') {
        prompt = `<div class="prompt-label">选择正确的中文释义</div>
          <div class="prompt-word">${esc(q.w.w)}</div>
          <div>${q.w.ph ? `<span class="phonetic">${esc(q.w.ph)}</span>` : ''} ${speakBtn(q.w.w)}</div>`;
      } else if (q.dir === 'cn2en') {
        prompt = `<div class="prompt-label">选择对应的英文单词</div>
          <div class="prompt-cn">${esc(q.w.cn)}</div>
          <div><span class="pos">${esc(q.w.pos)}</span></div>`;
      } else {
        prompt = `<div class="prompt-label">听发音，选出正确的单词</div>
          <button class="big-speaker" data-action="replay" aria-label="再听一遍 (R)">🔊</button>
          <div class="row" style="justify-content:center">
            <button class="btn ghost sm" data-action="replay">🔁 再听一遍</button>
            <button class="btn ghost sm" data-action="slow">🐢 慢速</button>
          </div>
          ${!canSpeak || !state.sound ? `<div class="phonetic" style="margin-top:8px">${state.sound ? '浏览器不支持朗读' : '声音已关闭'}，提示音标：${esc(q.w.ph || '—')}</div>` : ''}`;
      }
      $app.innerHTML = `
        ${gameHead(g.i, cfg.words.length, headExtra())}
        ${cfg.timer ? '<div class="timer"><i id="timer-bar" style="width:100%"></i></div>' : ''}
        <section class="card prompt">${prompt}</section>
        <div class="options">
          ${q.options.map((o, idx) => `
            <button class="option ${q.dir === 'en2cn' ? '' : 'word'}" data-action="pick" data-idx="${idx}">
              <span class="key">${idx + 1}</span><span>${esc(q.dir === 'en2cn' ? o.cn : o.w)}</span>
            </button>`).join('')}
        </div>
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
      const btns = $app.querySelectorAll('.option');
      btns.forEach((b, i) => {
        b.disabled = true;
        if (q.options[i] === q.w) b.classList.add('correct');
        else if (i === idx) b.classList.add('wrong');
      });
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
        if (q.dir !== 'listen') speak(q.w.w);
        fb.innerHTML = `<div class="feedback good">
          <div class="feedback-text"><div class="feedback-title">✓ 回答正确 +${gain}${g.combo >= 2 ? ` · 连击 x${g.combo}` : ''}</div>${wordDetail(q.w)}</div>
          <button class="btn good" data-action="next">下一题 ↵</button></div>`;
        autoId = setTimeout(next, 1400);
      } else {
        g.combo = 0;
        if (g.hearts !== null) g.hearts--;
        g.wrong.push(q.w);
        sfx.bad();
        speak(q.w.w);
        fb.innerHTML = `<div class="feedback bad">
          <div class="feedback-text"><div class="feedback-title">${idx < 0 ? '⏰ 时间到！' : '✗ 答错了'} 正确答案：</div>${wordDetail(q.w)}</div>
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
  function renderSpell({ words }) {
    const book = currentBook();
    const g = { i: 0, attempts: 0, hints: 0, done: false, correct: 0, score: 0, wrong: [] };

    function render() {
      const w = words[g.i];
      $app.innerHTML = `
        ${gameHead(g.i, words.length)}
        <section class="card prompt">
          <div class="prompt-label">根据释义拼写单词</div>
          <div class="prompt-cn">${esc(w.cn)}</div>
          <div><span class="pos">${esc(w.pos)}</span>${w.ph ? `<span class="phonetic">${esc(w.ph)}</span>` : ''} ${speakBtn(w.w)}</div>
          <div class="slots" id="slots"></div>
          <div class="muted small">共 ${w.w.replace(/ /g, '').length} 个字母</div>
        </section>
        <div style="margin-top:14px">
          <input id="spell" class="spell-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
            maxlength="${w.w.length}" placeholder="在这里输入单词" aria-label="输入单词拼写" />
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost" data-action="hint">💡 提示</button>
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
        return go('result', { title: '拼写大师', correct: g.correct, total: words.length, answered: words.length, score: g.score, wrong: g.wrong, again: () => startMode('spell') });
      }
      Object.assign(g, { attempts: 0, hints: 0, done: false });
      render();
    }

    $app.onclick = (e) => {
      if (quitHandler(e)) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'hint') hint();
      else if (a === 'check') check();
      else if (a === 'next') next();
    };
    onKey = (e) => {
      if (e.key === 'Escape') return go('home');
      if (e.key === 'Enter' && g.done) { e.preventDefault(); next(); }
    };
    render();
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

  /* ======================= 结算 ======================= */
  function renderResult(r) {
    const acc = r.total ? r.correct / r.total : 0;
    const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
    const emoji = ['😅', '🙂', '😄', '🤩'][stars];
    const msg = ['别灰心，多练几次就会了！', '不错的开始，继续加油！', '很棒！离掌握又近了一步！', '太厉害了！完美表现！'][stars];
    state.stats.games++;
    if (r.correct === r.total && r.total >= 5) state.stats.perfect++;
    save();
    checkAchievements();
    if (stars === 3) { confetti(); sfx.win(); }

    $app.innerHTML = `
      <section class="card result">
        <div class="result-emoji">${emoji}</div>
        <h2>${esc(r.title)} · 本局结束</h2>
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
          <button class="btn" data-action="again">🔄 再来一局</button>
          <button class="btn ghost" data-action="home">🏠 返回首页</button>
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
      const el = e.target.closest('[data-action]');
      if (!el) return;
      if (el.dataset.action === 'again') r.again();
      else if (el.dataset.action === 'home') go('home');
    };
    onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); r.again(); }
      else if (e.key === 'Escape') go('home');
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
        save();
        toast(`已保存 ${words.length} 个单词 ✅`);
        go('home');
      } else if (a === 'clear') {
        if (!confirm('确定删除自定义词库吗？其学习记录也会一并删除。')) return;
        state.custom = [];
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
        if (!confirm('确定要清空全部学习进度、经验和成就吗？此操作无法撤销。')) return;
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
    result: renderResult,
    words: renderWords,
    import: renderImport,
    profile: renderProfile,
  };

  applyTheme();
  go('home');
})();
