import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:3000');
async function request(path, options) {
  return fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000), ...options });
}

const health = await request('/healthz');
assert.equal(health.status, 200, 'health endpoint');
assert.equal((await health.text()).trim(), 'ok');
assert.equal(health.headers.get('cache-control'), 'no-store');

const index = await request('/');
assert.equal(index.status, 200, 'app shell');
assert.match(index.headers.get('content-type') || '', /text\/html/);
assert.equal(index.headers.get('cache-control'), 'no-store');
assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
assert.equal(index.headers.get('x-frame-options'), 'DENY');
const html = await index.text();
assert.match(html, /id="root"/);
const assetPath = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(assetPath, 'built entry asset in HTML');

const deepLink = await request('/workshop/orders/container-smoke-test');
assert.equal(deepLink.status, 200, 'SPA direct link');
assert.equal(await deepLink.text(), html, 'direct link returns app shell');
assert.equal(deepLink.headers.get('cache-control'), 'no-store');

const asset = await request(assetPath);
assert.equal(asset.status, 200, 'built asset');
assert.match(asset.headers.get('content-type') || '', /javascript/);
assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
assert.equal(asset.headers.get('x-frame-options'), 'DENY');
await asset.arrayBuffer();

const worker = await request('/sw.js');
assert.equal(worker.status, 200, 'service worker');
assert.equal(worker.headers.get('cache-control'), 'no-store');
assert.match(await worker.text(), /addEventListener/);

for (const path of ['/assets/not-a-real-asset.js', '/missing.js', '/.env', '/.git/config']) {
  const response = await request(path);
  assert.equal(response.status, 404, `missing/private path: ${path}`);
  assert.equal(response.headers.get('cache-control'), 'no-store', `404 cache: ${path}`);
  await response.arrayBuffer();
}
const apiDenied=await request('/api/auth/session');
assert.equal(apiDenied.status,401,'unauthenticated API');
assert.equal(apiDenied.headers.get('cache-control'),'no-store');
await apiDenied.arrayBuffer();
console.log('Container smoke check passed: health, shell, deep links, assets, caching and private paths.');
