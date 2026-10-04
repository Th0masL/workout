import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { check, report, section } from './harness.mjs';

section('Server-error cache fallback');
for (const status of [500, 503]) {
  for (const cached of [true, false]) {
    const handlers = {};
    const scope = {
      self: { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin: 'https://workout.test' } },
      URL, Request, Response,
      fetch: async () => new Response('server error', { status }),
      caches: { match: async () => cached ? new Response('saved app') : undefined },
      setTimeout: () => 0,
    };
    vm.createContext(scope);
    vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), scope);
    let response;
    handlers.fetch({ request: new Request('https://workout.test/app.js'), respondWith: p => { response = p; } });
    const result = await response;
    check(`${status}, cached=${cached}: response status`, result.status, cached ? 200 : status);
    check(`${status}, cached=${cached}: response body`, await result.text(), cached ? 'saved app' : 'server error');
  }
}
report();
