const vm = require('vm'), fs = require('fs');
const calls = [];
const win = { };
const ctx = vm.createContext({ window: win, Proxy, Promise, JSON, console, Array, Object, String, Math, encodeURIComponent,
  document: { createElement() { return {}; } }, Image: function () {},
  fetch: (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) });
    if (url.endsWith('/boom')) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('{"msg":"db down"}') });
    if (url.endsWith('/big')) return Promise.resolve({ ok: false, status: 413, text: () => Promise.resolve('Request Entity Too Large') });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'ok', data: [1, 2] })) }); } });
ctx.window = ctx; vm.runInContext(fs.readFileSync(__dirname + '/../static/shim.js', 'utf8'), ctx);
const g = ctx.google;
const done = [];
// same pattern as the page's call(): runner[fn](args...) after both handlers
const runner = g.script.run.withSuccessHandler(r => done.push(['ok', r])).withFailureHandler(e => done.push(['fail', e.message]));
runner['getFlats']();
runner['saveInspection']({ flatId: 'a' });
g.script.run.withSuccessHandler(r => done.push(['ok2', r])).login('u', 'p');           // no failure handler
g.script.run.withFailureHandler(e => done.push(['fail2', e.message])).boom();
g.script.run.withFailureHandler(e => done.push(['fail3', e.message])).big();
setTimeout(() => { console.log(JSON.stringify(calls.map(c => [c.url, c.body.args]))); console.log(JSON.stringify(done)); }, 50);
