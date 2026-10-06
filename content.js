// Банк заданий: словарь с формами слов и генераторы для игр «Вспышка» и «Робот».
// Каждое задание несёт trap — слова, от которых зависит смысл (их подсвечиваем после ответа).
(function (root) {
  'use strict';

  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const rep = (e, n) => Array(n).fill(e);
  const pickDistinct = (a, n) => shuffle(a).slice(0, n);

  // ---------- Словарь ----------
  // g — род; f — формы для 1 / 2–4 / 5+ (5+ совпадает с родительным множественного); pl — именительный множественного.
  const N = {
    fruit: [
      { e: '🍎', g: 'n', f: ['яблоко', 'яблока', 'яблок'], pl: 'яблоки' },
      { e: '🍐', g: 'f', f: ['груша', 'груши', 'груш'], pl: 'груши' },
      { e: '🍌', g: 'm', f: ['банан', 'банана', 'бананов'], pl: 'бананы' },
      { e: '🍊', g: 'm', f: ['апельсин', 'апельсина', 'апельсинов'], pl: 'апельсины' },
      { e: '🍋', g: 'm', f: ['лимон', 'лимона', 'лимонов'], pl: 'лимоны' },
      { e: '🍓', g: 'f', f: ['клубничка', 'клубнички', 'клубничек'], pl: 'клубнички' },
      { e: '🥕', g: 'f', f: ['морковка', 'морковки', 'морковок'], pl: 'морковки' },
      { e: '🥒', g: 'm', f: ['огурец', 'огурца', 'огурцов'], pl: 'огурцы' },
    ],
    animal: [
      { e: '🐱', g: 'm', f: ['котёнок', 'котёнка', 'котят'], pl: 'котята' },
      { e: '🐶', g: 'm', f: ['щенок', 'щенка', 'щенков'], pl: 'щенки' },
      { e: '🐰', g: 'm', f: ['зайчик', 'зайчика', 'зайчиков'], pl: 'зайчики' },
      { e: '🦊', g: 'f', f: ['лиса', 'лисы', 'лис'], pl: 'лисы' },
      { e: '🐸', g: 'f', f: ['лягушка', 'лягушки', 'лягушек'], pl: 'лягушки' },
      { e: '🐢', g: 'f', f: ['черепаха', 'черепахи', 'черепах'], pl: 'черепахи' },
      { e: '🦔', g: 'm', f: ['ёжик', 'ёжика', 'ёжиков'], pl: 'ёжики' },
      { e: '🐿️', g: 'f', f: ['белка', 'белки', 'белок'], pl: 'белки' },
    ],
    toy: [
      { e: '🎈', g: 'm', f: ['шарик', 'шарика', 'шариков'], pl: 'шарики' },
      { e: '⚽', g: 'm', f: ['мяч', 'мяча', 'мячей'], pl: 'мячи' },
      { e: '🚗', g: 'f', f: ['машинка', 'машинки', 'машинок'], pl: 'машинки' },
      { e: '🧸', g: 'm', f: ['мишка', 'мишки', 'мишек'], pl: 'мишки' },
      { e: '🎁', g: 'm', f: ['подарок', 'подарка', 'подарков'], pl: 'подарки' },
      { e: '📘', g: 'f', f: ['книжка', 'книжки', 'книжек'], pl: 'книжки' },
    ],
  };
  const LOC = {
    fruit: ['На тарелке', 'В корзине', 'На столе'],
    animal: ['На полянке', 'Во дворе', 'У речки'],
    toy: ['На полке', 'В коробке', 'На ковре'],
  };
  const CATS = Object.keys(N);

  function numWord(n, g) {
    if (n === 1) return g === 'f' ? 'одна' : g === 'n' ? 'одно' : 'один';
    if (n === 2) return g === 'f' ? 'две' : 'два';
    return ['', '', '', 'три', 'четыре', 'пять', 'шесть'][n];
  }
  function form(noun, n) {
    const d = n % 10, h = n % 100;
    if (h >= 11 && h <= 14) return noun.f[2];
    if (d === 1) return noun.f[0];
    if (d >= 2 && d <= 4) return noun.f[1];
    return noun.f[2];
  }
  // На экране числа цифрами (cntD), для голоса — словами (cnt), чтобы синтезатор не ошибался в роде: «две груши».
  const cnt = (noun, n) => numWord(n, noun.g) + ' ' + form(noun, n);
  const cntD = (noun, n) => n + ' ' + form(noun, n);

  const COLORS = [
    { id: 'red', pl: 'красные', gpl: 'красных', gm: 'красного', circle: '🔴', square: '🟥', heart: '❤️' },
    { id: 'blue', pl: 'синие', gpl: 'синих', gm: 'синего', circle: '🔵', square: '🟦', heart: '💙' },
    { id: 'green', pl: 'зелёные', gpl: 'зелёных', gm: 'зелёного', circle: '🟢', square: '🟩', heart: '💚' },
    { id: 'yellow', pl: 'жёлтые', gpl: 'жёлтых', gm: 'жёлтого', circle: '🟡', square: '🟨', heart: '💛' },
  ];
  const SHAPES = [
    { id: 'circle', pl: 'круги', gpl: 'кругов', gs: 'круга' },
    { id: 'square', pl: 'квадраты', gpl: 'квадратов', gs: 'квадрата' },
    { id: 'heart', pl: 'сердечки', gpl: 'сердечек', gs: 'сердечка' },
  ];

  // ---------- «Вспышка»: фраза → выбрать подходящую картинку ----------
  // Сцена: { items: [эмодзи], ordered: важен ли порядок }. Неверные сцены отличаются одной деталью.
  const sc = (items, ordered) => ({ items, ordered: !!ordered });
  const sceneKey = s => (s.ordered ? s.items : s.items.slice().sort()).join('|');

  const FLASH = {
    // Сколько предметов одного вида.
    F1() {
      const cat = pick(CATS), a = pick(N[cat]), n = 2 + rnd(4), loc = pick(LOC[cat]);
      return {
        text: `${loc} ${cntD(a, n)}.`, say: `${loc} ${cnt(a, n)}.`, trap: [String(n)],
        ok: sc(rep(a.e, n)), bad: [sc(rep(a.e, n - 1)), sc(rep(a.e, n + 1))],
      };
    },
    // Два вида, у каждого своё число.
    F2() {
      const cat = pick(CATS), [A, B] = pickDistinct(N[cat], 2);
      const [x, y] = pickDistinct([1, 2, 3, 4], 2);
      const y2 = y < 4 ? y + 1 : y - 1;
      const s = (p, q) => sc(rep(A.e, p).concat(rep(B.e, q)));
      const loc = pick(LOC[cat]);
      return {
        text: `${loc} ${cntD(A, x)} и ${cntD(B, y)}.`, say: `${loc} ${cnt(A, x)} и ${cnt(B, y)}.`, trap: [String(x), String(y)],
        ok: s(x, y), bad: [s(y, x), s(x, y2)],
      };
    },
    // Отрицание: «нет», «только».
    F3() {
      const cat = pick(CATS), [A, B] = pickDistinct(N[cat], 2), k = 3 + rnd(2), loc = pick(LOC[cat]);
      const v = rnd(2);
      const text = v ? `${loc} нет ${A.f[2]}, только ${B.pl}.` : `${loc} ${B.pl}, а ${A.f[2]} нет.`;
      const mixed = rep(B.e, k - 1); mixed.splice(1, 0, A.e);
      return {
        text, trap: v ? ['нет', 'только'] : ['нет'],
        ok: sc(rep(B.e, k)), bad: [sc(rep(A.e, k)), sc(mixed)],
      };
    },
    // «Все…, кроме одного…».
    F4() {
      const S = pick(SHAPES), [C1, C2] = pickDistinct(COLORS, 2);
      return {
        text: `Все ${S.pl} ${C1.pl}, кроме 1 ${C2.gm}.`, say: `Все ${S.pl} ${C1.pl}, кроме одного ${C2.gm}.`, trap: ['кроме', '1'],
        ok: sc(shuffle(rep(C1[S.id], 3).concat(C2[S.id]))),
        bad: [sc(rep(C1[S.id], 4)), sc(shuffle(rep(C2[S.id], 3).concat(C1[S.id])))],
      };
    },
    // Слева / посередине / справа — по нарастающей: уровень 1 — два предмета, 2 — два или три,
    // 3 — три, иногда в фразе не в том порядке, что на картинке.
    F5(level) {
      const [A, B, C] = pickDistinct(CATS.flatMap(c => N[c]), 3);
      if (level === 1 || (level === 2 && rnd(2))) {
        return {
          text: rnd(2) ? `Слева ${A.f[0]}, справа ${B.f[0]}.` : `${cap(B.f[0])} справа, а ${A.f[0]} слева.`,
          trap: ['слева', 'справа'],
          ok: sc([A.e, B.e], true), bad: [sc([B.e, A.e], true), sc([A.e, C.e], true)],
        };
      }
      const text = level >= 3 && rnd(2)
        ? `${cap(B.f[0])} посередине, ${A.f[0]} слева, а ${C.f[0]} справа.`
        : `Слева ${A.f[0]}, посередине ${B.f[0]}, справа ${C.f[0]}.`;
      return {
        text, trap: ['слева', 'посередине', 'справа'],
        ok: sc([A.e, B.e, C.e], true), bad: [sc([C.e, B.e, A.e], true), sc([B.e, A.e, C.e], true)],
      };
    },
    // «больше» / «меньше».
    F6() {
      const cat = pick(CATS), [A, B] = pickDistinct(N[cat], 2);
      const [a, b] = pick([[3, 1], [4, 2], [3, 2], [4, 1]]), c = pick([2, 3]);
      const word = pick(['больше', 'меньше']);
      const s = (p, q) => sc(rep(A.e, p).concat(rep(B.e, q)));
      const ok = word === 'больше' ? s(a, b) : s(b, a), rev = word === 'больше' ? s(b, a) : s(a, b);
      return {
        text: `${pick(LOC[cat])} ${A.f[2]} ${word}, чем ${B.f[2]}.`, trap: [word],
        ok, bad: [rev, s(c, c)],
      };
    },
    // Число + отрицание в одной фразе.
    F7() {
      const cat = pick(CATS), [A, B] = pickDistinct(N[cat], 2), n = 2 + rnd(3), loc = pick(LOC[cat]);
      return {
        text: `${loc} ${cntD(A, n)}, а ${B.f[2]} нет.`, say: `${loc} ${cnt(A, n)}, а ${B.f[2]} нет.`, trap: [String(n), 'нет'],
        ok: sc(rep(A.e, n)), bad: [sc(rep(A.e, n).concat(B.e)), sc(rep(A.e, n + 1))],
      };
    },
  };
  const FLASH_BY_LEVEL = {
    // Позиции (F5) — самое слабое место по логам первой недели, поэтому они встречаются чаще.
    1: ['F1', 'F2', 'F5'],
    2: ['F2', 'F3', 'F4', 'F5', 'F5'],
    3: ['F3', 'F4', 'F5', 'F5', 'F6', 'F7'],
  };

  function flash(level) {
    const tpl = pick(FLASH_BY_LEVEL[level] || FLASH_BY_LEVEL[1]);
    const t = FLASH[tpl](level);
    return Object.assign({ tpl, level }, t, { options: shuffle([t.ok].concat(t.bad)) });
  }

  // ---------- «Робот»: команда → нажать на нужные предметы в поле ----------
  const ANIMALS = [
    { e: '🐱' }, { e: '🐶' }, { e: '🐰' }, { e: '🦊' }, { e: '🐻' }, { e: '🐭' },
    { e: '🐦', fly: 1 }, { e: '🦋', fly: 1 }, { e: '🐝', fly: 1 }, { e: '🦉', fly: 1 },
    { e: '🐟', water: 1 }, { e: '🐙', water: 1 }, { e: '🐬', water: 1 }, { e: '🐳', water: 1 },
  ];
  const FOOD = [
    { e: '🍎', fruit: 1, color: 'red' }, { e: '🍐', fruit: 1, color: 'green' },
    { e: '🍌', fruit: 1, color: 'yellow' }, { e: '🍋', fruit: 1, color: 'yellow' },
    { e: '🍊', fruit: 1, color: 'orange' },
    { e: '🥕', color: 'orange', gen: 'морковки' }, { e: '🥒', color: 'green', gen: 'огурцов' },
    { e: '🥔', color: 'brown', gen: 'картошки' },
    { e: '🥦', color: 'green', gen: 'брокколи' }, { e: '🍆', color: 'purple', gen: 'баклажанов' },
  ];
  // 🍅 убран: на iPad его не отличить от 🍎, а «овощ или фрукт» — спорный вопрос, а не смысл фразы.
  const FOOD_COLORS = { red: 'красные', yellow: 'жёлтые', green: 'зелёные', orange: 'оранжевые' };

  const shapeItem = () => { const s = pick(SHAPES), c = pick(COLORS); return { e: c[s.id], shape: s.id, color: c.id }; };
  const FIELDS = {
    shape: () => shapeItem(),
    animal: () => Object.assign({}, pick(ANIMALS)),
    food: () => Object.assign({}, pick(FOOD)),
  };

  // pred — что нажать; near — «почти подходящие» (должны быть в поле, чтобы ловушка работала); exact — ровно столько.
  const ROBOT = {
    R1() { const c = pick(COLORS); return { field: 'shape', text: `Нажми на все ${c.pl} фигуры.`, trap: [c.pl], pred: i => i.color === c.id }; },
    R2() { const s = pick(SHAPES); return { field: 'shape', text: `Нажми на все ${s.pl}.`, trap: [s.pl], pred: i => i.shape === s.id }; },
    R3() {
      const s = pick(SHAPES), c = pick(COLORS);
      return { field: 'shape', text: `Нажми на все ${s.pl}, кроме ${c.gpl}.`, trap: ['кроме'],
        pred: i => i.shape === s.id && i.color !== c.id, near: i => i.shape === s.id && i.color === c.id };
    },
    R4() {
      const c = pick(COLORS);
      return { field: 'shape', text: `Нажми на все фигуры, которые не ${c.pl}.`, trap: ['не'],
        pred: i => i.color !== c.id, near: i => i.color === c.id };
    },
    R5() {
      const s = pick(SHAPES), c = pick(COLORS);
      return { field: 'shape', text: `Нажми только на ${c.pl} ${s.pl}.`, trap: ['только'],
        pred: i => i.shape === s.id && i.color === c.id, near: i => (i.shape === s.id) !== (i.color === c.id) };
    },
    R6() {
      const s = pick(SHAPES), c = pick(COLORS), n = pick([2, 3]);
      return { field: 'shape', text: `Нажми на ${n} ${c.gpl} ${s.gs}.`, say: `Нажми на ${numWord(n, 'm')} ${c.gpl} ${s.gs}.`, trap: [String(n)],
        pred: i => i.shape === s.id && i.color === c.id, exact: n };
    },
    R7() {
      const s = pick(SHAPES), c = pick(COLORS);
      return { field: 'shape', text: `Не нажимай на ${s.pl}. Нажми на все ${c.pl} фигуры.`, trap: ['не'],
        pred: i => i.color === c.id && i.shape !== s.id, near: i => i.color === c.id && i.shape === s.id };
    },
    A1() { return { field: 'animal', text: 'Нажми на всех, кто умеет летать.', trap: ['летать'], pred: i => !!i.fly }; },
    A2() { return { field: 'animal', text: 'Нажми на всех, кто живёт в воде.', trap: ['воде'], pred: i => !!i.water }; },
    A3() {
      return { field: 'animal', text: 'Нажми на всех, кроме тех, кто умеет летать.', trap: ['кроме'],
        pred: i => !i.fly, near: i => !!i.fly };
    },
    A4() {
      return { field: 'animal', text: 'Нажми на всех, кто не живёт в воде.', trap: ['не'],
        pred: i => !i.water, near: i => !!i.water };
    },
    A5() {
      return { field: 'animal', text: 'Нажми на всех, кто не умеет летать и не живёт в воде.', trap: ['не'],
        pred: i => !i.fly && !i.water, near: i => !!i.fly || !!i.water };
    },
    A6() { return { field: 'animal', text: 'Нажми только на 1 животное, которое живёт в воде.', say: 'Нажми только на одно животное, которое живёт в воде.', trap: ['1'], pred: i => !!i.water, exact: 1 }; },
    P1() { return { field: 'food', text: 'Нажми на все фрукты.', trap: ['фрукты'], pred: i => !!i.fruit }; },
    P2() { return { field: 'food', text: 'Нажми на все овощи.', trap: ['овощи'], pred: i => !i.fruit }; },
    P3() {
      const x = pick(FOOD.filter(f => !f.fruit));
      return { field: 'food', text: `Нажми на все овощи, кроме ${x.gen}.`, trap: ['кроме'],
        pred: i => !i.fruit && i.e !== x.e, near: i => i.e === x.e };
    },
    P4() {
      const c = pick(Object.keys(FOOD_COLORS));
      return { field: 'food', text: `Нажми на все фрукты, которые не ${FOOD_COLORS[c]}.`, trap: ['не'],
        pred: i => !!i.fruit && i.color !== c, near: i => !!i.fruit && i.color === c };
    },
    P5() {
      const c = pick(['green', 'orange']);
      return { field: 'food', text: `Нажми только на ${FOOD_COLORS[c]} овощи.`, trap: ['только'],
        pred: i => !i.fruit && i.color === c, near: i => i.color === c && !!i.fruit };
    },
    P6() {
      return { field: 'food', text: 'Нажми на 2 фрукта, которые не жёлтые.', say: 'Нажми на два фрукта, которые не жёлтые.', trap: ['2', 'не'],
        pred: i => !!i.fruit && i.color !== 'yellow', exact: 2 };
    },
  };
  const ROBOT_BY_LEVEL = {
    1: ['R1', 'R2', 'A1', 'A2', 'P1', 'P2'],
    2: ['R3', 'R4', 'R5', 'A3', 'A4', 'P3', 'P4'],
    3: ['R3', 'R6', 'R7', 'A5', 'A6', 'P4', 'P5', 'P6'],
  };
  const FIELD_SIZE = { 1: 8, 2: 10, 3: 12 };

  function drawWhere(gen, f) {
    for (let k = 0; k < 1000; k++) { const x = gen(); if (f(x)) return x; }
    return null;
  }

  // Поле собирается по частям: подходящие + 1–2 «почти подходящих» (ловушки) + остальные.
  function makeField(t, size) {
    const gen = FIELDS[t.field], need = t.exact ? t.exact + 1 : 2;
    const maxM = Math.min(size - 3, need + Math.floor(size / 3));
    const m = need + rnd(maxM - need + 1);
    const items = [];
    for (let i = 0; i < m; i++) { const x = drawWhere(gen, t.pred); if (!x) return null; items.push(x); }
    const nn = t.near ? 1 + rnd(2) : 0;
    for (let i = 0; i < nn; i++) { const x = drawWhere(gen, it => t.near(it) && !t.pred(it)); if (!x) return null; items.push(x); }
    while (items.length < size) { const x = drawWhere(gen, it => !t.pred(it)); if (!x) return null; items.push(x); }
    return shuffle(items);
  }

  function robot(level) {
    const tpl = pick(ROBOT_BY_LEVEL[level] || ROBOT_BY_LEVEL[1]);
    const t = ROBOT[tpl]();
    const items = makeField(t, FIELD_SIZE[level] || 8);
    if (!items) throw new Error('Не удалось собрать поле для «Робота»: ' + tpl);
    return Object.assign({ tpl, level, items }, t);
  }

  // Проверка выбора в «Роботе»: sel — Set индексов.
  function robotCheck(task, sel) {
    const ok = task.items.map(task.pred);
    if (task.exact) return sel.size === task.exact && [...sel].every(i => ok[i]);
    return ok.every((v, i) => v === sel.has(i));
  }

  const api = { flash, robot, robotCheck, sceneKey, FLASH, ROBOT, FLASH_BY_LEVEL, ROBOT_BY_LEVEL, FIELD_SIZE, makeField };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CONTENT = api;
})(this);
