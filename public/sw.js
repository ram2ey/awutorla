// Application shell only. Staff records and mutations never enter this cache.
const CACHE_NAME='atelier-staff-workshop-v5';
const SHELL=['/','/index.html','/favicon.svg','/manifest.json','/logo.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>Promise.allSettled(SHELL.map(path=>cache.add(path)))));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('atelier-') && key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin)return;
  const navigation=event.request.mode==='navigate';
  // Guest checkout and private order-status pages must always use the network.
  if(navigation && !/^\/(staff|workshop)(\/|$)/.test(url.pathname))return;
  if(!navigation && !url.pathname.startsWith('/assets/') && !SHELL.includes(url.pathname))return;
  async function network(){
    const response=await fetch(event.request);
    if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(event.request,response.clone());}
    return response;
  }
  event.respondWith((async()=>{
    // A new deployment must replace the HTML shell; hashed assets are immutable.
    if(!navigation && url.pathname.startsWith('/assets/')){const cached=await caches.match(event.request);if(cached)return cached;}
    try{return await network();}catch{
      return (await caches.match(event.request)) || (navigation && await caches.match('/index.html')) || Response.error();
    }
  })());
});
