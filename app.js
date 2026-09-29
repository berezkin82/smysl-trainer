// Тренажёр «Поймай смысл»: тренировка из блоков по 2 минуты, игры «Вспышка» и «Робот»,
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

  const SESSION_MS = 10 * 60e3, BLOCK_MS = 2 * 60e3;
  // Порядок блоков: игра и режим (в смешанном режиме глаза и слух чередуются).
  const PLAN = [['flash', 'read'], ['robot', 'audio'], ['flash', 'audio'], ['robot', 'read'], ['flash', 'read']];
  const GAMES = {
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
        this.list = speechSynthesis.getVoices().filter(v => /^ru/i.test(v.lang));
        this.voice = this.list.find(v => v.voiceURI === S.settings.voice)
          || this.list.find(v => /enhanced|premium|улучш/i.test(v.name))
          || this.list.find(v => /milena|милена/i.test(v.name))
          || this.list[0] || null;
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
    return text.split(/([А-Яа-яЁё]+)/).map(p => (set.has(p.toLowerCase()) ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }
  const sentence = (text, trap) => `<p class="sentence">${trap ? markTrap(text, trap) : esc(text)}</p>`;
  const sceneHTML = s => s.items.map(e => `<span>${e}</span>`).join('');

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
      if (bar) bar.style.width = clamp(sess.elapsed / SESSION_MS * 100, 0, 100) + '%';
    }, 250);
  }

  function effectiveMode(planMode) {
    const m = S.settings.mode;
    const want = m === 'mix' ? planMode : m;
    return want === 'audio' && !TTS.ok ? 'read' : want;
  }

  function barHTML() {
    return `<div class="bar">
      <button class="exit" id="exit">✕ Выйти</button>
      <div class="progress" aria-label="Сколько тренировки пройдено"><i style="width:${clamp(sess.elapsed / SESSION_MS * 100, 0, 100)}%"></i></div>
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

  async function runSession(opts = {}) {
    TTS.unlock();
    const my = sess = { id: Date.now().toString(36), elapsed: 0, stars: 0, n: 0, first: 0, active: false, seq: 0, demo: !!opts.demo };
    startTicker(); requestWake();
    try {
      const plan = opts.demo ? [[opts.demo, 'read']] : PLAN;
      for (let b = 0; b < plan.length && sess.elapsed < SESSION_MS; b++) {
        const [game, planMode] = plan[b];
        const mode = effectiveMode(planMode);
        if (!opts.demo) await showIntro(my, game, mode, b);
        const blockEnd = Math.min(sess.elapsed + BLOCK_MS, SESSION_MS);
        do {
          my.active = true;
          await (game === 'flash' ? playFlash : playRobot)(my, mode);
          my.active = false;
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
    if (!aborted) {
      const today = st.day();
      if (!S.days.includes(today)) S.days.push(today);
      else if (S.extraDay === today) S.extraDay = '';
      st.save();
      renderDone(my);
    } else renderHome();
    st.sync().then(updateSyncLine);
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
    if (first) { my.first++; my.stars++; if (!my.demo) S.stars++; }
    if (!my.demo) {
      st.addRecord({
        id: `${my.id}-${++my.seq}`, sid: my.id, game, tpl: task.tpl, level: task.level, mode,
        text: task.text, trap: task.trap, expo: r.expo || null, replays: r.replays, attempts: r.attempts,
        correct: r.correct, first, rt: r.rt,
      });
      const h = S.hist[game];
      h.push(first ? 1 : 0); if (h.length > 6) h.shift();
      const sum = a => a.reduce((x, y) => x + y, 0);
      if (h.length >= 6 && sum(h) >= 5 && S.levels[game] < 3) { S.levels[game]++; S.hist[game] = []; r.levelUp = true; }
      else if (h.length >= 4 && sum(h.slice(-4)) <= 1 && S.levels[game] > 1) { S.levels[game]--; S.hist[game] = []; }
      if (game === 'flash' && mode === 'read') S.expo = clamp(first ? S.expo * 0.92 : r.correct ? S.expo : S.expo * 1.15, 0.45, 2);
      st.save();
    }
    const s = $('#sstars');
    if (s) {
      s.textContent = my.stars;
      if (first) { const p = s.parentElement; p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
    }
    return first;
  }

  async function showResult(my, first, correct, levelUp) {
    const fb = $('#fb');
    fb.className = 'feedback ' + (correct ? 'ok' : 'bad');
    fb.innerHTML = first ? `<span class="pop">⭐</span> ${pick(PRAISE)}`
      : correct ? 'Правильно! Подчёркнутые слова помогли.'
      : 'Ничего! Посмотри, как было правильно.';
    if (levelUp) fb.innerHTML += '<br><span class="pop">🚀 Новый уровень!</span>';
    const next = $('#next');
    if (first && !levelUp) { await wait(1600); alive(my); return; }
    next.hidden = false;
    await new Promise(res => { next.onclick = res; });
    alive(my);
  }

  // ---------- «Вспышка» ----------
  async function playFlash(my, mode) {
    const task = C.flash(S.levels.flash);
    const expo = Math.round(clamp((900 + 60 * task.text.length) * S.expo, 1500, 9000));
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
    let replays = 0, attempts = 0, correct = false, rt = null, busy = false;

    const present = async () => {
      busy = true; again.disabled = true; opts.hidden = true;
      if (mode === 'read') {
        prompt.innerHTML = sentence(task.text) + '<div class="timer"><i></i></div>';
        const bar = $('.timer i', prompt);
        bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: expo, easing: 'linear', fill: 'forwards' });
        await wait(expo);
      } else {
        prompt.innerHTML = '<div class="listen on">🔊</div><p class="hint">Слушай внимательно</p>';
        await TTS.speak(task.text);
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
        prompt.innerHTML = sentence(task.text, task.trap) + '<p class="hint">Посмотри на подчёркнутые слова и попробуй ещё раз</p>';
        if (mode === 'audio') TTS.speak(task.text);
      }
    }
    opts.onclick = null; again.onclick = null; again.hidden = true;
    [...opts.children].forEach((b, i) => { b.disabled = true; if (C.sceneKey(task.options[i]) === okKey) b.classList.add('ok'); });
    prompt.innerHTML = sentence(task.text, task.trap);
    const r = { correct, attempts, replays, rt, expo: mode === 'read' ? expo : null };
    const first = finishTask(my, 'flash', mode, task, r);
    await showResult(my, first, correct, r.levelUp);
  }

  // ---------- «Робот» ----------
  async function playRobot(my, mode) {
    const task = C.robot(S.levels.robot);
    app.innerHTML = `${barHTML()}
      <section class="task">
        <div class="prompt" id="prompt"></div>
        <div class="field" id="field" hidden>${task.items.map((it, i) => `<button class="cell" data-i="${i}" aria-pressed="false">${it.e}</button>`).join('')}</div>
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
    let replays = 0, attempts = 0, correct = false, rt = null, busy = false;
    const ASK = '<p class="ask">Выполни команду</p>';

    // Первый показ: фраза видна, пока не нажмут «Понятно!»; на слух — звучит один раз.
    if (mode === 'read') {
      prompt.innerHTML = sentence(task.text) + '<div class="actions"><button class="btn primary" id="got">Понятно!</button></div>';
      await new Promise(res => { $('#got').onclick = res; });
    } else {
      prompt.innerHTML = '<div class="listen on">🔊</div><p class="hint">Слушай команду</p>';
      await TTS.speak(task.text);
    }
    alive(my);
    prompt.innerHTML = ASK;
    field.hidden = false; again.hidden = false; check.hidden = false;
    const tAsk = performance.now();

    field.onclick = e => {
      const c = e.target.closest('.cell'); if (!c || busy) return;
      const i = +c.dataset.i;
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      c.classList.toggle('sel', sel.has(i)); c.setAttribute('aria-pressed', sel.has(i));
      check.disabled = sel.size === 0;
    };
    again.onclick = async () => {
      if (busy) return;
      replays++; busy = true; again.disabled = true;
      if (mode === 'read') { prompt.innerHTML = sentence(task.text); await wait(2500); }
      else { prompt.innerHTML = '<div class="listen on">🔊</div>'; await TTS.speak(task.text); }
      if (sess !== my) return;
      prompt.innerHTML = ASK; busy = false; again.disabled = false;
    };

    while (attempts < 2 && !correct) {
      await new Promise(res => { check.onclick = () => { if (!busy && sel.size) res(); }; });
      alive(my);
      attempts++;
      if (rt === null) rt = Math.round(performance.now() - tAsk);
      correct = C.robotCheck(task, sel);
      if (!correct && attempts < 2) {
        busy = true;
        cells.forEach((c, i) => { if (sel.has(i) && !task.pred(task.items[i])) c.classList.add('bad'); });
        prompt.innerHTML = sentence(task.text, task.trap) + '<p class="hint">Посмотри на подчёркнутые слова и исправь</p>';
        if (mode === 'audio') TTS.speak(task.text);
        await wait(1200); alive(my);
        cells.forEach(c => c.classList.remove('bad'));
        busy = false;
      }
    }
    field.onclick = null; check.hidden = true; again.hidden = true;
    busy = true;
    prompt.innerHTML = sentence(task.text, task.trap) + (task.exact && !correct ? `<p class="hint">Нужно было выбрать ровно ${task.exact}</p>` : '');
    cells.forEach((c, i) => {
      const need = task.pred(task.items[i]);
      if (sel.has(i) && need) c.classList.add('hit');
      else if (sel.has(i)) c.classList.add('bad');
      else if (need && !correct) c.classList.add('need');
    });
    const r = { correct, attempts, replays, rt };
    const first = finishTask(my, 'robot', mode, task, r);
    await showResult(my, first, correct, r.levelUp);
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

  function renderHome() {
    const today = st.day();
    const doneToday = S.days.includes(today) && S.extraDay !== today;
    const name = S.settings.name.trim();
    const s = streak();
    app.innerHTML = `
      <section class="home">
        <div class="logo">Поймай <span>смысл</span></div>
        ${name ? `<p class="hello">Привет, ${esc(name)}!</p>` : ''}
        <div class="chips">
          <span class="chip">⭐ ${S.stars}</span>
          ${s ? `<span class="chip">🔥 ${s} ${plural(s, 'день', 'дня', 'дней')} подряд</span>` : ''}
        </div>
        ${doneToday
          ? '<p class="note">Сегодняшняя тренировка уже пройдена. Приходи завтра!</p>'
          : '<button class="btn primary" id="start">▶ Начать · 10 минут</button>'}
        ${!TTS.ok && S.settings.mode !== 'read' ? '<p class="note">Голос не найден: пока играем только глазами.</p>' : ''}
      </section>`;
    const b = $('#start'); if (b) b.onclick = () => runSession();
  }

  function renderDone(my) {
    const s = streak();
    app.innerHTML = `
      <section class="done">
        <h2>Тренировка закончена!</h2>
        <div class="bigstars"><span class="pop">★ ${my.stars}</span></div>
        <p class="note">С первого раза: ${my.first} из ${my.n}</p>
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
    const recs = S.records;
    const todayRecs = recs.filter(r => r.day === today);
    const pct = a => (a.length ? Math.round(a.filter(r => r.first).length / a.length * 100) + '%' : '—');
    const days = [...new Set(recs.map(r => r.day))].sort().slice(-7).reverse();
    const miss = {};
    recs.slice(-300).filter(r => !r.first).forEach(r => (r.trap || []).forEach(w => { const k = w.toLowerCase(); miss[k] = (miss[k] || 0) + 1; }));
    const topMiss = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const set = S.settings;

    app.innerHTML = `
      <section class="parent">
        <div class="row" style="justify-content:space-between"><h2>Для взрослых</h2><button class="btn small" id="close">Закрыть</button></div>

        <div class="card">
          <h3>Сегодня</h3>
          <div class="kv">
            <div><b>${todayRecs.length}</b><span>заданий</span></div>
            <div><b>${pct(todayRecs)}</b><span>с первого раза</span></div>
            <div><b>${pct(todayRecs.filter(r => r.mode === 'read'))}</b><span>глазами</span></div>
            <div><b>${pct(todayRecs.filter(r => r.mode === 'audio'))}</b><span>на слух</span></div>
            <div><b>${S.levels.flash} / ${S.levels.robot}</b><span>уровень Вспышка / Робот</span></div>
            <div><b>${(S.expo).toFixed(2)}×</b><span>время показа фразы</span></div>
          </div>
          ${days.length ? `<div class="tbl-wrap"><table>
            <tr><th>День</th><th>Заданий</th><th>С 1-го раза</th><th>Глазами</th><th>На слух</th></tr>
            ${days.map(d => { const a = recs.filter(r => r.day === d); return `<tr><td>${d}</td><td>${a.length}</td><td>${pct(a)}</td><td>${pct(a.filter(r => r.mode === 'read'))}</td><td>${pct(a.filter(r => r.mode === 'audio'))}</td></tr>`; }).join('')}
          </table></div>` : '<p class="muted">Пока нет ни одного ответа.</p>'}
          ${topMiss.length ? `<p class="muted">Чаще всего мешали слова: ${topMiss.map(([w, n]) => `<b>${esc(w)}</b> (${n})`).join(', ')}</p>` : ''}
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
      st.save(); TTS.init();
    };
    app.querySelectorAll('input, select').forEach(el => { el.onchange = saveSettings; });
    $('#close').onclick = () => { saveSettings(); renderHome(); };
    $('#f-say').onclick = () => { saveSettings(); TTS.unlock(); TTS.speak('Все круги синие, кроме одного красного.'); };
    $('#f-extra').onclick = e => { S.extraDay = today; st.save(); e.target.disabled = true; e.target.textContent = 'Разрешено ✓'; };
    $('#f-check').onclick = async () => { saveSettings(); status('Проверяю…', true); const r = await st.checkRepo(); status(r.text, r.ok); };
    $('#f-sync').onclick = async () => {
      saveSettings(); status('Отправляю…', true);
      const r = await st.sync();
      status(r.ok ? `Готово: отправлено ${r.sent}, не отправлено ${st.pendingCount()}` : 'Не получилось: ' + r.text, r.ok);
    };
    $('#f-copy').onclick = async () => {
      const text = JSON.stringify(S.records.filter(r => r.day === today), null, 1);
      try { await navigator.clipboard.writeText(text); status('Скопировано: ' + todayRecs.length + ' записей', true); }
      catch (e) { status('Не удалось скопировать', false); }
    };
  }

  // Вход для взрослых — удерживать шестерёнку 2 секунды.
  function bindGear() {
    const g = $('#gear');
    let t0 = 0, raf = 0;
    const stop = () => { cancelAnimationFrame(raf); t0 = 0; g.classList.remove('hold'); g.style.removeProperty('--p'); };
    const loop = () => {
      const p = (performance.now() - t0) / 2000;
      g.style.setProperty('--p', Math.min(p * 100, 100) + '%');
      if (p >= 1) { stop(); renderParent(); return; }
      raf = requestAnimationFrame(loop);
    };
    g.addEventListener('pointerdown', e => { e.preventDefault(); t0 = performance.now(); g.classList.add('hold'); loop(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => g.addEventListener(ev, stop));
    g.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------- Запуск ----------
  TTS.init();
  bindGear();
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo === 'flash' || demo === 'robot') runSession({ demo });
  else renderHome();

  if (st.pendingCount()) st.sync();
  window.addEventListener('online', () => st.sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.pendingCount()) st.sync(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
