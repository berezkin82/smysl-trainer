// Тренажёр «Поймай смысл»: тренировка из блоков по 2,5 минуты, игры «Ловушка», «Вспышка» и «Робот»,
// режимы «глазами» и «на слух», экран для взрослых.
(function () {
  'use strict';

  const C = window.CONTENT, st = window.STORE, S = st.S;
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pick = a => a[Math.floor(Math.random() * a.length)];

  const BUILD = '08.10 21:15'; // проставляет .claude/deploy.sh
  const SESSION_MS = 15 * 60e3, BLOCK_MS = 2.5 * 60e3;
  const EXPO_MIN = 0.55; // нижний предел множителя времени показа: ~80 слов/мин
  // Порядок блоков: игра и режим (в смешанном режиме глаза и слух чередуются). «Ловушка» — разминка: сначала найти
  // слова, которые меняют смысл, потом ловить смысл целиком. Она всегда глазами.
  const PLAN = [['trap', 'read'], ['flash', 'read'], ['robot', 'audio'], ['trap', 'read'], ['flash', 'audio'], ['robot', 'read']];
  const GAMES = {
    trap: {
      title: 'Ловушка', icon: '🪤',
      read: 'В каждой фразе прячется слово, от которого меняется смысл: «не», «кроме», «только»… Найди его и нажми.',
    },
    flash: {
      title: 'Вспышка', icon: '⚡',
      read: 'Фраза появится ненадолго. Прочитай её один раз и запомни. Потом выбери картинку, где всё именно так.',
      audio: 'Послушай фразу один раз и запомни. Потом выбери картинку, где всё именно так.',
    },
    robot: {
      title: 'Робот', icon: '🤖',
      read: 'Прочитай команду и запомни. Потом она спрячется. Нажми на нужные картинки и нажми «Готово».',
      audio: 'Послушай команду и запомни. Потом нажми на нужные картинки и нажми «Готово».',
    },
  };
  const PRAISE = ['С первого раза!', 'Точно в цель!', 'Смысл пойман!', 'Отлично!', 'Верно, с первого раза!'];

  // ---------- Голос ----------
  const TTS = {
    ok: false, voice: null, list: [],
    init() {
      if (!('speechSynthesis' in window)) return;
      const choose = () => {
        // Сначала качественные голоса: компактные на iPad звучат сдавленно.
        const rank = v => (/premium|высок/i.test(v.name + v.voiceURI) ? 0 : /enhanced|улучш/i.test(v.name + v.voiceURI) ? 1 : 2);
        this.list = speechSynthesis.getVoices().filter(v => /^ru/i.test(v.lang)).sort((a, b) => rank(a) - rank(b));
        this.voice = this.list.find(v => v.voiceURI === S.settings.voice) || this.list[0] || null;
        this.ok = !!this.voice;
      };
      choose();
      speechSynthesis.onvoiceschanged = choose;
    },
    unlock() { // iOS разрешает речь только после касания: «прогреваем» при нажатии кнопки
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
    },
    async speak(text) {
      if (!this.ok) return;
      speechSynthesis.cancel();
      await wait(60);
      return new Promise(res => {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = this.voice; u.lang = this.voice.lang; u.rate = 0.9;
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        u.onend = fin; u.onerror = fin;
        setTimeout(fin, 2000 + text.length * 110); // страховка: onend на iOS иногда не приходит
        speechSynthesis.speak(u);
      });
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
  };

  // ---------- Разметка ----------
  function markTrap(text, trap) {
    const set = new Set((trap || []).map(w => w.toLowerCase()));
    return text.split(/([А-Яа-яЁё0-9]+)/).map(p => (set.has(p.toLowerCase()) ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }
  const sentence = (text, trap) => `<p class="sentence">${trap ? markTrap(text, trap) : esc(text)}</p>`;
  // Картинка предмета; если файла нет — сам эмодзи.
  const pic = e => { const f = C.imgFile(e); return f ? `<img class="pic" src="${f}" alt="" draggable="false">` : `<span>${e}</span>`; };
  const sceneHTML = s => s.items.map(pic).join('');
  // Картинки заранее в память: во «Вспышке» варианты появляются сразу после фразы, ждать загрузки нельзя.
  Object.keys(C.IMG).forEach(e => { new Image().src = C.imgFile(e); });

  // ---------- Сессия ----------
  const ABORT = new Error('abort');
  let sess = null, tickTimer = null, wakeLock = null;

  function alive(my) { if (sess !== my) throw ABORT; }

  function startTicker() {
    let last = performance.now();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      if (!sess || !sess.active || document.hidden) return;
      sess.elapsed += Math.min(dt, 1000);
      const bar = $('.progress i');
      if (bar) bar.style.width = clamp(sess.elapsed / sess.len * 100, 0, 100) + '%';
    }, 250);
  }

  function effectiveMode(game, planMode, override) {
    if (game === 'trap') return 'read';
    const m = override || S.settings.mode;
    const want = m === 'mix' ? planMode : m;
    return want === 'audio' && !TTS.ok ? 'read' : want;
  }

  function barHTML() {
    return `<div class="bar">
      <button class="exit" id="exit">✕ Выйти</button>
      ${sess.test ? '<span class="testbadge">ТЕСТ</span>' : ''}
      <div class="progress" aria-label="Сколько тренировки пройдено"><i style="width:${clamp(sess.elapsed / sess.len * 100, 0, 100)}%"></i></div>
      <div class="stars"><b>★</b> <span id="sstars">${sess.stars}</span></div>
    </div>`;
  }

  function bindExit() {
    const b = $('#exit'); if (!b) return;
    b.onclick = () => {
      if (b.dataset.armed) { endSession(true); return; }
      b.dataset.armed = '1'; b.textContent = 'Точно выйти?';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '✕ Выйти'; } }, 3000);
    };
  }

  async function requestWake() {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }

  // opts.test — тестовая тренировка взрослого: { game: 'all'|'flash'|'robot', level, mode, minutes }.
  // У неё свои уровни и время показа; прогресс ребёнка не меняется, ответы в логах помечены test.
  async function runSession(opts = {}) {
    TTS.unlock();
    const t = opts.test || null;
    if (!opts.demo && !t) {
      // Прогресс могли поменять в другой копии (Safari / иконка) — сначала берём свежий из репо.
      const b = $('#start'); if (b) { b.disabled = true; b.textContent = 'Секунду…'; }
      await Promise.race([cloudSync(), wait(4000)]);
      if (doneToday()) { renderHome(); return; }
    }
    const my = sess = {
      id: Date.now().toString(36), elapsed: 0, stars: 0, n: 0, first: 0, active: false, seq: 0, demo: !!opts.demo,
      secrets: 0, lastSecretN: -99, secretRub: 0,
      test: t, len: t ? t.minutes * 60e3 : SESSION_MS,
      levels: t ? { flash: t.level, robot: t.level, trap: t.level } : S.levels,
      hist: t ? { flash: [], robot: [], trap: [] } : S.hist,
      expo: 1,
    };
    startTicker(); requestWake();
    try {
      const plan = opts.demo ? [[opts.demo, 'read']]
        : t && t.game !== 'all' ? PLAN.map(([, m]) => [t.game, m])
        : PLAN;
      for (let b = 0; b < plan.length && sess.elapsed < my.len; b++) {
        const [game, planMode] = plan[b];
        const mode = effectiveMode(game, planMode, t && t.mode);
        if (!opts.demo) await showIntro(my, game, mode, b);
        // В коротком тесте блоки делят время поровну, чтобы успеть увидеть все игры.
        const blockMs = t ? my.len / plan.length : BLOCK_MS;
        const blockEnd = Math.min(sess.elapsed + blockMs, my.len);
        do {
          planSecret(my);
          my.active = true;
          const res = await PLAY[game](my, mode);
          my.active = false;
          if (res && res.first) await maybeSecret(my, res.text);
        } while (opts.demo || my.elapsed < blockEnd);
      }
      if (!opts.demo) endSession(false);
    } catch (e) {
      if (e !== ABORT) throw e;
    }
  }

  function endSession(aborted) {
    const my = sess;
    sess = null; TTS.stop();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (!my || my.demo) { renderHome(); return; }
    if (!aborted && my.test) renderDone(my);
    else if (!aborted) {
      const today = st.day();
      if (!S.days.includes(today)) S.days.push(today);
      else if (S.extraDay === today) S.extraDay = '';
      const add = bankAdd(my, today);
      st.touchProgress(); st.save();
      renderDone(my, add);
    } else renderHome();
    st.sync().then(updateSyncLine);
    if (!my.test) st.pushProgress();
  }

  // Копилка: раз в день, за первую законченную тренировку — ставка × доля ответов с первого раза.
  function bankAdd(my, today) {
    const r = st.bankAdd(my.first, my.n, today);
    if (r) st.addEvent('bank', Object.assign({ ver: BUILD, sid: my.id }, r));
    return r;
  }
  const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';

  // Почему начислено столько: «50 ₽ − 9 ₽ = 41 ₽» и за что минус.
  function bankEq(e) {
    const miss = e.n - e.first, lost = e.max - e.add;
    return miss
      ? `${rub(e.max)} − ${rub(lost)} = <b>${rub(e.add)}</b><span class="why-n">минус — за ${miss} ${plural(miss, 'задание', 'задания', 'заданий')} не с первого раза</span>`
      : `<b>${rub(e.add)}</b><span class="why-n">всё с первого раза — вся сумма!</span>`;
  }
  const dayWord = d => { const y = new Date(); y.setDate(y.getDate() - 1); return d === st.day() ? 'Сегодня' : d === st.day(y) ? 'Вчера' : d.slice(8, 10) + '.' + d.slice(5, 7); };

  // Карточка копилки на главном: цель и сколько осталось, и из чего сложилась последняя сумма.
  function bankHTML() {
    const b = S.bank, goal = b.goal && b.price > 0;
    const train = b.log.filter(x => !x.kind), lastT = train[train.length - 1];
    if (!goal && !lastT) return '';
    const byDay = {}; b.log.forEach(x => { byDay[x.day] = (byDay[x.day] || 0) + x.add; });
    const recent = Object.keys(byDay).sort().slice(-7), avg = recent.length ? recent.reduce((x, d) => x + byDay[d], 0) / recent.length : 0;
    const left = goal ? b.price - b.total : 0, days = left > 0 && avg > 0 ? Math.ceil(left / avg) : 0;
    const sec = lastT ? b.log.filter(x => x.kind === 'secret' && x.day === lastT.day).reduce((x, y) => x + y.add, 0) : 0;
    return `<div class="bank">
        ${goal ? `<div class="bank-goal"><b>Цель: ${esc(b.goal)}</b> — ${rub(b.price)}</div>
        <div class="bank-bar"><i style="width:${clamp(b.total / b.price * 100, 2, 100)}%"></i></div>
        <div class="bank-note">${left <= 0 ? 'Цель достигнута! 🎉' : `Осталось ${rub(left)}${days ? ` — примерно ${days} ${plural(days, 'день', 'дня', 'дней')}` : ''}`}</div>` : ''}
        ${lastT ? `<div class="bank-why"><span class="bank-day">${dayWord(lastT.day)}:</span> ${bankEq(lastT)}${sec ? `<span class="why-n">и за секреты +${rub(sec)}</span>` : ''}</div>` : ''}
      </div>`;
  }

  function showIntro(my, game, mode, idx) {
    const g = GAMES[game];
    app.innerHTML = `${barHTML()}
      <section class="intro">
        <div class="big">${g.icon}</div>
        <h2>${g.title}</h2>
        <span class="mode ${mode}">${mode === 'audio' ? '🔊 Слушаем' : '👀 Читаем'}</span>
        <p>${esc(g[mode])}</p>
        <button class="btn primary" id="go">${idx === 0 ? 'Начать' : 'Дальше'}</button>
      </section>`;
    bindExit();
    TTS.speak(g[mode]);
    return new Promise(res => { $('#go').onclick = () => { TTS.stop(); TTS.unlock(); alive(my); res(); }; });
  }

  // Итог задания: звёзды, запись в лог, подстройка сложности.
  function finishTask(my, game, mode, task, r) {
    const first = r.correct && r.attempts === 1 && r.replays === 0;
    my.n++;
    if (first) { my.first++; my.stars++; if (!my.demo && !my.test) S.stars++; }
    if (!my.demo) {
      const rec = {
        id: `${my.id}-${++my.seq}`, sid: my.id, ver: BUILD, game, tpl: task.tpl, level: task.level, mode,
        text: task.text, trap: task.trap, expo: r.expo || null, read: r.readMs || null, replays: r.replays, attempts: r.attempts,
        correct: r.correct, first, rt: r.rt,
      };
      // «Робот»: поле и что нажато на каждой попытке — видно, ошибка в смысле или в картинках.
      if (r.field) { rec.field = r.field; rec.picks = r.picks; }
      if (r.taps) rec.taps = r.taps; // «Ловушка»: какие слова нажаты по порядку
      if (r.find) rec.find = r.find; // разбор ошибки: нашёл ли сам слово, из-за которого ошибся
      if (my.test) rec.test = true;
      st.addRecord(rec);
      // Уровни и история: у ребёнка — сохранённые, в тесте — свои на время сессии.
      const L = my.levels, H = my.hist, h = H[game], lv0 = L[game];
      h.push(first ? 1 : 0); if (h.length > 6) h.shift();
      const sum = a => a.reduce((x, y) => x + y, 0);
      if (h.length >= 6 && sum(h) >= 5 && L[game] < 3) { L[game]++; H[game] = []; r.levelUp = true; }
      else if (h.length >= 4 && sum(h.slice(-4)) <= 1 && L[game] > 1) { L[game]--; H[game] = []; }
      if (!my.test) {
        st.touchProgress();
        if (L[game] !== lv0) st.addEvent('level', { ver: BUILD, sid: my.id, game, from: lv0, to: L[game] });
      }
      if (game === 'flash' && mode === 'read') {
        const e = my.test ? my.expo : S.expo;
        const ne = clamp(first ? e * 0.92 : r.correct ? e : e * 1.15, EXPO_MIN, 2);
        if (my.test) my.expo = ne; else S.expo = ne;
      }
      st.save();
    }
    const s = $('#sstars');
    if (s) {
      s.textContent = my.stars;
      if (first) { const p = s.parentElement; p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
    }
    return first;
  }

  async function showResult(my, first, correct, levelUp, text = {}) {
    const fb = $('#fb');
    fb.className = 'feedback ' + (correct ? 'ok' : 'bad');
    fb.innerHTML = first ? `<span class="pop">⭐</span> ${pick(PRAISE)}`
      : correct ? text.ok || 'Правильно! Со второй попытки.'
      : text.bad || 'Ничего! Посмотри, как было правильно.';
    if (levelUp) fb.innerHTML += '<br><span class="pop">🚀 Новый уровень!</span>';
    const next = $('#next');
    if (first && !levelUp) { await wait(2200); alive(my); return; }
    next.hidden = false;
    await new Promise(res => { next.onclick = res; });
    alive(my);
  }

  // ---------- Разбор ошибки ----------
  // После первой ошибки ребёнок сам ищет во фразе слово, из-за которого ответ другой (как в «Ловушке»),
  // потом видит и слышит, что это слово значит, — и только тогда пробует ещё раз.
  // Возвращает { ok: нашёл ли слово сам, taps: что нажимал }.
  async function findWord(my, task) {
    const prompt = $('#prompt'), parts = C.tokens(task.text);
    const keys = new Set(task.trap.map(w => w.toLowerCase()));
    const need = parts.map((p, i) => (C.isWord(p) && keys.has(p.toLowerCase()) ? i : -1)).filter(i => i >= 0);
    prompt.innerHTML = `<p class="ask">Найди слово, из-за которого ошибка</p>
      <p class="sentence trapline" id="fline">${parts.map((p, i) => (C.isWord(p) ? `<button class="w" data-i="${i}">${esc(p)}</button>` : esc(p))).join('')}</p>
      <p class="hint" id="fhint">Нажми на него</p>`;
    const line = $('#fline'), taps = [];
    let wrong = 0, ok = false;
    await new Promise(res => {
      line.onclick = e => {
        const b = e.target.closest('.w'); if (!b || b.classList.contains('bad')) return;
        const i = +b.dataset.i;
        taps.push(parts[i].toLowerCase());
        if (need.includes(i)) { ok = true; res(); return; }
        b.classList.add('bad'); wrong++;
        if (wrong >= 2) res(); else $('#fhint').textContent = 'Не это слово. Ищи ещё!';
      };
    });
    alive(my);
    prompt.innerHTML = sentence(task.text, task.trap) + `<p class="why1">${ok ? '👍 ' : ''}${esc(task.why)}</p>
      <div class="actions"><button class="btn primary small" id="fgo">Попробую ещё раз</button></div>`;
    TTS.speak(task.why);
    await new Promise(res => { $('#fgo').onclick = res; });
    alive(my); TTS.stop();
    return { ok, taps };
  }

  // ---------- «Вспышка» ----------
  async function playFlash(my, mode) {
    const task = makeTask(my, () => C.flash(my.levels.flash));
    // Время показа — под скорость чтения второклассника (~50 слов/мин) плюс запас; «Понятно!» прячет раньше.
    // Не короче 4 с: на 3,6 с ребёнок упирался в скорость чтения, а не в понимание (логи 30.09–06.10).
    const words = task.text.split(/\s+/).length;
    const expo = Math.round(clamp((1500 + words * 1100) * Math.max(my.test ? my.expo : S.expo, EXPO_MIN), 4000, 16000));
    app.innerHTML = `${barHTML()}
      <section class="task">
        <div class="prompt" id="prompt"></div>
        <div class="options" id="opts" hidden>${task.options.map((o, i) => `<button class="opt" data-i="${i}" aria-label="Вариант ${i + 1}">${sceneHTML(o)}</button>`).join('')}</div>
        <p class="feedback" id="fb"></p>
        <div class="actions">
          <button class="btn small" id="again" disabled>${mode === 'audio' ? '🔊 Послушать ещё' : '👀 Посмотреть ещё'}</button>
          <button class="btn primary" id="next" hidden>Дальше →</button>
        </div>
      </section>`;
    bindExit();
    const prompt = $('#prompt'), opts = $('#opts'), again = $('#again');
    let replays = 0, attempts = 0, correct = false, rt = null, busy = false, readMs = null, find = null;

    const present = async () => {
      busy = true; again.disabled = true; opts.hidden = true;
      if (mode === 'read') {
        prompt.innerHTML = sentence(task.text) + '<div class="timer"><i></i></div><div class="actions"><button class="btn primary small" id="got">Понятно!</button></div>';
        const bar = $('.timer i', prompt);
        bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: expo, easing: 'linear', fill: 'forwards' });
        const t0 = performance.now();
        await Promise.race([wait(expo), new Promise(res => { $('#got', prompt).onclick = res; })]);
        if (readMs === null) readMs = Math.round(performance.now() - t0);
      } else {
        prompt.innerHTML = '<div class="listen on">🔊</div><p class="hint">Слушай внимательно</p>';
        await TTS.speak(task.say || task.text);
      }
      alive(my);
      prompt.innerHTML = '<p class="ask">Какая картинка подходит?</p>';
      opts.hidden = false; again.disabled = false; busy = false;
    };

    await present();
    const tAsk = performance.now();
    const okKey = C.sceneKey(task.ok);
    while (attempts < 2 && !correct) {
      const i = await new Promise(res => {
        opts.onclick = e => { const b = e.target.closest('.opt'); if (b && !b.disabled && !busy) res(+b.dataset.i); };
        again.onclick = () => { if (!busy) { replays++; present().catch(() => {}); } };
      });
      alive(my);
      attempts++;
      if (rt === null) rt = Math.round(performance.now() - tAsk);
      const btn = opts.children[i];
      correct = C.sceneKey(task.options[i]) === okKey;
      btn.classList.add(correct ? 'ok' : 'bad');
      if (!correct) btn.disabled = true;
      if (!correct && attempts < 2) {
        busy = true; again.disabled = true;
        find = await findWord(my, task);
        prompt.innerHTML = sentence(task.text, task.trap) + `<p class="why1">${esc(task.why)}</p><p class="hint">Выбери картинку ещё раз</p>`;
        busy = false; again.disabled = false;
      }
    }
    opts.onclick = null; again.onclick = null; again.hidden = true;
    [...opts.children].forEach((b, i) => { b.disabled = true; if (C.sceneKey(task.options[i]) === okKey) b.classList.add('ok'); });
    prompt.innerHTML = sentence(task.text, task.trap) + (correct && attempts === 1 ? '' : `<p class="why1">${esc(task.why)}</p>`);
    const r = { correct, attempts, replays, rt, expo: mode === 'read' ? expo : null, readMs, find };
    const first = finishTask(my, 'flash', mode, task, r);
    await showResult(my, first, correct, r.levelUp);
    return { first, text: task.text };
  }

  // ---------- «Робот» ----------
  async function playRobot(my, mode) {
    const task = makeTask(my, () => C.robot(my.levels.robot));
    app.innerHTML = `${barHTML()}
      <section class="task">
        <div class="prompt" id="prompt"></div>
        <div class="field" id="field" style="--cols:${Math.ceil(task.items.length / 2)}" hidden>${task.items.map((it, i) => `<button class="cell" data-i="${i}" aria-pressed="false">${pic(it.e)}</button>`).join('')}</div>
        <p class="feedback" id="fb"></p>
        <div class="actions">
          <button class="btn small" id="again" hidden>${mode === 'audio' ? '🔊 Послушать ещё' : '👀 Подсмотреть'}</button>
          <button class="btn primary" id="check" hidden disabled>Готово</button>
          <button class="btn primary" id="next" hidden>Дальше →</button>
        </div>
      </section>`;
    bindExit();
    const prompt = $('#prompt'), field = $('#field'), again = $('#again'), check = $('#check');
    const cells = [...field.children];
    const sel = new Set();
    let replays = 0, attempts = 0, correct = false, rt = null, busy = false, find = null;
    const picks = [];
    const ASK = '<p class="ask">Выполни команду</p>';

    // Первый показ: фраза видна, пока не нажмут «Понятно!»; на слух — звучит один раз.
    if (mode === 'read') {
      prompt.innerHTML = sentence(task.text) + '<div class="actions"><button class="btn primary" id="got">Понятно!</button></div>';
      await new Promise(res => { $('#got').onclick = res; });
    } else {
      prompt.innerHTML = '<div class="listen on">🔊</div><p class="hint">Слушай команду</p>';
      await TTS.speak(task.say || task.text);
    }
    alive(my);
    prompt.innerHTML = ASK;
    field.hidden = false; again.hidden = false; check.hidden = false;
    const tAsk = performance.now();

    field.onclick = e => {
      const c = e.target.closest('.cell'); if (!c || busy) return;
      const i = +c.dataset.i;
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      c.classList.toggle('sel', sel.has(i)); c.setAttribute('aria-pressed', sel.has(i)); c.classList.remove('bad');
      check.disabled = sel.size === 0;
    };
    again.onclick = async () => {
      if (busy) return;
      replays++; busy = true; again.disabled = true;
      if (mode === 'read') { prompt.innerHTML = sentence(task.text); await wait(2500); }
      else { prompt.innerHTML = '<div class="listen on">🔊</div>'; await TTS.speak(task.say || task.text); }
      if (sess !== my) return;
      prompt.innerHTML = ASK; busy = false; again.disabled = false;
    };

    while (attempts < 2 && !correct) {
      await new Promise(res => { check.onclick = () => { if (!busy && sel.size) res(); }; });
      alive(my);
      attempts++;
      if (rt === null) rt = Math.round(performance.now() - tAsk);
      picks.push([...sel].sort((a, b) => a - b));
      correct = C.robotCheck(task, sel);
      if (!correct && attempts < 2) {
        // Лишние нажатия остаются зачёркнутыми, пока их не снимут; пропущенные не подсказываем.
        busy = true; again.disabled = true;
        cells.forEach((c, i) => { if (sel.has(i) && !task.pred(task.items[i])) c.classList.add('bad'); });
        find = await findWord(my, task);
        prompt.innerHTML = sentence(task.text, task.trap) + `<p class="why1">${esc(task.why)}</p>`;
        busy = false; again.disabled = false;
      }
    }
    field.onclick = null; check.hidden = true; again.hidden = true;
    busy = true;
    prompt.innerHTML = sentence(task.text, task.trap) + (correct && attempts === 1 ? '' : `<p class="why1">${esc(task.why)}</p>`);
    cells.forEach((c, i) => {
      const need = task.pred(task.items[i]);
      if (sel.has(i) && need) c.classList.add('hit');
      else if (sel.has(i)) c.classList.add('bad');
      else if (need && !correct) c.classList.add('need');
    });
    const r = { correct, attempts, replays, rt, field: task.items.map(it => it.e).join(' '), picks, find };
    const first = finishTask(my, 'robot', mode, task, r);
    await showResult(my, first, correct, r.levelUp);
    return { first, text: task.text };
  }

  // ---------- «Ловушка» ----------
  // Фраза остаётся на экране; нужно нажать слова, которые меняют смысл. Вторая ошибка — показываем ответ.
  async function playTrap(my) {
    const task = makeTask(my, () => C.trap(my.levels.trap)), n = task.need.length;
    app.innerHTML = `${barHTML()}
      <section class="task">
        <div class="prompt">
          <p class="ask">${n > 1 ? `Найди ${n} ${plural(n, 'слово', 'слова', 'слов')}-ловушки` : 'Найди слово-ловушку'}</p>
          <p class="sentence trapline" id="line">${task.parts.map((p, i) => (C.isWord(p) ? `<button class="w" data-i="${i}">${esc(p)}</button>` : esc(p))).join('')}</p>
          <p class="hint" id="hint">Слово, от которого меняется смысл</p>
        </div>
        <p class="feedback" id="fb"></p>
        <div class="why" id="why" hidden></div>
        <div class="actions"><button class="btn primary" id="next" hidden>Дальше →</button></div>
      </section>`;
    bindExit();
    const line = $('#line'), words = [...line.querySelectorAll('.w')], tAsk = performance.now();
    const found = new Set(), taps = [];
    let wrong = 0, rt = null;
    await new Promise(res => {
      line.onclick = e => {
        const b = e.target.closest('.w'); if (!b || b.classList.contains('hit') || b.classList.contains('bad')) return;
        const i = +b.dataset.i;
        taps.push(task.parts[i].toLowerCase());
        if (rt === null) rt = Math.round(performance.now() - tAsk);
        if (task.need.includes(i)) {
          found.add(i); b.classList.add('hit');
          if (found.size === n) res();
        } else {
          wrong++; b.classList.add('bad');
          if (wrong >= 2) res();
          else $('#hint').textContent = 'Это слово смысл не меняет. Ищи дальше!';
        }
      };
    });
    alive(my);
    line.onclick = null;
    const correct = found.size === n;
    words.forEach(b => { if (task.need.includes(+b.dataset.i) && !found.has(+b.dataset.i)) b.classList.add('need'); });
    $('#hint').textContent = '';
    const r = { correct, attempts: wrong + 1, replays: 0, rt, taps };
    const first = finishTask(my, 'trap', 'read', task, r);
    if (!first) {
      const why = $('#why');
      why.innerHTML = [...new Set(task.trap.map(C.trapWhy))].map(t => `<p>${esc(t)}</p>`).join('');
      why.hidden = false;
    }
    await showResult(my, first, correct, r.levelUp, { ok: 'Верно! Со второй попытки.', bad: 'Ничего! Вот где были ловушки.' });
    return { first, text: task.text };
  }

  const PLAY = { flash: playFlash, robot: playRobot, trap: playTrap };

  // ---------- Секрет ----------
  // Иногда после верного ответа: во фразе спряталось имя кого-то из семьи (буквы идут по порядку, не подряд).
  // Нужно найти эти буквы. Имена — из приватного репо (store.refreshFamily). Время тренировки не идёт.
  const norm = ch => ch.toLowerCase().replace('ё', 'е');
  const fitsSeq = (text, name) => { let k = 0; for (const ch of text) if (k < name.length && norm(ch) === norm(name[k])) k++; return k === name.length; };
  const SECRET_MAX = 3, SECRET_GAP = 8, SECRET_P = 0.12;
  const FORCE_SECRET = new URLSearchParams(location.search).has('secret'); // для проверок: секрет после каждого верного ответа

  // Перед заданием решаем, будет ли после него секрет, и чьё имя прячем: сначала новые для этой тренировки.
  function planSecret(my) {
    my.secretFor = null;
    if (my.demo || !S.family.length) return;
    if (!FORCE_SECRET && (my.secrets >= SECRET_MAX || my.n - my.lastSecretN < SECRET_GAP || Math.random() > SECRET_P)) return;
    const fresh = S.family.filter(f => !(my.shownNames || []).includes(f.name));
    my.secretFor = pick(fresh.length ? fresh : S.family);
  }
  // Задание с секретом подбираем: перебираем варианты, пока имя не уложится в буквы фразы.
  function makeTask(my, make) {
    if (!my.secretFor) return make();
    for (let k = 0; k < 80; k++) { const t = make(); if (fitsSeq(t.text, my.secretFor.name)) return t; }
    for (let k = 0; k < 40; k++) { const t = make(); const f = S.family.find(x => fitsSeq(t.text, x.name)); if (f) { my.secretFor = f; return t; } }
    my.secretFor = null;
    return make();
  }

  async function maybeSecret(my, text) {
    const f = my.secretFor; my.secretFor = null;
    if (!f || !fitsSeq(text, f.name)) return;
    const name = [...f.name];
    my.shownNames = (my.shownNames || []).concat(f.name);
    my.secrets++; my.lastSecretN = my.n;
    const chars = [...text];
    // Слова не переносятся посередине: каждое слово — неразрывный блок из кнопок-букв.
    let html = '', i = 0;
    for (const part of text.split(/(\s+)/)) {
      if (/^\s+$/.test(part)) { html += ' '; i += part.length; continue; }
      html += '<span class="wd">' + [...part].map(ch => { const k = i++; return /[А-Яа-яЁё]/.test(ch) ? `<button class="l" data-i="${k}">${esc(ch)}</button>` : esc(ch); }).join('') + '</span>';
    }
    app.innerHTML = `${barHTML()}
      <section class="task secret">
        <div class="prompt">
          <p class="ask">🔎 Секрет! В этой фразе спряталось имя</p>
          <div class="slots">${name.map(ch => `<span>${esc(ch.toUpperCase())}</span>`).join('')}</div>
          <p class="hint" id="shint">Найди эти буквы во фразе по порядку</p>
        </div>
        <p class="sentence letters" id="sl">${html}</p>
        <p class="feedback" id="fb"></p>
        <div class="actions"><button class="btn small" id="skip">Пропустить</button><button class="btn primary" id="next" hidden>Дальше →</button></div>
      </section>`;
    bindExit();
    TTS.speak('Секрет! В этой фразе спряталось имя ' + f.name);
    const slots = [...app.querySelectorAll('.slots span')];
    let k = 0, last = -1, miss = 0;
    const done = await new Promise(res => {
      $('#skip').onclick = () => res(false);
      $('#sl').onclick = e => {
        const b = e.target.closest('.l'); if (!b || b.classList.contains('hit')) return;
        const at = +b.dataset.i;
        // Буква подходит, если она следующая в имени, стоит после найденных и после неё хватает букв на остаток имени.
        if (norm(chars[at]) === norm(name[k]) && at > last && fitsSeq(chars.slice(at + 1).join(''), name.slice(k + 1).join(''))) {
          b.classList.add('hit'); slots[k].classList.add('on'); last = at; k++;
          if (k === name.length) res(true);
        } else {
          miss++; b.classList.remove('no'); void b.offsetWidth; b.classList.add('no');
          $('#shint').textContent = norm(chars[at]) === norm(name[k]) ? 'Эта буква нужна раньше — ищи ближе к началу' : `Сейчас ищем букву «${name[k].toUpperCase()}»`;
        }
      };
    });
    alive(my);
    $('#sl').onclick = null; $('#skip').hidden = true;
    const rec = { id: `${my.id}-${++my.seq}`, sid: my.id, ver: BUILD, game: 'secret', name: f.name, done, miss };
    if (my.test) rec.test = true;
    st.addRecord(rec);
    if (!done) return;
    my.stars++;
    let rubAdd = 0;
    if (!my.test) {
      S.stars++;
      const r = st.bankBonus(st.day());
      if (r) { rubAdd = r.add; my.secretRub += r.add; st.addEvent('bank-secret', Object.assign({ ver: BUILD, sid: my.id }, r)); }
      st.touchProgress(); st.save();
    }
    const sEl = $('#sstars'); if (sEl) sEl.textContent = my.stars;
    const fb = $('#fb');
    fb.className = 'feedback ok';
    fb.innerHTML = `<span class="pop">✨ ${esc(f.name)}${f.who ? ' — ' + esc(f.who) : ''}! ✨</span><br><span class="pop">⭐ +1${rubAdd ? ` · 🐷 +${rub(rubAdd)}` : ''}</span>`;
    TTS.speak(f.name + '!');
    const next = $('#next'); next.hidden = false;
    await new Promise(res => { next.onclick = res; });
    alive(my);
  }

  // ---------- Главный и итоговый экраны ----------
  function streak() {
    const set = new Set(S.days);
    const d = new Date();
    if (!set.has(st.day(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(st.day(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // Фото на главном: из кэша устройства (см. store.js), по кругу; нажатие — «кувырок» и следующее фото.
  const PH = {
    urls: [], i: -1, loaded: false,
    async load() {
      this.urls.forEach(u => URL.revokeObjectURL(u));
      this.urls = (await st.cachedPhotos()).map(b => URL.createObjectURL(b));
      if (this.i < 0) this.i = Math.floor(Math.random() * this.urls.length) - 1;
      this.loaded = true;
    },
    next() { if (!this.urls.length) return ''; this.i = (this.i + 1) % this.urls.length; return this.urls[this.i]; },
  };

  function setPhoto(url) {
    const frame = $('#flyer .frame'); if (!frame) return;
    frame.innerHTML = url ? `<img src="${url}" alt="">` : '🪂';
  }

  async function showPhoto() {
    if (!PH.loaded) await PH.load();
    setPhoto(PH.next());
  }

  function refreshPhotos() {
    st.refreshPhotos().then(changed => { if (changed) PH.load().then(() => { if ($('#flyer')) showPhoto(); }); });
  }

  function bindFlyer() {
    const f = $('#flyer');
    f.onclick = () => {
      if (f.classList.contains('spin')) return;
      f.classList.add('spin');
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * 2 * Math.PI + Math.random() * .5, r = 150 + Math.random() * 70;
        const b = document.createElement('span');
        b.className = 'burst'; b.textContent = pick(['⭐', '✨', '💫']);
        b.style.setProperty('--x', Math.round(Math.cos(a) * r) + 'px'); b.style.setProperty('--y', Math.round(Math.sin(a) * r) + 'px');
        f.append(b); setTimeout(() => b.remove(), 950);
      }
      if (PH.urls.length > 1) setTimeout(() => setPhoto(PH.next()), 450);
      setTimeout(() => f.classList.remove('spin'), 900);
    };
  }

  function doneToday() { const today = st.day(); return S.days.includes(today) && S.extraDay !== today; }

  // Прогресс между копиями: взять из репо, если там свежее; иначе отправить свой.
  async function cloudSync() {
    const r = await st.pullProgress();
    if (r.applied) st.addEvent('cloud-load', { ver: BUILD, from: r.from, before: r.before, after: r.after });
    else if (r.ok) await st.pushProgress();
    return r;
  }

  function renderHome() {
    const name = S.settings.name.trim();
    const s = streak();
    const clouds = [[8, 70, -10, .9], [26, 95, -55, .6], [52, 80, -30, 1.1], [74, 110, -80, .7]];
    app.innerHTML = `
      <section class="home">
        <div class="sky" aria-hidden="true">${clouds.map(([top, t, d, sc]) => `<i class="cloud" style="top:${top}%;--t:${t}s;--d:${d}s;--s:${sc}"></i>`).join('')}</div>
        <div class="logo">Поймай <span>смысл</span></div>
        ${name ? `<p class="hello">Привет, ${esc(name)}! Полетели?</p>` : ''}
        <button class="flyer" id="flyer" aria-label="Кувырок!">
          <span class="frame"></span>
          ${[18, 34, 50, 66, 82].map((x, k) => `<i class="gust" style="left:${x}%;--d:${(k * 0.53) % 1.4}s"></i>`).join('')}
        </button>
        <div class="chips">
          <span class="chip">⭐ ${S.stars}</span>
          ${s ? `<span class="chip">🔥 ${s} ${plural(s, 'день', 'дня', 'дней')} подряд</span>` : ''}
          <span class="chip">🐷 ${rub(S.bank.total)}</span>
        </div>
        ${bankHTML()}
        ${doneToday()
          ? '<p class="note">Сегодняшняя тренировка уже пройдена. Приходи завтра!</p>'
          : `<button class="btn primary" id="start">▶ Полетели! · ${SESSION_MS / 60e3} минут</button>`}
        ${!TTS.ok && S.settings.mode !== 'read' ? '<p class="note">Голос не найден: пока играем только глазами.</p>' : ''}
      </section>
      <p class="build">версия ${esc(BUILD)}</p>`;
    const b = $('#start'); if (b) b.onclick = () => runSession();
    bindFlyer(); showPhoto();
  }

  function renderDone(my, add) {
    const s = streak();
    app.innerHTML = `
      <section class="done">
        <h2>${my.test ? 'Тестовая тренировка закончена' : 'Тренировка закончена!'}</h2>
        <div class="bigstars"><span class="pop">★ ${my.stars}</span></div>
        <p class="note">С первого раза: ${my.first} из ${my.n}</p>
        ${add || my.secretRub ? `<div class="bank-add pop">🐷 +${rub((add ? add.add : 0) + my.secretRub)} в копилку</div>
          <div class="bank-why">${add ? `<span class="bank-day">За тренировку:</span> ${bankEq(add)}` : ''}
            ${my.secretRub ? `<span class="why-n">${add ? 'и ' : ''}за секреты +${rub(my.secretRub)}</span>` : ''}</div>` : ''}
        ${s ? `<span class="chip">🔥 ${s} ${plural(s, 'день', 'дня', 'дней')} подряд</span>` : ''}
        <button class="btn primary" id="home">На главную</button>
        <p class="sync" id="syncline">Сохраняю результаты…</p>
      </section>`;
    $('#home').onclick = renderHome;
  }

  function updateSyncLine(res) {
    const el = $('#syncline'); if (!el) return;
    if (res.ok) el.textContent = 'Результаты сохранены ✓';
    else el.textContent = 'Результаты сохранены на этом устройстве, отправлю позже';
  }

  function plural(n, one, few, many) {
    const d = n % 10, h = n % 100;
    if (h >= 11 && h <= 14) return many;
    if (d === 1) return one;
    if (d >= 2 && d <= 4) return few;
    return many;
  }

  // ---------- Экран для взрослых ----------
  function renderParent() {
    if (sess) endSession(true);
    const today = st.day();
    const recs = S.records.filter(r => !r.test && r.game !== 'event');
    const events = S.records.filter(r => r.game === 'event').slice(-15).reverse();
    const todayRecs = recs.filter(r => r.day === today);
    const pct = a => (a.length ? Math.round(a.filter(r => r.first).length / a.length * 100) + '%' : '—');
    // «Глазами / на слух» сравниваем только во «Вспышке» и «Роботе»: «Ловушка» всегда глазами.
    const eyes = a => a.filter(r => r.mode === 'read' && r.game !== 'trap'), ears = a => a.filter(r => r.mode === 'audio');
    const traps = a => a.filter(r => r.game === 'trap');
    const days = [...new Set(recs.map(r => r.day))].sort().slice(-7).reverse();
    const miss = {};
    recs.slice(-300).filter(r => !r.first).forEach(r => (r.trap || []).forEach(w => { const k = w.toLowerCase(); miss[k] = (miss[k] || 0) + 1; }));
    const topMiss = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const set = S.settings;
    const T = Object.assign({ game: 'all', level: 1, mode: 'mix', minutes: 2 }, set.test);
    const opt = (v, cur, label) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${label}</option>`;

    app.innerHTML = `
      <section class="parent">
        <div class="row" style="justify-content:space-between"><h2>Для взрослых</h2><button class="btn small" id="close">Закрыть</button></div>

        <div class="card">
          <h3>Сегодня</h3>
          <div class="kv">
            <div><b>${todayRecs.length}</b><span>заданий</span></div>
            <div><b>${pct(todayRecs)}</b><span>с первого раза</span></div>
            <div><b>${pct(eyes(todayRecs))}</b><span>глазами</span></div>
            <div><b>${pct(ears(todayRecs))}</b><span>на слух</span></div>
            <div><b>${pct(traps(todayRecs))}</b><span>Ловушка</span></div>
            <div><b>${S.levels.trap} / ${S.levels.flash} / ${S.levels.robot}</b><span>уровень Ловушка / Вспышка / Робот</span></div>
            <div><b>${(S.expo).toFixed(2)}×</b><span>время показа фразы</span></div>
          </div>
          ${days.length ? `<div class="tbl-wrap"><table>
            <tr><th>День</th><th>Заданий</th><th>С 1-го раза</th><th>Глазами</th><th>На слух</th><th>Ловушка</th></tr>
            ${days.map(d => { const a = recs.filter(r => r.day === d); return `<tr><td>${d}</td><td>${a.length}</td><td>${pct(a)}</td><td>${pct(eyes(a))}</td><td>${pct(ears(a))}</td><td>${pct(traps(a))}</td></tr>`; }).join('')}
          </table></div>` : '<p class="muted">Пока нет ни одного ответа.</p>'}
          ${topMiss.length ? `<p class="muted">Чаще всего мешали слова: ${topMiss.map(([w, n]) => `<b>${esc(w)}</b> (${n})`).join(', ')}</p>` : ''}
        </div>

        <div class="card">
          <h3>Журнал: что и почему менялось</h3>
          <p class="muted">Эта копия тренажёра: <b>${esc(S.copy)}</b>. Прогресс изменён: ${S.progAt ? fmtTime(S.progAt) : '—'}.
            Вкладка Safari и иконка на экране «Домой» — разные копии со своим хранилищем; прогресс между ними общий через GitHub (state.json).</p>
          ${events.length ? `<div class="tbl-wrap"><table>
            <tr><th>Когда</th><th>Копия</th><th>Что</th></tr>
            ${events.map(e => `<tr><td>${fmtTime(e.t)}</td><td>${esc(e.copy || '')}</td><td class="wrap">${esc(evText(e))}</td></tr>`).join('')}
          </table></div>` : '<p class="muted">Событий пока нет.</p>'}
        </div>

        <div class="card">
          <h3>Копилка</h3>
          <p class="muted">Раз в день, после первой законченной тренировки: ставка × доля ответов с первого раза (100% — вся ставка, 80% — 80%).
            Плюс бонус за каждый найденный секрет. Ребёнок видит на главном и в итоге тренировки, из чего сложилась сумма.
            Сейчас: <b>${rub(S.bank.total)}</b>.</p>
          <div class="row">
            <label>Цель: вещь, сумма, поездка<input id="b-goal" value="${esc(S.bank.goal)}" placeholder="Например: самокат" autocomplete="off"></label>
            <label>Сколько стоит, ₽<input id="b-price" type="number" inputmode="numeric" min="0" value="${S.bank.price || ''}"></label>
            <label>За день при 100%, ₽<input id="b-rate" type="number" inputmode="numeric" min="0" value="${S.bank.rate}"></label>
            <label>За найденный секрет, ₽<input id="b-secret" type="number" inputmode="numeric" min="0" value="${S.bank.secret}"></label>
          </div>
          ${S.bank.log.length ? `<div class="tbl-wrap"><table><tr><th>День</th><th>С 1-го раза</th><th>В копилку</th></tr>
            ${S.bank.log.slice(-10).reverse().map(x => `<tr><td>${x.day}</td><td>${x.kind === 'secret' ? 'секрет' : `${x.first ?? '?'} из ${x.n ?? '?'} (${x.pct}%)`}</td><td>+${rub(x.add)}</td></tr>`).join('')}</table></div>` : ''}
          <div class="row"><button class="btn small" id="b-reset">Цель куплена — обнулить копилку</button></div>
        </div>

        <div class="card">
          <h3>Тренировка</h3>
          <div class="row">
            <label>Имя для приветствия<input id="f-name" value="${esc(set.name)}" autocomplete="off"></label>
            <label>Режим
              <select id="f-mode">
                <option value="mix"${set.mode === 'mix' ? ' selected' : ''}>Смешанный: глазами и на слух</option>
                <option value="read"${set.mode === 'read' ? ' selected' : ''}>Только глазами</option>
                <option value="audio"${set.mode === 'audio' ? ' selected' : ''}>Только на слух</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>Голос
              <select id="f-voice">${TTS.list.length ? TTS.list.map(v => `<option value="${esc(v.voiceURI)}"${TTS.voice && v.voiceURI === TTS.voice.voiceURI ? ' selected' : ''}>${esc(v.name)}</option>`).join('') : '<option value="">Русский голос не найден</option>'}</select>
            </label>
            <button class="btn small" id="f-say">🔊 Проверить голос</button>
          </div>
          ${TTS.list.length ? '' : '<p class="muted">Скачайте русский голос: Настройки → Универсальный доступ → Устный контент → Голоса → Русский.</p>'}
          <div class="row">
            <button class="btn small" id="f-extra"${S.days.includes(today) && S.extraDay !== today ? '' : ' disabled'}>Разрешить ещё одну тренировку сегодня</button>
          </div>
        </div>

        <div class="card">
          <h3>Проверка для взрослых</h3>
          <p class="muted">Тестовая тренировка не меняет звёзды, уровни и статистику ребёнка. Её ответы попадают в логи с пометкой test.</p>
          <div class="row">
            <label>Игра<select id="t-game">${opt('all', T.game, 'Все по очереди')}${opt('trap', T.game, 'Ловушка')}${opt('flash', T.game, 'Вспышка')}${opt('robot', T.game, 'Робот')}</select></label>
            <label>Уровень<select id="t-level">${opt(1, T.level, '1 — простой')}${opt(2, T.level, '2 — не, кроме, только')}${opt(3, T.level, '3 — сложный')}</select></label>
            <label>Режим<select id="t-mode">${opt('mix', T.mode, 'Смешанный')}${opt('read', T.mode, 'Глазами')}${opt('audio', T.mode, 'На слух')}</select></label>
            <label>Длительность<select id="t-min">${opt(2, T.minutes, '2 минуты')}${opt(15, T.minutes, '15 минут')}</select></label>
          </div>
          <div class="row">
            <button class="btn primary small" id="t-start">▶ Тестовая тренировка</button>
            <button class="btn small danger" id="t-reset">Сбросить прогресс ребёнка</button>
          </div>
          <p class="muted">Сброс обнуляет звёзды, уровни, серию дней и время показа, а прошлые ответы помечает как тестовые. Имя, голос и токен сохраняются.</p>
        </div>

        <div class="card">
          <h3>Отправка логов в GitHub</h3>
          <div class="row">
            <label>Репозиторий<input id="f-repo" value="${esc(set.repo)}" placeholder="владелец/репозиторий" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            <label>Токен<input id="f-token" type="password" value="${esc(set.token)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          </div>
          <div class="row">
            <button class="btn small" id="f-check">Проверить связь</button>
            <button class="btn small" id="f-sync">Отправить сейчас</button>
            <button class="btn small" id="f-copy">Скопировать логи за сегодня</button>
          </div>
          <div class="row">
            <button class="btn small" id="f-key">🔑 Скопировать ссылку-ключ</button>
          </div>
          <p class="muted">Ссылка-ключ хранит репозиторий и токен в самом адресе. Сохраните её в Заметках: открыть на iPad —
            и настройки на месте. Чтобы иконка «Домой» восстанавливала токен сама: откройте ссылку в Safari →
            «Поделиться» → «На экран „Домой“». Эта копия запущена ${launchedWithKey ? '<b>со ссылкой-ключом</b> ✓' : '<b>без ссылки-ключа</b>'}.</p>
          <input id="f-keyout" readonly hidden>
          <p class="muted status" id="f-status">Не отправлено: ${st.pendingCount()}. ${S.lastSync ? 'Последняя отправка: ' + new Date(S.lastSync).toLocaleString('ru-RU') + '.' : 'Отправок ещё не было.'} ${S.syncError ? 'Ошибка: ' + esc(S.syncError) : ''}</p>
        </div>
      </section>`;

    const status = (text, ok) => { const el = $('#f-status'); el.textContent = text; el.className = 'muted status ' + (ok ? 'ok' : 'bad'); };
    const saveSettings = () => {
      set.name = $('#f-name').value.trim();
      set.mode = $('#f-mode').value;
      set.voice = $('#f-voice').value;
      set.repo = $('#f-repo').value.trim();
      set.token = $('#f-token').value.trim();
      st.save(); TTS.init(); keepKeyInUrl();
    };
    app.querySelectorAll('input, select').forEach(el => { el.onchange = saveSettings; });
    // Цель и ставка копилки — часть прогресса: уходят в state.json и видны во всех копиях.
    const saveBank = () => {
      const b = S.bank, key = () => `${b.goal}|${b.price}|${b.rate}|${b.secret}`, before = key();
      b.goal = $('#b-goal').value.trim();
      b.price = Math.max(0, Math.round(+$('#b-price').value || 0));
      b.rate = Math.max(0, Math.round(+$('#b-rate').value || 0));
      b.secret = Math.max(0, Math.round(+$('#b-secret').value || 0));
      if (before === key()) return;
      st.addEvent('bank-set', { ver: BUILD, goal: b.goal, price: b.price, rate: b.rate, secret: b.secret });
      st.touchProgress(); st.save(); st.pushProgress();
    };
    ['#b-goal', '#b-price', '#b-rate', '#b-secret'].forEach(id => { $(id).onchange = saveBank; });
    $('#b-reset').onclick = e => {
      const btn = e.currentTarget;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1'; btn.textContent = `Точно обнулить ${rub(S.bank.total)}? Нажмите ещё раз`;
        setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'Цель куплена — обнулить копилку'; } }, 4000);
        return;
      }
      st.addEvent('bank-reset', { ver: BUILD, total: S.bank.total, goal: S.bank.goal });
      S.bank.total = 0; st.touchProgress(); st.save(); st.pushProgress();
      renderParent();
      status('Копилка обнулена', true);
    };
    $('#close').onclick = () => { saveSettings(); saveBank(); renderHome(); refreshPhotos(); st.refreshFamily(); };
    $('#f-say').onclick = () => { saveSettings(); TTS.unlock(); TTS.speak('Все круги синие, кроме одного красного.'); };
    $('#f-extra').onclick = e => {
      S.extraDay = today; st.touchProgress(); st.addEvent('extra', { ver: BUILD }); st.pushProgress();
      e.target.disabled = true; e.target.textContent = 'Разрешено ✓';
    };
    $('#f-check').onclick = async () => { saveSettings(); status('Проверяю…', true); const r = await st.checkRepo(); status(r.text, r.ok); };
    $('#f-sync').onclick = async () => {
      saveSettings(); status('Отправляю…', true);
      const r = await st.sync();
      status(r.ok ? `Готово: отправлено ${r.sent}, не отправлено ${st.pendingCount()}` : 'Не получилось: ' + r.text, r.ok);
    };
    const readTest = () => {
      set.test = { game: $('#t-game').value, level: +$('#t-level').value, mode: $('#t-mode').value, minutes: +$('#t-min').value };
      st.save();
      return set.test;
    };
    ['#t-game', '#t-level', '#t-mode', '#t-min'].forEach(id => { $(id).onchange = readTest; });
    $('#t-start').onclick = () => { saveSettings(); runSession({ test: readTest() }); };
    $('#t-reset').onclick = e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = 'Точно сбросить? Нажмите ещё раз';
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Сбросить прогресс ребёнка'; } }, 4000);
        return;
      }
      const before = st.snapshot();
      Object.assign(S, { levels: { flash: 1, robot: 1, trap: 1 }, hist: { flash: [], robot: [], trap: [] }, expo: 1, stars: 0, days: [], extraDay: '' });
      S.records.forEach(r => { r.test = true; });
      st.touchProgress(); st.addEvent('reset', { ver: BUILD, before });
      st.pushProgress();
      renderParent();
      status('Прогресс сброшен: всё как в первый день', true);
    };
    $('#f-key').onclick = async () => {
      saveSettings();
      if (!set.repo || !set.token) { status('Сначала введите репозиторий и токен', false); return; }
      const link = keyLink();
      try { await navigator.clipboard.writeText(link); status('Ссылка-ключ скопирована', true); }
      catch (e) { const o = $('#f-keyout'); o.hidden = false; o.value = link; o.select(); status('Скопируйте ссылку из поля ниже', true); }
    };
    $('#f-copy').onclick = async () => {
      const text = JSON.stringify(S.records.filter(r => r.day === today), null, 1);
      try { await navigator.clipboard.writeText(text); status('Скопировано: ' + todayRecs.length + ' записей', true); }
      catch (e) { status('Не удалось скопировать', false); }
    };
  }

  const fmtTime = iso => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lv = x => (x ? `${x.levels.flash}/${x.levels.robot}${x.levels.trap ? '/' + x.levels.trap : ''}` : '?');
  const GAME_NAME = { flash: 'Вспышка', robot: 'Робот', trap: 'Ловушка' };
  const EV_TEXT = {
    'new-copy': () => 'Новая копия хранилища: прогресс с нуля',
    'cloud-load': e => `Прогресс взят из GitHub (от копии ${e.from || '?'}): уровни ${lv(e.before)} → ${lv(e.after)}, звёзды ${e.before.stars} → ${e.after.stars}`,
    reset: e => `Сброс прогресса взрослым (было: уровни ${lv(e.before)}, звёзды ${e.before ? e.before.stars : '?'})`,
    level: e => `${GAME_NAME[e.game] || e.game}: уровень ${e.from} → ${e.to} — ${e.to > e.from ? '5 из 6 последних с первого раза' : 'из 4 последних с первого раза не больше 1'}`,
    'parent-open': () => 'Вход в меню взрослых',
    'gate-fail': e => `Неверный ответ на входе в меню взрослых: «${e.answer || ''}»`,
    extra: () => 'Разрешена ещё одна тренировка сегодня',
    bank: e => `Копилка: +${rub(e.add)} (${e.first ?? '?'} из ${e.n ?? '?'} с первого раза), всего ${rub(e.total)}`,
    'bank-set': e => `Копилка: цель «${e.goal || '—'}», ${rub(e.price)}, ставка ${rub(e.rate)} в день, за секрет ${rub(e.secret ?? 0)}`,
    'bank-secret': e => `Копилка: +${rub(e.add)} за секрет, всего ${rub(e.total)}`,
    'bank-reset': e => `Копилка обнулена (было ${rub(e.total)}, цель «${e.goal || '—'}»)`,
    'key-link': e => (e.replaced ? 'Настройки GitHub заменены из ссылки-ключа' : 'Токен восстановлен из ссылки-ключа — вводить не пришлось'),
  };
  const evText = e => (EV_TEXT[e.ev] ? EV_TEXT[e.ev](e) : e.ev);

  // ---------- Ссылка-ключ ----------
  // Настройки GitHub лежат во фрагменте адреса (#k=…): он не уходит на сервер, но остаётся в адресе вкладки
  // Safari и в иконке «Домой». Хранилище копии пустое или стёрто — токен берётся оттуда, вводить заново не нужно.
  const keyEnc = s => st.b64enc(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const keyDec = s => st.b64dec(s.replace(/-/g, '+').replace(/_/g, '/'));
  const keyHash = () => '#k=' + keyEnc(JSON.stringify({ r: S.settings.repo, t: S.settings.token, n: S.settings.name }));
  const keyLink = () => location.origin + location.pathname + keyHash();
  const launchedWithKey = /[#&]k=/.test(location.hash);
  function applyKeyLink() {
    const m = location.hash.match(/[#&]k=([\w-]+)/); if (!m) return;
    let k; try { k = JSON.parse(keyDec(m[1])); } catch (e) { return; }
    const set = S.settings;
    if (!k.r || !k.t || (set.repo === k.r && set.token === k.t)) return;
    const replaced = !!set.token;
    set.repo = k.r; set.token = k.t; if (!set.name && k.n) set.name = k.n;
    st.addEvent('key-link', { ver: BUILD, replaced });
  }
  // Ключ всегда в адресе: «На экран „Домой“» из Safari и сама вкладка унесут его с собой.
  function keepKeyInUrl() {
    if (!S.settings.repo || !S.settings.token) return;
    try { if (location.hash !== keyHash()) history.replaceState(null, '', keyHash()); } catch (e) { /* нет history */ }
  }

  // Вход для взрослых: удержать шестерёнку 2 секунды и решить пример, который второкласснику не по силам.
  function renderGate() {
    if ($('#gate')) return;
    const a = 13 + Math.floor(Math.random() * 27), b = 3 + Math.floor(Math.random() * 7);
    const el = document.createElement('div');
    el.className = 'gate'; el.id = 'gate';
    el.innerHTML = `<form class="card" id="gate-f">
        <h3>Для взрослых</h3>
        <label>Сколько будет ${a} × ${b}?<input id="gate-a" inputmode="numeric" pattern="[0-9]*" autocomplete="off"></label>
        <p class="muted status bad" id="gate-m"></p>
        <div class="row"><button class="btn primary small">Войти</button><button type="button" class="btn small" id="gate-x">Отмена</button></div>
      </form>`;
    document.body.append(el);
    const close = () => el.remove();
    $('#gate-x', el).onclick = close;
    $('#gate-f', el).onsubmit = e => {
      e.preventDefault();
      const ans = $('#gate-a', el).value.trim();
      if (+ans === a * b) { close(); st.addEvent('parent-open', { ver: BUILD }); renderParent(); return; }
      st.addEvent('gate-fail', { ver: BUILD, answer: ans.slice(0, 6) });
      $('#gate-m', el).textContent = 'Неверно';
      setTimeout(close, 1200);
    };
    setTimeout(() => $('#gate-a', el).focus(), 50);
  }

  // Вход для взрослых — удерживать шестерёнку 2 секунды.
  function bindGear() {
    const g = $('#gear');
    // Срабатывание — по таймеру; кольцо на кадрах анимации только показывает прогресс.
    let t0 = 0, raf = 0, timer = 0;
    const stop = () => { cancelAnimationFrame(raf); clearTimeout(timer); t0 = 0; g.classList.remove('hold'); g.style.removeProperty('--p'); };
    const loop = () => {
      g.style.setProperty('--p', Math.min((performance.now() - t0) / 20, 100) + '%');
      raf = requestAnimationFrame(loop);
    };
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); t0 = performance.now(); g.classList.add('hold'); loop();
      timer = setTimeout(() => { stop(); renderGate(); }, 2000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => g.addEventListener(ev, stop));
    g.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------- Запуск ----------
  if (st.isNewCopy) st.addEvent('new-copy', { ver: BUILD });
  applyKeyLink();
  keepKeyInUrl();
  TTS.init();
  bindGear();
  const demo = new URLSearchParams(location.search).get('demo');
  if (PLAY[demo]) runSession({ demo });
  else renderHome();

  // Свежий прогресс из репо — при запуске и при каждом возвращении в приложение (вне тренировки).
  const cloudRefresh = () => { if (!sess) cloudSync().then(r => { if (r.applied && $('.home')) renderHome(); }); };
  refreshPhotos();
  st.refreshFamily();
  cloudRefresh();
  if (st.pendingCount()) st.sync();
  window.addEventListener('online', () => st.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (st.pendingCount()) st.sync();
    cloudRefresh();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
