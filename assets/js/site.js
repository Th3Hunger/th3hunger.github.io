/* 0xth3hunger — site behaviour. Vanilla JS, no dependencies.
   Pages are plain static HTML; this only adds the editor-style niceties. */
(function () {
  "use strict";
  var d = document, root = d.documentElement, body = d.body;
  var $ = function (id) { return d.getElementById(id); };
  var main = $("mainpane");
  var me = $("sitejs");

  function storage(kind) { try { var s = window[kind]; s.getItem("x"); return s; } catch (e) { return null; } }
  var ls = storage("localStorage"), ss = storage("sessionStorage");
  function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function put(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
  function readJSON(s, k, fallback) { try { var v = JSON.parse(get(s, k)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function isPhone() { return window.matchMedia("(max-width: 760px)").matches; }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var t = d.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      body.appendChild(t); t.select();
      try { d.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      body.removeChild(t);
    });
  }
  function flash(el, text, cls, back) {
    el.textContent = text; el.classList.add(cls);
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.textContent = back; el.classList.remove(cls); }, 1400);
  }

  /* ---------- theme ---------- */
  var themeBtns = d.querySelectorAll("[data-set-theme]");
  function syncTheme() {
    var t = root.dataset.theme === "light" ? "light" : "dark";
    themeBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.setTheme === t)); });
  }
  themeBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.dataset.setTheme;
      if (t === "light") root.dataset.theme = "light"; else delete root.dataset.theme;
      put(ls, "theme", t);
      syncTheme();
      d.dispatchEvent(new CustomEvent("themechange"));
    });
  });
  syncTheme();

  /* ---------- explorer ---------- */
  var sb = $("sb"), files = $("files");
  function filesOpen() { return !body.classList.contains("nofiles"); }
  function setFiles(on) {
    body.classList.toggle("nofiles", !on);
    if (sb) sb.setAttribute("aria-pressed", String(on));
    if (!isPhone()) put(ls, "files", on ? "1" : "0");
  }
  if (sb) {
    sb.setAttribute("aria-pressed", String(filesOpen()));
    sb.addEventListener("click", function () { setFiles(!filesOpen()); });
  }
  d.querySelectorAll("#files .dir").forEach(function (b) {
    b.addEventListener("click", function () {
      var shut = b.classList.toggle("shut");
      b.setAttribute("aria-expanded", String(!shut));
      var s = readJSON(ls, "dirs", {});
      if (typeof s !== "object" || Array.isArray(s)) s = {};
      if (shut) s[b.dataset.dir] = 1; else delete s[b.dataset.dir];
      put(ls, "dirs", JSON.stringify(s));
    });
  });
  // on phones the explorer is an overlay: tapping outside closes it
  if (main) main.addEventListener("click", function () { if (isPhone() && filesOpen()) setFiles(false); });

  /* ---------- tabs (recently opened pages, per browser tab) ---------- */
  var tabsEl = $("tabs");
  if (tabsEl) {
    var MAX_TABS = 6;
    var cur = { f: tabsEl.dataset.file, u: tabsEl.dataset.url };
    var list = readJSON(ss, "tabs", []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (t) { return t && typeof t.u === "string" && typeof t.f === "string" && t.u.charAt(0) === "/"; });
    var idx = function (u) { for (var i = 0; i < list.length; i++) if (list[i].u === u) return i; return -1; };
    if (idx(cur.u) < 0) list.push(cur); else list[idx(cur.u)].f = cur.f;
    while (list.length > MAX_TABS) list.splice(idx(cur.u) === 0 ? 1 : 0, 1);
    if (!tabsEl.dataset.transient) put(ss, "tabs", JSON.stringify(list));
    var renderTabs = function () {
      var many = list.length > 1;
      tabsEl.innerHTML = list.map(function (t) {
        var on = t.u === cur.u;
        return '<span class="tab' + (on ? " on" : "") + '"><a href="' + esc(t.u) + '"' + (on ? ' aria-current="page"' : "") + ">" + esc(t.f) + "</a>" +
          (many ? '<button type="button" data-close="' + esc(t.u) + '" aria-label="close ' + esc(t.f) + '">×</button>' : '<span style="width:8px"></span>') + "</span>";
      }).join("");
      var on = tabsEl.querySelector(".tab.on");
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    renderTabs();
    tabsEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-close]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var i = idx(b.dataset.close);
      if (i < 0) return;
      list.splice(i, 1);
      put(ss, "tabs", JSON.stringify(list));
      if (b.dataset.close === cur.u) { var prev = list[Math.max(0, i - 1)]; location.href = prev ? prev.u : "/"; }
      else renderTabs();
    });
  }

  /* ---------- quick open (Ctrl/⌘+P) ---------- */
  var qo = $("qo"), qi = $("qi"), ql = $("ql");
  var items = null, loading = null, qsel = 0, qres = [], lastFocus = null;
  function loadIndex() {
    if (items) return Promise.resolve(items);
    if (!loading) loading = fetch(qo.dataset.index, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) { items = Array.isArray(j) ? j : []; return items; })
      .catch(function () { items = []; return items; });
    return loading;
  }
  function score(it, words) {
    var total = 0;
    var t = (it.t || "").toLowerCase(), s = (it.s || "").toLowerCase(), f = (it.f || "").toLowerCase(),
        dd = (it.d || "").toLowerCase(), x = (it.x || "").toLowerCase();
    var textOnly = true;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], best = 0;
      if (t.indexOf(w) === 0) best = 100;
      else if (t.indexOf(" " + w) > -1 || t.indexOf("#" + w) > -1) best = 90;
      else if (t.indexOf(w) > -1) best = 80;
      else if (f.indexOf(w) > -1) best = 70;
      else if (s.indexOf(w) > -1) best = 60;
      else if (dd.indexOf(w) > -1) best = 40;
      else if (x.indexOf(w) > -1) best = 15;
      if (!best) return 0;
      if (best > 15) textOnly = false;
      total += best;
    }
    it._inText = textOnly;
    return total;
  }
  function qrender() {
    if (!ql) return;
    var q = qi.value.toLowerCase().trim().replace(/^#/, "");
    var words = q.split(/\s+/).filter(Boolean);
    var all = items || [];
    if (!words.length) qres = all.filter(function (x) { return !x.tag; });
    else {
      qres = all.map(function (x, i) { return { x: x, s: score(x, words), i: i }; })
        .filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.i - b.i; })
        .slice(0, 50).map(function (r) { return r.x; });
    }
    if (qsel >= qres.length) qsel = 0;
    if (!items) { ql.innerHTML = '<div class="qempty">loading…</div>'; return; }
    ql.innerHTML = qres.length ? qres.map(function (x, i) {
      var sub = x.s + (words.length && x._inText ? " · in text" : "");
      return '<div class="qi' + (i === qsel ? " on" : "") + '" role="option" id="qopt' + i + '" aria-selected="' + (i === qsel) + '" data-u="' + esc(x.u) + '"><i>' + esc(x.i) + "</i><b>" + esc(x.t) + "</b><span>" + esc(sub) + "</span></div>";
    }).join("") : '<div class="qempty">no matches — ↵ goes to 404</div>';
    qi.setAttribute("aria-activedescendant", qres.length ? "qopt" + qsel : "");
    var on = ql.querySelector(".qi.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function openQ() {
    if (!qo) return;
    lastFocus = d.activeElement;
    qo.hidden = false; qi.value = ""; qsel = 0;
    qrender(); qi.focus();
    loadIndex().then(qrender);
  }
  function closeQ() {
    if (!qo || qo.hidden) return;
    qo.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function goSel() {
    var it = qres[qsel];
    closeQ();
    location.href = it ? it.u : qo.dataset.notfound;
  }
  if (qo) {
    $("qbtn").addEventListener("click", openQ);
    qi.addEventListener("input", function () { qsel = 0; qrender(); });
    qo.addEventListener("mousedown", function (e) { if (e.target === qo) closeQ(); });
    ql.addEventListener("click", function (e) {
      var r = e.target.closest(".qi");
      if (!r) return;
      qsel = Array.prototype.indexOf.call(ql.children, r);
      goSel();
    });
    ql.addEventListener("mousemove", function (e) {
      var r = e.target.closest(".qi");
      if (!r) return;
      var i = Array.prototype.indexOf.call(ql.children, r);
      if (i !== qsel) { qsel = i; ql.querySelectorAll(".qi").forEach(function (n, j) { n.classList.toggle("on", j === i); n.setAttribute("aria-selected", String(j === i)); }); }
    });
    var nfq = $("nfq");
    if (nfq) nfq.addEventListener("click", function (e) { e.preventDefault(); openQ(); });
  }

  /* ---------- keyboard ---------- */
  var lb = $("lb"), lbi = $("lbi");
  function closeLb() { if (lb && !lb.hidden) { lb.hidden = true; lbi.removeAttribute("src"); } }
  d.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase(), mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (mod && k === "p") { e.preventDefault(); if (qo && qo.hidden) openQ(); else if (qi) qi.focus(); return; }
    if (mod && k === "b") { e.preventDefault(); setFiles(!filesOpen()); return; }
    if (k === "escape" && lb && !lb.hidden) { closeLb(); return; }
    if (!qo || qo.hidden) return;
    if (k === "escape") { e.preventDefault(); closeQ(); }
    else if (k === "arrowdown") { e.preventDefault(); if (qres.length) { qsel = Math.min(qres.length - 1, qsel + 1); qrender(); } }
    else if (k === "arrowup") { e.preventDefault(); if (qres.length) { qsel = Math.max(0, qsel - 1); qrender(); } }
    else if (k === "enter") { e.preventDefault(); if (items) goSel(); }
    else if (k === "tab") { e.preventDefault(); qi.focus(); }
  });

  /* ---------- home / blog filters (?category=…&tag=…) ---------- */
  var flt = $("flt");
  if (flt) {
    var cards = Array.prototype.slice.call(d.querySelectorAll("#posts .card"));
    var noposts = $("noposts");
    var params = new URLSearchParams(location.search);
    var hasTag = function (t) { return cards.some(function (c) { return c.dataset.t.indexOf("|" + t + "|") > -1; }); };
    var fk = params.get("category") || "all", ft = params.get("tag");
    if (fk !== "all" && !flt.querySelector('[data-k="' + CSS.escape(fk) + '"]')) fk = "all";
    if (ft && !hasTag(ft)) ft = null;
    // a tag filter (from a post's #tag link or search) shows as one removable pill
    var tagSep = null, tagBtn = null;
    var syncTag = function () {
      if (ft && !tagBtn) {
        tagSep = d.createElement("span"); tagSep.className = "sep"; tagSep.setAttribute("aria-hidden", "true");
        tagBtn = d.createElement("button"); tagBtn.type = "button"; tagBtn.className = "on"; tagBtn.dataset.clearTag = "1";
        flt.appendChild(tagSep); flt.appendChild(tagBtn);
      }
      if (ft) { tagBtn.textContent = "#" + ft + " ×"; tagBtn.setAttribute("aria-label", "remove tag filter " + ft); }
      else if (tagBtn) { tagBtn.remove(); tagSep.remove(); tagBtn = tagSep = null; }
    };
    var apply = function () {
      var shown = 0;
      cards.forEach(function (c) {
        var ok = (fk === "all" || c.dataset.k === fk) && (!ft || c.dataset.t.indexOf("|" + ft + "|") > -1);
        c.hidden = !ok; if (ok) shown++;
      });
      flt.querySelectorAll("button[data-k]").forEach(function (b) {
        var on = b.dataset.k === fk;
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
      });
      syncTag();
      if (noposts) {
        noposts.hidden = shown > 0;
        noposts.textContent = ft ? "no posts match — clear a filter" : "no " + fk + " posts yet";
      }
      var p = new URLSearchParams(location.search);
      if (fk !== "all") p.set("category", fk); else p.delete("category");
      if (ft) p.set("tag", ft); else p.delete("tag");
      var qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    };
    flt.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.k) fk = b.dataset.k;
      else if (b.dataset.clearTag) ft = null;
      apply();
    });
    apply();
    if ((params.get("tag") || params.get("category")) && main) main.scrollTop = Math.max(0, flt.offsetTop - 60);
  }

  /* ---------- post body: code tools, heading links ---------- */
  d.querySelectorAll(".view .code").forEach(function (c) {
    var tools = d.createElement("div");
    tools.className = "ctools";
    var label = c.dataset.title || c.dataset.lang;
    if (label) { var l = d.createElement("span"); l.className = "lang"; l.textContent = label; tools.appendChild(l); }
    var b = d.createElement("button");
    b.type = "button"; b.className = "copy"; b.textContent = "copy";
    b.setAttribute("aria-label", "copy code");
    tools.appendChild(b);
    c.appendChild(tools);
    b.addEventListener("click", function () {
      var code = c.querySelector("code") || c.querySelector("pre");
      if (!code) return;
      var clone = code.cloneNode(true);
      clone.querySelectorAll(".ln").forEach(function (n) { n.remove(); });
      copyText(clone.textContent.replace(/\n$/, "")).then(function () { flash(b, "copied", "done", "copy"); }, function () { flash(b, "press ⌘C", "done", "copy"); });
    });
  });
  var bodyEl = $("body");
  if (bodyEl) bodyEl.querySelectorAll("h2[id]").forEach(function (h) {
    var a = d.createElement("button");
    a.type = "button"; a.className = "anc"; a.textContent = "#";
    a.title = "copy link to this section";
    a.setAttribute("aria-label", "copy link to this section");
    h.appendChild(a);
    a.addEventListener("click", function () {
      var url = location.href.split("#")[0] + "#" + h.id;
      copyText(url).then(function () { flash(a, "link copied", "done", "#"); }, function () {});
    });
  });

  /* ---------- outline: active section + smooth jump ---------- */
  var outline = $("outline");
  if (outline && main) {
    var pairs = [];
    outline.querySelectorAll("a[data-h]").forEach(function (a) { var h = d.getElementById(a.dataset.h); if (h) pairs.push([h, a]); });
    var spy = function () {
      if (!pairs.length) return;
      var top = main.getBoundingClientRect().top, act = pairs[0][1];
      pairs.forEach(function (p) { if (p[0].getBoundingClientRect().top - top <= 140) act = p[1]; });
      pairs.forEach(function (p) { p[1].classList.toggle("on", p[1] === act); });
    };
    var ticking = false;
    main.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; spy(); }); } }, { passive: true });
    spy();
    outline.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-h]");
      if (!a) return;
      var h = d.getElementById(a.dataset.h);
      if (!h) return;
      e.preventDefault();
      main.scrollTo({ top: main.scrollTop + h.getBoundingClientRect().top - main.getBoundingClientRect().top - 60, behavior: reducedMotion() ? "auto" : "smooth" });
      history.replaceState(null, "", "#" + h.id);
    });
  }

  /* ---------- lightbox ---------- */
  if (lb) {
    d.addEventListener("click", function (e) {
      var a = e.target.closest("[data-lb]");
      if (!a) return;
      e.preventDefault();
      var img = a.querySelector("img");
      lbi.src = a.getAttribute("href");
      lbi.alt = img ? img.alt : "";
      lb.hidden = false;
    });
    lb.addEventListener("click", closeLb);
  }

  /* ---------- diagrams (Mermaid, only on pages that have one) ---------- */
  var diagrams = Array.prototype.slice.call(d.querySelectorAll("pre.mermaid"));
  if (diagrams.length && me && me.dataset.mermaid) {
    var sources = diagrams.map(function (el) { return el.textContent; });
    var mermaidLib = null;
    var themeVars = function () {
      var cs = getComputedStyle(root), v = function (n) { return cs.getPropertyValue(n).trim(); };
      return {
        darkMode: root.dataset.theme !== "light",
        fontFamily: "Geist, system-ui, sans-serif", fontSize: "14px",
        background: v("--sidebar"),
        primaryColor: v("--surface"), primaryTextColor: v("--text"), primaryBorderColor: v("--accent"),
        secondaryColor: v("--chip"), secondaryTextColor: v("--text"), secondaryBorderColor: v("--border-strong"),
        tertiaryColor: v("--bg"), tertiaryTextColor: v("--text"), tertiaryBorderColor: v("--border-strong"),
        mainBkg: v("--surface"), nodeBorder: v("--accent"), nodeTextColor: v("--text"),
        lineColor: v("--text-muted"), textColor: v("--text"), titleColor: v("--text"),
        clusterBkg: v("--bg"), clusterBorder: v("--border-strong"), edgeLabelBackground: v("--sidebar"),
        noteBkgColor: v("--chip"), noteTextColor: v("--text"), noteBorderColor: v("--border-strong"),
        actorBkg: v("--surface"), actorBorder: v("--accent"), actorTextColor: v("--text"), actorLineColor: v("--text-muted"),
        signalColor: v("--text-muted"), signalTextColor: v("--text"),
        labelBoxBkgColor: v("--surface"), labelBoxBorderColor: v("--border-strong"), labelTextColor: v("--text"), loopTextColor: v("--text"),
        activationBkgColor: v("--chip"), activationBorderColor: v("--accent"), sequenceNumberColor: v("--on-accent"),
        pie1: v("--accent"), pie2: v("--pink"), pie3: v("--cyan"), pie4: v("--green"), pie5: v("--orange"), pie6: v("--yellow"), pie7: v("--red"),
        pieStrokeColor: v("--bg"), pieOuterStrokeColor: v("--border-strong"), pieTitleTextColor: v("--text"), pieSectionTextColor: v("--on-accent"), pieLegendTextColor: v("--text")
      };
    };
    var draw = function () {
      var load = mermaidLib ? Promise.resolve(mermaidLib) : import(me.dataset.mermaid).then(function (m) { mermaidLib = m.default; return mermaidLib; });
      return load.then(function (mm) {
        mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: themeVars(), fontFamily: "Geist, system-ui, sans-serif" });
        diagrams.forEach(function (el, i) { el.removeAttribute("data-processed"); el.textContent = sources[i]; });
        return mm.run({ nodes: diagrams, suppressErrors: true });
      }).catch(function (err) {
        diagrams.forEach(function (el, i) { el.textContent = sources[i]; el.classList.add("failed"); });
        if (window.console) console.error("diagram rendering failed", err);
      });
    };
    (d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve()).then(draw);
    d.addEventListener("themechange", draw);
  }
})();
