/* google.script.run -> fetch('/api/<fn>')  (so the original page works unchanged)
 *
 * Supports:  google.script.run.withSuccessHandler(f).withFailureHandler(g).someFunction(a, b, ...)
 * Vercel accepts request bodies up to 4.5 MB, so big photos are re-compressed in the browser first.
 */
(function () {
  var MAX_B64 = 3200000; // characters of base64 we allow in one upload (~2.4 MB of image)

  function compressImage(b64, mime) {
    // resolves {b64, mime}; never rejects (falls back to the original)
    return new Promise(function (resolve) {
      if (!/^image\//.test(mime || '') || b64.length <= MAX_B64) { resolve({ b64: b64, mime: mime }); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 2400 / Math.max(img.width, img.height));
          var q = 0.85, out = b64;
          for (var i = 0; i < 8; i++) {
            var c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            out = c.toDataURL('image/jpeg', q).split(',')[1];
            if (out.length <= MAX_B64) break;
            q = Math.max(0.5, q - 0.1);
            scale *= 0.8;
          }
          resolve({ b64: out, mime: 'image/jpeg' });
        } catch (e) { resolve({ b64: b64, mime: mime }); }
      };
      img.onerror = function () { resolve({ b64: b64, mime: mime }); };
      img.src = 'data:' + mime + ';base64,' + b64;
    });
  }

  function post(name, args) {
    return fetch('/api/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: args })
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = JSON.parse(t); } catch (e) { /* not json */ }
        if (!res.ok) {
          var msg = (data && (data.msg || data.detail)) || ('HTTP ' + res.status + (res.status === 413 ? ' (file too large)' : ''));
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return data;
      });
    });
  }

  function run(name, args, ok, fail) {
    var prep = Promise.resolve(args);
    if (name === 'uploadPhoto' && args.length >= 5 && typeof args[3] === 'string') {
      prep = compressImage(args[3], args[4]).then(function (r) {
        var a = args.slice();
        a[3] = r.b64; a[4] = r.mime;
        if (r.mime === 'image/jpeg' && typeof a[5] === 'string' && !/\.jpe?g$/i.test(a[5])) {
          a[5] = a[5].replace(/\.[^.]+$/, '') + '.jpg';
        }
        return a;
      });
    }
    prep.then(function (a) { return post(name, a); })
      .then(function (r) { if (ok) ok(r); })
      .catch(function (e) {
        if (fail) fail({ message: (e && e.message) || String(e) });
        else console.error(name, e);
      });
  }

  function makeRunner(ok, fail) {
    var base = {
      withSuccessHandler: function (f) { return makeRunner(f, fail); },
      withFailureHandler: function (f) { return makeRunner(ok, f); },
      withUserObject: function () { return makeRunner(ok, fail); }
    };
    return new Proxy(base, {
      get: function (t, name) {
        if (name in t) return t[name];
        if (typeof name !== 'string') return undefined;
        return function () { run(name, Array.prototype.slice.call(arguments), ok, fail); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = { run: makeRunner(null, null), host: { close: function () {}, setHeight: function () {}, setWidth: function () {} } };
})();
