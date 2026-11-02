/*
 * ReelFree YouTube — Shorts tab and shelves hidden, /shorts/<id> opened as a regular video.
 *
 * Injected by the iOS app at document-start, main frame only, in WKContentWorld.defaultClient,
 * after `window.RF_CONFIG = {...}` (docs/SPEC-iOS.md; key used here: ytHideHomeFeed).
 * Without window.webkit (Node, Playwright) it runs standalone with CONFIG below.
 *
 * Security rules (see CLAUDE.md): no network, no dynamic code, no HTML-string DOM sinks,
 * storage: one sessionStorage flag "<videoId>:<ts>" (Shorts loop guard, standalone only), never read user content (only URL paths and structural selectors),
 * fail-closed: the page stays masked until the current route is allowed.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG — edit by hand.
  // ---------------------------------------------------------------------------
  var CONFIG = {
    hideHomeFeed: false,   // true: hide recommendations on the home page ('/')
    hideShorts: true       // hide Shorts tab, shelves and entries (redirects of /shorts/<id> always apply)
  };

  var VERSION = '0.2.0';
  var POLL_MS = 250;

  // ---------------------------------------------------------------------------
  // URL policy — pure function, no DOM / storage / clock access.
  //
  // decideYT(path, search, ctx) -> {
  //   action: 'allow' | 'redirect' | 'hide',
  //   to: string | null,       // same-origin path when action === 'redirect'
  //   reason: string,          // 'Y-shorts', 'Y-shorts-invalid', 'Y-shorts-tab', 'Y-decode', ...
  //   mode: string             // home, home-off, watch, other, shorts, blocked
  // }
  // search: location.search (currently unused, kept for future rules; never echoed into 'to').
  // ctx = { config: { hideHomeFeed } }   // optional, defaults = CONFIG
  // ---------------------------------------------------------------------------
  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var HANDLE_RE = /^@[A-Za-z0-9._-]{1,100}$/;
  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  var LEGACY_NAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/;   // at least one alphanumeric: no ".."

  function result(action, to, reason, mode) {
    return { action: action, to: action === 'redirect' ? to : null, reason: reason, mode: mode };
  }

  function hide(reason) {
    return result('hide', null, reason, 'blocked');
  }

  // Channel root rebuilt only from validated segments (no open redirect), else '/'.
  function channelRoot(raw, seg) {
    if (seg.length >= 1 && HANDLE_RE.test(raw[0])) return '/' + raw[0];
    if (seg.length >= 2 && seg[0] === 'channel' && CHANNEL_ID_RE.test(raw[1])) return '/channel/' + raw[1];
    if (seg.length >= 2 && (seg[0] === 'c' || seg[0] === 'user') && LEGACY_NAME_RE.test(raw[1])) {
      return '/' + seg[0] + '/' + raw[1];
    }
    return '/';
  }

  function decideYT(path, search, ctx) {
    ctx = ctx || {};
    var c = ctx.config || {};
    var hideHome = typeof c.hideHomeFeed === 'boolean' ? c.hideHomeFeed : CONFIG.hideHomeFeed;

    if (typeof path !== 'string') return hide('Y-invalid');

    var p = path.split('?')[0].split('#')[0];
    // Encoded separators or dot-segments would make the decoded segments differ from the router's.
    if (/%2f|%5c|%2e%2e/i.test(p)) return hide('Y-path');
    try {
      p = decodeURIComponent(p);
    } catch (e) {
      return hide('Y-decode');
    }
    if (/\\/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p)) return hide('Y-path');
    // Drop ';params' from segments so matrix-style variants cannot slip through.
    var raw = p.split('/')
      .map(function (s) { return s.split(';')[0]; })
      .filter(function (s) { return s !== ''; });
    var seg = raw.map(function (s) { return s.toLowerCase(); });

    if (seg.length === 0) {
      return result('allow', null, 'Y-home', hideHome ? 'home-off' : 'home');
    }

    // /shorts/<id>[/...] -> /watch?v=<id>; anything else under /shorts -> home.
    if (seg[0] === 'shorts') {
      if (seg.length >= 2 && VIDEO_ID_RE.test(raw[1])) {
        return result('redirect', '/watch?v=' + raw[1], 'Y-shorts', 'shorts');
      }
      return result('redirect', '/', 'Y-shorts-invalid', 'shorts');
    }
    // /feed/shorts (Shorts feed).
    if (seg[0] === 'feed' && seg[1] === 'shorts') {
      return result('redirect', '/', 'Y-shorts-feed', 'shorts');
    }
    // Channel Shorts tab: /@handle/shorts, /channel/<id>/shorts, /c/<name>/shorts, /user/<name>/shorts.
    if (seg.indexOf('shorts') !== -1 && seg[0] !== 'watch' && seg[0] !== 'results') {
      return result('redirect', channelRoot(raw, seg), 'Y-shorts-tab', 'shorts');
    }

    if (seg[0] === 'watch') return result('allow', null, 'Y-watch', 'watch');
    return result('allow', null, 'default', 'other');
  }

  // ---------------------------------------------------------------------------
  // Node export for unit tests. Nothing below runs outside a browser.
  // ---------------------------------------------------------------------------
  // App settings (window.RF_CONFIG, {type: "config"} messages): known keys with valid values only.
  // Returns the CONFIG keys that changed.
  function mergeConfig(into, from) {
    var changed = [];
    if (!from || typeof from !== 'object') return changed;
    if (typeof from.ytHideHomeFeed === 'boolean' && into.hideHomeFeed !== from.ytHideHomeFeed) {
      into.hideHomeFeed = from.ytHideHomeFeed;
      changed.push('hideHomeFeed');
    }
    return changed;
  }

  // Avenant 1 (docs/SPEC-iOS.md): only youtube.com and its subdomains; a no-op on any other host
  // (Google sign-in pages share the app's bound domains).
  function hostAllowed(host) {
    return typeof host === 'string' && /(^|\.)youtube\.com$/.test(host.toLowerCase());
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { decideYT: decideYT, hostAllowed: hostAllowed, mergeConfig: mergeConfig, CONFIG: CONFIG, VERSION: VERSION };
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!hostAllowed(window.location.hostname)) return;

  // ---------------------------------------------------------------------------
  // CSS. Custom-element tag names and attributes only, never obfuscated classes.
  // Each :has() selector sits in its own rule: an engine without :has() drops
  // that rule only, the others survive.
  // ---------------------------------------------------------------------------
  var root = null;   // set in start(): WebKit may run us before <html> exists

  // Bridge to the app (docs/SPEC-iOS.md). Present only inside the iOS app.
  var BRIDGE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.reelfree);
  function post(msg) {
    if (!BRIDGE) return;
    try { window.webkit.messageHandlers.reelfree.postMessage(msg); } catch (e) { /* app gone: standalone */ }
  }
  function reportError(where, e) {
    post({ type: 'error', where: where, message: String((e && e.name) || 'Error') });
  }
  if (BRIDGE) {
    try { mergeConfig(CONFIG, window.RF_CONFIG); } catch (e) { reportError('config', e); }
  }
  var HIDE = ' { display: none !important; }';
  var S = CONFIG.hideShorts ? 'html[data-rfy-shorts="hide"] ' : null;
  var SHORTS_LINK = 'a[href^="/shorts"], a[href*="youtube.com/shorts/"]';

  var rules = [
    // Fail-closed mask: everything hidden until an 'allow' decision.
    'html[data-reelfree="mask"] body' + HIDE,
    'html[data-reelfree="mask"]::after { content: "ReelFree"; position: fixed; inset: 0;',
    // Loop guard message (see shortsLoopGuard).
    '  display: flex; align-items: center; justify-content: center;',
    '  font: 600 18px -apple-system, system-ui, sans-serif; color: #888; background: #fff; z-index: 2147483647; }',

    // Home recommendations (hideHomeFeed).
    'html[data-rfy-mode="home-off"] ytd-browse[page-subtype="home"] #contents' + HIDE,
    'html[data-rfy-mode="home-off"] ytd-browse[page-subtype="home"] #chips-wrapper' + HIDE,
    // TODO(recon): mobile home container names (ytm-browse > ytm-rich-grid-renderer / ytm-section-list-renderer).
    'html[data-rfy-mode="home-off"] ytm-browse ytm-rich-grid-renderer' + HIDE,
    'html[data-rfy-mode="home-off"] ytm-browse ytm-section-list-renderer' + HIDE,
    'html[data-rfy-mode="home-off"] ytm-browse ytm-feed-filter-chip-bar-renderer' + HIDE,
    'html[data-rfy-loop][data-reelfree="mask"]::after { content: "Short non lisible hors du lecteur Shorts"; }',
    'html[data-rfy-mode="home-off"] body::after { content: "Accueil masqué par ReelFree"; display: block;',
    '  padding: 40px 16px; text-align: center; font: 600 16px -apple-system, system-ui, sans-serif; color: #888; }'
  ];

  if (S) {
    rules.push(
      // Plain selectors (no :has), safe on every engine.
      S + 'a[href^="/shorts"]' + HIDE,
      S + 'a[href*="youtube.com/shorts/"]' + HIDE,
      S + 'ytd-reel-shelf-renderer' + HIDE,
      S + 'ytm-reel-shelf-renderer' + HIDE,
      S + 'ytd-rich-shelf-renderer[is-shorts]' + HIDE,
      S + 'ytd-reel-item-renderer' + HIDE,
      S + 'ytm-reel-item-renderer' + HIDE,
      S + 'ytm-shorts-lockup-view-model' + HIDE,
      S + 'ytm-shorts-lockup-view-model-v2' + HIDE,
      S + 'ytd-guide-entry-renderer a[title="Shorts"]' + HIDE,
      S + 'ytd-mini-guide-entry-renderer[aria-label="Shorts"]' + HIDE,
      S + 'yt-tab-shape[tab-title="Shorts"]' + HIDE,            // TODO(recon): channel tab on desktop
      S + '[data-reelfree-shorts]' + HIDE,                      // marked by JS (chips, pivot items)

      // :has() rules, one per rule.
      S + 'ytd-guide-entry-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytd-guide-entry-renderer:has(a[title="Shorts"])' + HIDE,
      S + 'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])' + HIDE,
      S + 'ytm-pivot-bar-item-renderer:has(a[href^="/shorts"])' + HIDE,   // TODO(recon): pivot item may not be an <a>
      S + 'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])' + HIDE,
      S + 'ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)' + HIDE,
      S + 'ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model)' + HIDE,
      S + 'ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model-v2)' + HIDE,
      S + 'ytm-rich-section-renderer:has(ytm-reel-shelf-renderer)' + HIDE,
      S + 'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)' + HIDE,     // TODO(recon)
      S + 'grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2)' + HIDE,  // TODO(recon)
      S + 'ytd-item-section-renderer:has(> #contents > ytd-reel-shelf-renderer)' + HIDE,
      S + 'ytd-rich-item-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytd-video-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytd-grid-video-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytd-compact-video-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytm-rich-item-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytm-video-with-context-renderer:has(a[href^="/shorts"])' + HIDE,
      S + 'ytm-compact-video-renderer:has(a[href^="/shorts"])' + HIDE
    );
  }
  var CSS = rules.join('\n');

  function injectStyle(id, text) {
    var style = document.createElement('style');
    style.id = id;
    style.textContent = text;
    (document.head || root).appendChild(style);
    return style;
  }
  var styleEl = null;

  // ---------------------------------------------------------------------------
  // Mask & attributes.
  // ---------------------------------------------------------------------------
  var masked = true;
  var currentMode = 'blocked';
  var lastPath = null;
  var viaPopstate = false;   // current evaluation comes from history traversal (Avenant 2)

  // Loop guard: if YouTube itself sends /watch?v=<id> back to /shorts/<id>, we would bounce forever.
  // A redirect of the SAME Short less than 5 s after the previous one stops and stays masked with a
  // message. Memory covers SPA loops; a sessionStorage flag "<videoId>:<ts>" covers full-page loops.
  var SHORTS_LOOP_KEY = 'reelfree:yt-shorts-at';
  var SHORTS_LOOP_MS = 5000;
  var lastShorts = { id: null, at: 0 };
  function shortsLoopGuard(to) {
    var id = to.slice('/watch?v='.length);
    var now = Date.now();
    var prev = lastShorts;
    // F6 (B05 review): in the app nothing is written to web storage, the guard is memory only.
    if (!BRIDGE) {
      try {
        var m = /^([A-Za-z0-9_-]{11}):(\d{1,16})$/.exec(window.sessionStorage.getItem(SHORTS_LOOP_KEY) || '');
        if (m && Number(m[2]) > prev.at) prev = { id: m[1], at: Number(m[2]) };
      } catch (e) { /* memory only */ }
    }
    if (prev.id === id && now - prev.at < SHORTS_LOOP_MS) return false;
    lastShorts = { id: id, at: now };
    if (!BRIDGE) {
      try { window.sessionStorage.setItem(SHORTS_LOOP_KEY, id + ':' + now); } catch (e) { /* memory only */ }
    }
    return true;
  }

  function pauseMedia() {
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].muted = true; vids[i].pause(); } catch (e) { /* ignore */ }
    }
  }

  function setAttr(name, value) {
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }

  function applyAttrs() {
    setAttr('data-reelfree', masked ? 'mask' : 'ok');
    setAttr('data-rfy-mode', currentMode);
    setAttr('data-rfy-shorts', CONFIG.hideShorts ? 'hide' : 'show');
  }

  function setMask(on) {
    masked = on;
    applyAttrs();
    if (on) pauseMedia();
  }

  function isSameOriginPath(to) {
    if (typeof to !== 'string' || to.charAt(0) !== '/' || to.charAt(1) === '/' || to.charAt(1) === '\\') return false;
    try {
      return new URL(to, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Structural marking of Shorts UI that CSS alone cannot target (exact UI label match only,
  // the label is compared, never stored or copied).
  // ---------------------------------------------------------------------------
  // TODO(recon): verify chip and pivot-bar element names on m.youtube.com and www.youtube.com.
  var LABELED = 'yt-chip-cloud-chip-renderer, ytm-chip-cloud-chip-renderer, ytm-pivot-bar-item-renderer, ' +
    'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer';

  function markShortsUi() {
    if (!CONFIG.hideShorts) return;
    var els = document.querySelectorAll(LABELED);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-reelfree-shorts')) continue;
      if ((el.textContent || '').trim() === 'Shorts') el.setAttribute('data-reelfree-shorts', '');
    }
  }

  // ---------------------------------------------------------------------------
  // Router: popstate + YouTube SPA events + polling fallback.
  // ---------------------------------------------------------------------------
  function evaluate() {
    var d;
    try {
      d = decideYT(window.location.pathname, window.location.search, { config: CONFIG });
    } catch (e) {
      reportError('decide', e);
      d = hide('Y-error');
    }
    currentMode = d.mode;

    if (d.action === 'allow') {
      try {
        applyAttrs();
        markShortsUi();
      } catch (e) {
        setMask(true);
        return;
      }
      setMask(false);
      return;
    }

    setMask(true);
    if (d.action === 'redirect' && isSameOriginPath(d.to)) {
      if (d.reason === 'Y-shorts' && !shortsLoopGuard(d.to)) {
        root.setAttribute('data-rfy-loop', '');
        return;
      }
      window.location.replace(d.to);
    }
  }

  function checkRoute() {
    var path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    post(viaPopstate ? { type: 'route', path: path, via: 'popstate' } : { type: 'route', path: path });
    evaluate();
  }

  // Native -> JS: window.reelfree.onNative(msg). Only {type: "config"} matters here; DM messages
  // are Instagram-only and ignored, like anything unknown or malformed.
  function onNative(msg) {
    if (!msg || typeof msg !== 'object' || msg.type !== 'config') return;
    try {
      if (!mergeConfig(CONFIG, msg.config).length) return;
      lastPath = null;   // re-decide the current route with the new settings
      checkRoute();
    } catch (e) {
      reportError('onNative', e);
    }
  }

  // Click capture: a link to a Short opens the regular watch page instead (no SPA transition).
  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var a = t.closest('a[href]');
    if (!a) return;
    var u;
    try { u = new URL(a.href, window.location.href); } catch (e) { return; }
    if (u.origin !== window.location.origin) return;
    var d;
    try { d = decideYT(u.pathname, u.search, { config: CONFIG }); } catch (e) { d = hide('Y-error'); }
    if (d.action === 'allow') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (d.action === 'redirect' && isSameOriginPath(d.to)) window.location.assign(d.to);
  }

  function onMutations() {
    applyAttrs();   // the page may have rewritten <html> attributes
    if (!styleEl.isConnected) styleEl = injectStyle('reelfree-yt-style', CSS);
    checkRoute();
    if (masked) { pauseMedia(); return; }
    try {
      markShortsUi();
    } catch (e) {
      setMask(true);
    }
  }

  // Single throttled MutationObserver.
  var MO_THROTTLE_MS = 150;
  var moScheduled = false;
  var observer = new MutationObserver(function () {
    if (moScheduled) return;
    moScheduled = true;
    window.setTimeout(function () {
      moScheduled = false;
      onMutations();
    }, MO_THROTTLE_MS);
  });

  // --- Boot ------------------------------------------------------------------
  function start() {
    root = document.documentElement;
    if (BRIDGE) {
      try {
        Object.defineProperty(window, 'reelfree', {
          value: Object.freeze({ onNative: onNative, version: VERSION }), writable: false, configurable: false
        });
      } catch (e) { reportError('bridge', e); }
    }
    applyAttrs();   // masked = true at this point
    styleEl = injectStyle('reelfree-yt-style', CSS);
    checkRoute();
    window.addEventListener('popstate', function () {
      viaPopstate = true;
      try { checkRoute(); } finally { viaPopstate = false; }
    }, true);
    window.addEventListener('click', onClick, true);
    // YouTube SPA navigation events (desktop); harmless if never fired.
    document.addEventListener('yt-navigate-start', checkRoute, true);
    document.addEventListener('yt-navigate-finish', checkRoute, true);
    window.setInterval(checkRoute, POLL_MS);
    observer.observe(root, { childList: true, subtree: true });
    new MutationObserver(applyAttrs).observe(root, {
      attributes: true, attributeFilter: ['data-reelfree', 'data-rfy-mode', 'data-rfy-shorts']
    });
    post({ type: 'ready', script: 'youtube', version: VERSION });
  }

  if (document.documentElement) {
    start();
  } else {
    // Nothing can render before <html> exists; start (and mask) as soon as it is inserted.
    var waitRoot = new MutationObserver(function () {
      if (!document.documentElement) return;
      waitRoot.disconnect();
      start();
    });
    waitRoot.observe(document, { childList: true });
  }
})();
