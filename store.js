// Хранение: всё состояние в localStorage; ответы отправляются в приватный репо GitHub
// (файл ГГГГ-ММ-ДД.json на день). Без сети или без токена ответы ждут на устройстве.
// Прогресс ребёнка дублируется в репо файлом state.json: на iPad у тренажёра бывает несколько
// независимых хранилищ (Safari и иконка на экране «Домой»), и у каждого был свой прогресс.
(function (root) {
  'use strict';

  const KEY = 'smysl.v1';
  const MAX_RECORDS = 5000;
  const DEFAULTS = {
    settings: { name: '', mode: 'mix', voice: '', repo: '', token: '', test: null },
    records: [],          // все ответы; r.synced — отправлен ли в GitHub
    levels: { flash: 1, robot: 1 },
    hist: { flash: [], robot: [] },   // последние «с первого раза» для смены уровня
    expo: 1,              // множитель времени показа во «Вспышке»
    stars: 0,
    days: [],             // дни с законченной тренировкой
    extraDay: '',         // день, на который родитель разрешил ещё одну тренировку
    lastSync: '', syncError: '',
    copy: '',             // номер этой копии хранилища — виден в логах и журнале
    progAt: '',           // когда последний раз менялся прогресс (для сверки с state.json)
  };
  // Что считается прогрессом ребёнка и синхронизируется между копиями.
  const PROG = ['levels', 'hist', 'expo', 'stars', 'days', 'extraDay'];

  function load(storage) {
    let saved = {};
    try { saved = JSON.parse(storage.getItem(KEY)) || {}; } catch (e) { /* пусто */ }
    const s = Object.assign({}, DEFAULTS, saved);
    s.settings = Object.assign({}, DEFAULTS.settings, saved.settings);
    s.levels = Object.assign({}, DEFAULTS.levels, saved.levels);
    s.hist = Object.assign({ flash: [], robot: [] }, saved.hist);
    return s;
  }

  function create(storage, fetchFn) {
    const S = load(storage);
    // Пустое хранилище без номера — новая копия (первый запуск, другой контейнер или данные стёрты).
    const isNewCopy = !S.copy;
    if (isNewCopy) S.copy = Math.random().toString(36).slice(2, 6);
    const save = () => {
      if (S.records.length > MAX_RECORDS) S.records = S.records.slice(-MAX_RECORDS);
      try { storage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ }
    };

    const pad = n => String(n).padStart(2, '0');
    const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function b64enc(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    function b64dec(b64) {
      const bin = atob(b64.replace(/\s/g, ''));
      return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    }

    const headers = () => ({
      Authorization: 'Bearer ' + S.settings.token.trim(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    const repoUrl = () => 'https://api.github.com/repos/' + S.settings.repo.trim();

    async function checkRepo() {
      if (!S.settings.repo || !S.settings.token) return { ok: false, text: 'Заполните репозиторий и токен' };
      try {
        const r = await fetchFn(repoUrl(), { headers: headers(), cache: 'no-store' });
        if (r.status === 200) return { ok: true, text: 'Связь с GitHub есть' };
        if (r.status === 401) return { ok: false, text: 'Токен не подходит (401)' };
        if (r.status === 404) return { ok: false, text: 'Репозиторий не найден или токену он не открыт (404)' };
        return { ok: false, text: 'GitHub ответил ' + r.status };
      } catch (e) { return { ok: false, text: 'Нет сети' }; }
    }

    // Дописать ответы дня в файл: прочитать, слить по id, записать. 409 — файл успел измениться, повторяем.
    async function putDay(d, recs) {
      const url = `${repoUrl()}/contents/${d}.json`;
      for (let attempt = 0; attempt < 3; attempt++) {
        let sha, data = { date: d, records: [] };
        const g = await fetchFn(url, { headers: headers(), cache: 'no-store' });
        if (g.status === 200) { const j = await g.json(); sha = j.sha; data = JSON.parse(b64dec(j.content)); }
        else if (g.status !== 404) throw new Error('GitHub ' + g.status);
        const have = new Set(data.records.map(r => r.id));
        for (const r of recs) if (!have.has(r.id)) { const c = Object.assign({}, r); delete c.synced; data.records.push(c); }
        const body = { message: `Логи ${d}`, content: b64enc(JSON.stringify(data, null, 1)) };
        if (sha) body.sha = sha;
        const p = await fetchFn(url, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
        if (p.ok) return;
        if (p.status !== 409 && p.status !== 422) throw new Error('GitHub ' + p.status);
      }
      throw new Error('GitHub: конфликт записи');
    }

    let syncing = null;
    function sync() {
      if (syncing) return syncing;
      syncing = (async () => {
        const pending = S.records.filter(r => !r.synced);
        if (!pending.length) return { ok: true, sent: 0 };
        if (!S.settings.repo || !S.settings.token) return { ok: false, sent: 0, text: 'GitHub не настроен' };
        const byDay = {};
        for (const r of pending) (byDay[r.day] = byDay[r.day] || []).push(r);
        let sent = 0;
        try {
          for (const d of Object.keys(byDay).sort()) {
            await putDay(d, byDay[d]);
            byDay[d].forEach(r => { r.synced = true; });
            sent += byDay[d].length;
            save();
          }
          S.lastSync = new Date().toISOString(); S.syncError = ''; save();
          return { ok: true, sent };
        } catch (e) {
          S.syncError = e.message === 'Failed to fetch' || e.name === 'TypeError' ? 'Нет сети' : e.message;
          save();
          return { ok: false, sent, text: S.syncError };
        }
      })().finally(() => { syncing = null; });
      return syncing;
    }

    // Фото для главного экрана лежат в приватном репо (папка photos/), в публичный код не попадают.
    // Скачиваются по токену в Cache Storage и дальше показываются без сети. Ключ — sha файла:
    // заменили фото в репо — скачается новое, удалили — пропадёт и здесь.
    const PHOTO_CACHE = 'smysl-photos', PHOTO_KEY = 'https://photo.local/';
    const hasCaches = () => typeof caches !== 'undefined';

    async function cachedPhotos() {
      if (!hasCaches()) return [];
      const read = (async () => {
        const c = await caches.open(PHOTO_CACHE);
        const keys = await c.keys();
        return Promise.all(keys.map(async k => (await c.match(k)).blob()));
      })().catch(() => []);
      // Хранилище может не ответить (приватный режим и т. п.) — тогда главный экран без фото.
      return Promise.race([read, new Promise(res => setTimeout(() => res([]), 3000))]);
    }

    async function refreshPhotos() {
      if (!hasCaches() || !S.settings.repo || !S.settings.token) return false;
      try {
        const r = await fetchFn(`${repoUrl()}/contents/photos`, { headers: headers(), cache: 'no-store' });
        if (r.status !== 200 && r.status !== 404) return false;
        const list = r.status === 404 ? [] : (await r.json()).filter(f => f.type === 'file' && /\.(jpe?g|png|webp)$/i.test(f.name));
        const want = new Map(list.map(f => [PHOTO_KEY + f.sha, f]));
        const c = await caches.open(PHOTO_CACHE);
        let changed = false;
        for (const k of await c.keys()) if (!want.has(k.url)) { await c.delete(k); changed = true; }
        for (const [key, f] of want) {
          if (await c.match(key)) continue;
          const g = await fetchFn(f.url, { headers: headers(), cache: 'no-store' });
          if (!g.ok) continue;
          const bin = atob((await g.json()).content.replace(/\s/g, ''));
          const type = /\.png$/i.test(f.name) ? 'image/png' : /\.webp$/i.test(f.name) ? 'image/webp' : 'image/jpeg';
          await c.put(key, new Response(new Blob([Uint8Array.from(bin, ch => ch.charCodeAt(0))], { type }), { headers: { 'Content-Type': type } }));
          changed = true;
        }
        return changed;
      } catch (e) { return false; }
    }

    function addRecord(r) { S.records.push(Object.assign({ day: day(), t: new Date().toISOString(), copy: S.copy, synced: false }, r)); save(); }
    // Событие для журнала (вход в меню, сброс, смена уровня…): уходит в логи вместе с ответами, game: 'event'.
    let evSeq = 0;
    function addEvent(ev, data) {
      addRecord(Object.assign({ id: `${S.copy}-${Date.now().toString(36)}-${++evSeq}`, game: 'event', ev }, data));
    }

    // ---------- Прогресс в репо (state.json) ----------
    const snapshot = () => ({ levels: Object.assign({}, S.levels), expo: +(+S.expo).toFixed(2), stars: S.stars, days: S.days.length });
    function touchProgress() { S.progAt = new Date().toISOString(); }
    async function getState() {
      const r = await fetchFn(`${repoUrl()}/contents/state.json`, { headers: headers(), cache: 'no-store' });
      if (r.status === 404) return { sha: null, data: null };
      if (r.status !== 200) throw new Error('GitHub ' + r.status);
      const j = await r.json();
      return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
    }
    // Взять прогресс из репо, если он свежее здешнего. Возвращает, что было и что стало.
    async function pullProgress() {
      if (!S.settings.repo || !S.settings.token) return { ok: false, text: 'GitHub не настроен' };
      try {
        const { data } = await getState();
        if (!data || !data.progAt || data.progAt <= (S.progAt || '')) return { ok: true, applied: false };
        const before = snapshot();
        for (const k of PROG) if (k in data.prog) S[k] = JSON.parse(JSON.stringify(data.prog[k]));
        S.progAt = data.progAt; save();
        return { ok: true, applied: true, before, after: snapshot(), from: data.copy, at: data.progAt };
      } catch (e) { return { ok: false, text: e.message }; }
    }
    // Отправить свой прогресс, если в репо не лежит более свежий (тот не затираем).
    async function pushProgress() {
      if (!S.settings.repo || !S.settings.token || !S.progAt) return { ok: false, text: 'нечего отправлять' };
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const { sha, data } = await getState();
          if (data && data.progAt >= S.progAt) return { ok: true, pushed: false, newer: data.progAt > S.progAt };
          const prog = {};
          for (const k of PROG) prog[k] = S[k];
          const body = { message: 'Прогресс', content: b64enc(JSON.stringify({ progAt: S.progAt, copy: S.copy, prog }, null, 1)) };
          if (sha) body.sha = sha;
          const p = await fetchFn(`${repoUrl()}/contents/state.json`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
          if (p.ok) return { ok: true, pushed: true };
          if (p.status !== 409 && p.status !== 422) throw new Error('GitHub ' + p.status);
        }
        throw new Error('GitHub: конфликт записи');
      } catch (e) { return { ok: false, text: e.message }; }
    }
    const pendingCount = () => S.records.filter(r => !r.synced).length;

    return {
      S, save, day, addRecord, addEvent, sync, checkRepo, pendingCount, cachedPhotos, refreshPhotos, b64enc, b64dec,
      isNewCopy, snapshot, touchProgress, pullProgress, pushProgress,
    };
  }

  const api = { create, KEY, PROG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    let ls;
    try { ls = root.localStorage; ls.getItem(KEY); } catch (e) {
      const m = {}; ls = { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
    }
    root.STORE = create(ls, root.fetch.bind(root));
    // Просим «постоянное» хранилище: иначе система может вычистить настройки и токен при нехватке места.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* нет API */ }
  }
})(this);
