// Офлайн-кэш: сначала сеть (в обход HTTP-кэша, чтобы новая версия была видна сразу),
// без сети — сохранённая копия. Кэш фото (smysl-photos) не трогаем.
const CACHE = 'smysl-shell-v3';
const SHELL = ['./', './index.html', './app.js', './content.js', './store.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  // Картинки заданий (img/) — чтобы игры работали без сети.
  './img/automobile.png', './img/balloon.png', './img/banana.png', './img/bear.png', './img/bird.png',
  './img/blue_book.png', './img/blue_circle.png', './img/blue_heart.png', './img/blue_square.png', './img/broccoli.png',
  './img/butterfly.png', './img/carrot.png', './img/cat.png', './img/chipmunk.png', './img/cucumber.png',
  './img/dog.png', './img/dolphin.png', './img/eggplant.png', './img/fish.png', './img/fox.png',
  './img/frog.png', './img/green_circle.png', './img/green_heart.png', './img/green_square.png', './img/hedgehog.png',
  './img/honeybee.png', './img/lemon.png', './img/mouse.png', './img/octopus.png', './img/owl.png',
  './img/pear.png', './img/potato.png', './img/rabbit.png', './img/red_apple.png', './img/red_circle.png',
  './img/red_heart.png', './img/red_square.png', './img/soccer_ball.png', './img/strawberry.png', './img/tangerine.png',
  './img/teddy_bear.png', './img/turtle.png', './img/whale.png', './img/wrapped_gift.png', './img/yellow_circle.png',
  './img/yellow_heart.png', './img/yellow_square.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('smysl-shell') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub API — мимо кэша
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      return (await c.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
