/* BandGest — service worker (funcionamento sem internet).
 * - Ficheiros da app (/assets/*): cache primeiro (têm hash no nome, nunca mudam).
 * - Navegação (index.html): rede primeiro (4 s), com a cópia guardada como reserva sem ligação.
 *   Assim uma versão nova da app é sempre apanhada quando há rede.
 * - Ícones e imagens da app: guarda e actualiza em segundo plano.
 * - Fontes e bibliotecas de CDN: guarda e actualiza em segundo plano.
 * - Firebase, autenticação e qualquer pedido que não seja GET: nunca passam por aqui
 *   (os dados ficam no IndexedDB pela própria app e sincronizam quando a rede volta).
 * Para forçar a renovação de tudo, mude VERSION.
 */
const VERSION = 'v3';
const SHELL_CACHE = `bandgest-shell-${VERSION}`;
const ASSET_CACHE = `bandgest-assets-${VERSION}`;
const CDN_CACHE = `bandgest-cdn-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE, CDN_CACHE];

const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/theme-init.js', '/favicon-32.png', '/icon-192.png', '/school_emblem.png'];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
// Nunca em cache: API/Auth/Realtime/Storage do Supabase e a consulta de IP.
const NEVER = ['supabase.co', 'supabase.in'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bandgest-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    if (fresh && fresh.ok) cache.put('/index.html', fresh.clone());
    return fresh;
  } catch (e) {
    const cached = (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(request, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      // Imagem de fundo opcional (page-bg-*): se não existir o servidor devolve HTML; isso nunca vai para a cache.
      const notImage = /\/page-bg-/.test(new URL(request.url).pathname) && !/^image\//i.test(res.headers.get('content-type') || '');
      if (res && (res.ok || res.type === 'opaque') && !notImage) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  const c = cached && /\/page-bg-/.test(new URL(request.url).pathname) && !/^image\//i.test(cached.headers.get('content-type') || '') ? null : cached;
  return c || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (NEVER.some((h) => (h.includes('/') ? request.url.includes(h) : url.hostname === h || url.hostname.endsWith('.' + h)))) return;

  // Páginas estáticas (termos/privacidade): vão sempre à rede; nunca substituem a cópia da app em cache.
  if (url.origin === self.location.origin && /^\/termos-e-privacidade\.html$/.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, 4000));
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
    } else if (SHELL.includes(url.pathname) || /\.(png|ico|svg|webmanifest|jpg|jpeg|webp|woff2?)$/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    }
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
  }
});


/* Notificações push (passo 5). Mostra a notificação recebida e, ao clicar, foca ou abre a app.
 * O payload esperado é JSON: { title, body, url, tag }. Só caminhos internos são abertos. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'BandGest', body: event.data ? event.data.text() : '' }; }
  const title = String(data.title || 'BandGest').slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || '').slice(0, 200),
    tag: data.tag || undefined,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // Já há uma janela aberta: leva-a ao endereço do aviso (só caminhos internos) e traz-a para a frente.
          const go = target !== '/' && 'navigate' in c ? c.navigate(target).catch(() => c) : Promise.resolve(c);
          return go.then((w) => (w || c).focus());
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
