const CACHE_NAME = 'english-everyday-v1';
// Ganti 'index.html' jika nama file utama Anda berbeda
const urlsToCache = [
  '.', // Ini akan meng-cache file root (index.html)
  'manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  '/image/192.png', // <-- TAMBAHKAN INI
  '/image/512.png'  // <-- TAMBAHKAN INI
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika ada di cache, kembalikan dari cache
        if (response) {
          return response;
        }
        // Jika tidak, ambil dari jaringan
        return fetch(event.request);
      }
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close(); // Menutup notifikasi setelah diklik

  // Fokus ke window aplikasi yang sudah terbuka, atau buka baru jika belum ada
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

self.addEventListener('message', event => {
    if (event.data && event.data.command === 'showTestNotification') {
        self.registration.showNotification('English Everyday', {
            body: 'Ini adalah notifikasi tes. Semangat belajar!',
            icon: '/image/192.png',
            badge: '/image/192.png',
            vibrate: [200, 100, 200],
        });
    }
});