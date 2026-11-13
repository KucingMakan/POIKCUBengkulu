/* GitHub Pages build: stands in for claude.ai's db / user / downloads so the same app code runs here.
   Data lives in a Google Sheet behind an Apps Script web app (POI_SHEET_URL in config.js). */
(function () {
  window.POI_GH = true;
  var URL_ = (window.POI_SHEET_URL || "").trim();
  var ready = /^https?:\/\//.test(URL_);
  var cache = { followups: {}, pois: {}, poiedits: {}, selling: {} };
  var subs = {}, errs = {}, timer = 0, loaded = false, failing = false;
  var LOCKED = { pois: 1, poiedits: 1, selling: 1 };

  function snap(c) {
    var o = cache[c] || {};
    return { docs: Object.keys(o).map(function (id) { return { id: id, data: function () { return o[id]; } }; }) };
  }
  function emit(c) { (subs[c] || []).forEach(function (cb) { try { cb(snap(c)); } catch (e) {} }); }
  function emitAll() { Object.keys(cache).forEach(emit); }

  function pull() {
    if (!ready) { Object.keys(errs).forEach(function (c) { errs[c].forEach(function (f) { f(new Error("no_url")); }); }); return Promise.resolve(); }
    return fetch(URL_ + (URL_.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error("bad");
        var changed = JSON.stringify(j.data) !== JSON.stringify(cache);
        cache = Object.assign({ followups: {}, pois: {}, poiedits: {}, selling: {} }, j.data);
        failing = false;
        if (changed || !loaded) emitAll();
        loaded = true;
      })
      .catch(function (e) {
        if (!loaded) { Object.keys(errs).forEach(function (c) { errs[c].forEach(function (f) { f(e); }); }); }
        failing = true;
      });
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { if (document.visibilityState === "visible") pull().then(schedule); else schedule(); }, failing ? 60000 : 20000);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && loaded) pull(); });

  function write(op, c, id, data) {
    if (!ready) return Promise.reject(new Error("no_url"));
    var key = "";
    try { key = sessionStorage.getItem("poi-key") || ""; } catch (e) {}
    if (LOCKED[c] && !key) return Promise.reject(new Error("key"));
    var p = (typeof BYID !== "undefined" && BYID[id]) ? BYID[id].n : (data && data.n) || "";
    return fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ op: op, col: c, id: id, data: data, label: p, key: key }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          if (j && j.error === "key") { try { sessionStorage.removeItem("poi-key"); sessionStorage.removeItem("poi-tambah"); } catch (e) {} }
          throw new Error(j && j.error || "bad");
        }
        if (op === "del") delete cache[c][id]; else cache[c][id] = data;
        emit(c);
      });
  }

  var db = {
    collection: function (c) {
      return {
        onSnapshot: function (cb, err) {
          (subs[c] = subs[c] || []).push(cb);
          (errs[c] = errs[c] || []).push(err || function () {});
          if (c === "selling") { pull().then(schedule); } // last collection subscribed: start loading
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

  window.claude = {
    use: function (n) {
      if (n === "db") return Promise.resolve(db);
      if (n === "user") return Promise.resolve({ id: function () { return Promise.resolve(null); } });
      if (n === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };
})();
