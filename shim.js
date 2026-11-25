/* GitHub Pages build: stands in for claude.ai's db / user / downloads so the same app code runs here.
   Data lives in a Google Sheet behind an Apps Script web app (POI_SHEET_URL in config.js).
   - Writes made without signal are queued on the phone and sent when it comes back.
   - The last data from the Sheet is kept on the phone, so the page also opens offline.
   - Photos go straight to the owner's Google Drive through the same Apps Script. */
(function () {
  window.POI_GH = true;
  var URL_ = (window.POI_SHEET_URL || "").trim();
  var ready = /^https?:\/\//.test(URL_);
  var NAMES = ["followups", "pois", "poiedits", "selling", "lokasi", "sales"];
  var LOCKED = { pois: 1, poiedits: 1, selling: 1, sales: 1 };
  var QK = "poi-queue", CK = "poi-cache";
  function blank() { var o = {}; NAMES.forEach(function (c) { o[c] = {}; }); return o; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var cache = blank(), server = blank();
  var queue = lsGet(QK, []);
  var subs = {}, errs = {}, timer = 0, loaded = false, failing = false, flushing = false, started = false;
  window.POI_PENDING = queue.length;

  function tell(type, n) {
    window.POI_PENDING = queue.length;
    setTimeout(function () { try { window.dispatchEvent(new CustomEvent("poi-sync", { detail: { type: type, n: n || 0, pending: queue.length } })); } catch (e) {} }, 60);
  }
  function snap(c) {
    var o = cache[c] || {};
    return { docs: Object.keys(o).map(function (id) { return { id: id, data: function () { return o[id]; } }; }) };
  }
  function emit(c) { (subs[c] || []).forEach(function (cb) { try { cb(snap(c)); } catch (e) {} }); }
  function emitAll() { NAMES.forEach(emit); }

  // apply one write to a data set (used for the local view and for queued writes on top of fresh server data)
  function apply(set, b) {
    var c = b.col; set[c] = set[c] || {};
    if (b.op === "del") delete set[c][b.id];
    else if (b.op === "photo") { if (set.followups[b.id]) set.followups[b.id] = Object.assign({}, set.followups[b.id], { photoPending: true }); }
    else set[c][b.id] = b.data;
  }
  function view() {
    var v = JSON.parse(JSON.stringify(server));
    queue.forEach(function (b) { apply(v, b); });
    return v;
  }
  function refresh(force) {
    var next = view(), changed = NAMES.filter(function (c) { return JSON.stringify(next[c] || {}) !== JSON.stringify(cache[c] || {}); });
    cache = next;
    if (force) emitAll(); else changed.forEach(emit);
  }

  function send(b) {
    return fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(b) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          var e = new Error(j && j.error || "bad"); e.server = true;
          if (j && j.error === "key") { try { sessionStorage.removeItem("poi-key"); sessionStorage.removeItem("poi-tambah"); } catch (x) {} }
          throw e;
        }
        return j;
      });
  }
  function afterSent(b, j) {
    if (b.op === "photo") {
      if (j.url && server.followups[b.id]) server.followups[b.id] = Object.assign({}, server.followups[b.id], { photo: j.url });
    } else apply(server, b);
  }

  // send queued writes in order; stop at the first network failure
  function flush() {
    if (!ready || flushing || !queue.length) return Promise.resolve();
    flushing = true;
    var sent = 0, dropped = 0;
    function next() {
      if (!queue.length) return Promise.resolve();
      var b = queue[0];
      return send(b).then(function (j) { afterSent(b, j); queue.shift(); lsSet(QK, queue); sent++; return next(); })
        .catch(function (e) {
          if (e && e.server) { queue.shift(); lsSet(QK, queue); dropped++; return next(); }
        });
    }
    return next().then(function () {
      flushing = false; lsSet(CK, server); refresh();
      if (sent) tell("sent", sent);
      if (dropped) tell("dropped", dropped);
    });
  }

  function pull() {
    if (!ready) { NAMES.forEach(function (c) { (errs[c] || []).forEach(function (f) { f(new Error("no_url")); }); }); return Promise.resolve(); }
    return flush().then(function () {
      return fetch(URL_ + (URL_.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" });
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error("bad");
        server = Object.assign(blank(), j.data);
        lsSet(CK, server);
        failing = false;
        refresh(!loaded);
        loaded = true;
      })
      .catch(function (e) {
        failing = true;
        if (loaded) return;
        var saved = lsGet(CK, null);
        if (saved) { server = Object.assign(blank(), saved); refresh(true); loaded = true; tell("offline"); return; }
        NAMES.forEach(function (c) { (errs[c] || []).forEach(function (f) { f(e); }); });
      });
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { if (document.visibilityState === "visible") pull().then(schedule); else schedule(); }, failing ? 30000 : 20000);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && loaded) pull(); });
  window.addEventListener("online", function () { if (loaded) pull(); });

  function isNet(e) { return !(e && e.server); }
  function write(op, c, id, data, extra) {
    if (!ready) return Promise.reject(new Error("no_url"));
    var key = "";
    try { key = sessionStorage.getItem("poi-key") || ""; } catch (e) {}
    if (LOCKED[c] && !key) return Promise.reject(new Error("key"));
    var p = (typeof BYID !== "undefined" && BYID[id]) ? BYID[id].n : (data && data.n) || "";
    var b = Object.assign({ op: op, col: c, id: id, data: data, label: p, key: key }, extra || {});
    function later() {
      queue.push(b);
      if (!lsSet(QK, queue)) { queue.pop(); var e = new Error("full"); e.server = true; throw e; }
      refresh(); tell("queued", 1);
      return {};
    }
    if (queue.length) return Promise.resolve().then(later).then(function (r) { flush(); return r; });
    return send(b).then(function (j) { afterSent(b, j); lsSet(CK, server); refresh(); return j; })
      .catch(function (e) { if (isNet(e)) return later(); throw e; });
  }

  // photo for a follow-up: goes to the owner's Google Drive; the Sheet row gets its link
  window.POI_UPLOAD = function (o) {
    return write("photo", "followups", o.id, o.data, { label: o.name || "" }).then(function (j) { return j && j.url || null; });
  };

  var db = {
    collection: function (c) {
      return {
        onSnapshot: function (cb, err) {
          (subs[c] = subs[c] || []).push(cb);
          (errs[c] = errs[c] || []).push(err || function () {});
          if (!started) { started = true; setTimeout(function () { pull().then(schedule); }, 0); }
          return function () {};
        },
        doc: function (id) {
          return { set: function (d) { return write("put", c, id, d); }, delete: function () { return write("del", c, id); } };
        }
      };
    }
  };

  var downloads = {
    save: function (o) {
      var a = document.createElement("a"), u = URL.createObjectURL(o.data);
      a.href = u; a.download = o.filename || "file.xlsx"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500);
      return Promise.resolve();
    }
  };
  var user = { id: function () { return Promise.resolve(null); } };

  window.claude = {
    use: function (name) {
      if (name === "db") return Promise.resolve(ready ? db : null);
      if (name === "user") return Promise.resolve(user);
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.reject(new Error("unsupported"));
    }
  };

  // keep the app and map files on the phone so it opens fast and without signal
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
