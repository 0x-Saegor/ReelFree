/*
 * ReelFree YouTube — Shorts tab and shelves hidden, /shorts/<id> opened as a regular video,
 * sponsored slots hidden and video ads skipped (fallback of web/youtube-ads.js, D05).
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

  var VERSION = '0.3.1';
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
  // D01 (perf): no :has(). Containers of Shorts are flagged by JS (SHORTS_CONTAINERS) and hidden
  // through [data-reelfree-shorts].
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
  var AD_SLOTS = 'ytd-ad-slot-renderer, ytm-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ' +
    'ytd-promoted-sparkles-web-renderer, ytm-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ' +
    'ytm-promoted-video-renderer, ytd-display-ad-renderer, ytd-banner-promo-renderer, ytm-companion-ad-renderer, ' +
    'ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer';
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
    '  padding: 40px 16px; text-align: center; font: 600 16px -apple-system, system-ui, sans-serif; color: #888; }',

    // D05: sponsored slots in feeds, search and the watch page (always on). Item containers that
    // hold one are flagged by JS (AD_CONTAINERS). TODO(recon): check names on m.youtube.com.
    AD_SLOTS + ', [data-reelfree-ad], #masthead-ad, #player-ads, .ytp-ad-overlay-container' + HIDE
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
      S + '[data-reelfree-shorts]' + HIDE                       // marked by JS (labels, containers)
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
  var SHORTS_LOOP_MS = 5000;
  var lastShorts = { id: null, at: 0 };
  function shortsLoopGuard(to) {
    var id = to.slice('/watch?v='.length);
    var now = Date.now();
    var prev = lastShorts;
    // F6 (B05 review): in the app nothing is written to web storage, the guard is memory only.
    if (!BRIDGE) {
      try {
        var m = /^([A-Za-z0-9_-]{11}):(\d{1,16})$/.exec(window.sessionStorage.getItem('reelfree:yt-shorts-at') || '');
        if (m && Number(m[2]) > prev.at) prev = { id: m[1], at: Number(m[2]) };
      } catch (e) { /* memory only */ }
    }
    if (prev.id === id && now - prev.at < SHORTS_LOOP_MS) return false;
    lastShorts = { id: id, at: now };
    if (!BRIDGE) {
      try { window.sessionStorage.setItem('reelfree:yt-shorts-at', id + ':' + now); } catch (e) { /* memory only */ }
    }
    return true;
  }

  // YouTube reuses one <video> across routes: a mute set while masked must be undone on unmask,
  // or the next video plays silently.
  var maskMuted = typeof WeakMap === 'function' ? new WeakMap() : null;

  function pauseMedia() {
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      try {
        if (maskMuted && !maskMuted.has(v)) maskMuted.set(v, !!v.muted);
        v.muted = true; v.pause();
      } catch (e) { /* ignore */ }
    }
  }

  function restoreSound() {
    if (!maskMuted) return;
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (!maskMuted.has(v)) continue;
      try { v.muted = maskMuted.get(v); } catch (e) { /* ignore */ }
      maskMuted['delete'](v);
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
    var was = masked;
    masked = on;
    applyAttrs();
    if (on) pauseMedia();
    else if (was) restoreSound();
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

  // Containers hidden when they hold a Short (these replaced :has() rules). [container, inner].
  // TODO(recon): pivot item may not be an <a>; grid-shelf-view-model unverified.
  var SHORTS_CONTAINERS = [
    ['ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer', 'a[href^="/shorts"], a[title="Shorts"]'],
    ['ytm-pivot-bar-item-renderer', 'a[href^="/shorts"]'],
    ['ytd-rich-section-renderer', 'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer'],
    ['ytm-rich-section-renderer', 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytm-reel-shelf-renderer'],
    ['grid-shelf-view-model', 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'],
    ['ytd-item-section-renderer', ':scope > #contents > ytd-reel-shelf-renderer'],
    ['ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ' +
      'ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-compact-video-renderer', 'a[href^="/shorts"]']
  ];

  // A labeled element ("Shorts" chip or tab) stays flagged; a container follows its content, since
  // YouTube recycles renderers and rewrites their links in place.
  function scanContainer(el, inner, flag) {
    if (el.hasAttribute('data-reelfree-label')) return;
    var on = !!el.querySelector(inner);
    if (on) { if (!el.hasAttribute(flag)) el.setAttribute(flag, ''); }
    else if (el.hasAttribute(flag)) el.removeAttribute(flag);
  }

  // D05: single feed items that wrap a sponsored slot (never a whole section: search results
  // share their section with an ad).
  var AD_CONTAINERS = [['ytd-rich-item-renderer, ytm-rich-item-renderer', AD_SLOTS]];

  function scanContainers(n, table, flag) {
    for (var k = 0; k < table.length; k++) {
      var c = table[k];
      var up = n.closest(c[0]);
      if (up) scanContainer(up, c[1], flag);
      var list = n.querySelectorAll(c[0]);
      for (var j = 0; j < list.length; j++) scanContainer(list[j], c[1], flag);
    }
  }

  // ---------------------------------------------------------------------------
  // D05 fallback for video ads that youtube-ads.js (page world) could not prune: while the player
  // shows an ad (.ad-showing), mute it, seek to its end and press "Skip" when present. The muted
  // state is restored when the ad ends. Event driven: one class observer per player, no timer.
  // ---------------------------------------------------------------------------
  var PLAYER_SEL = '.html5-video-player, #movie_player';
  var SKIP_SEL = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, ' +
    '.ytp-ad-skip-button-slot button, .ytp-ad-skip-button-container button';
  // G3: .ad-showing alone is page controlled and could stay on the real video. Act only when the
  // ad UI is also in the player, or when the media is short enough to be an ad. TODO(recon): names
  // checked against a real ad capture.
  var AD_UI_SEL = '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-preview-container, ' +
    '.ytp-ad-simple-ad-badge, .ytp-ad-badge, .ytp-ad-text, .ytp-ad-duration-remaining';
  var AD_MAX_SECONDS = 30;
  var weakOk = typeof WeakSet === 'function' && typeof WeakMap === 'function';
  var watchedPlayers = weakOk ? new WeakSet() : null;
  var watchedVideos = weakOk ? new WeakSet() : null;
  var mutedBefore = weakOk ? new WeakMap() : null;

  function playerOf(v) {
    return v && v.closest ? v.closest(PLAYER_SEL) : null;
  }

  function adConfirmed(player, v) {
    if (!player.classList.contains('ad-showing')) return false;
    if (player.querySelector(AD_UI_SEL)) return true;
    var d = v.duration;
    return typeof d === 'number' && isFinite(d) && d > 0 && d <= AD_MAX_SECONDS;
  }

  function actOnAd(player, v) {
    if (!adConfirmed(player, v)) return;
    if (!mutedBefore.has(v)) mutedBefore.set(v, !!v.muted);
    skipAd(player, v);
  }

  function skipAd(player, v) {
    try { v.muted = true; } catch (e) { /* ignore */ }
    var d = v.duration;
    if (typeof d === 'number' && isFinite(d) && d > 0 && v.currentTime < d) {
      try { v.currentTime = d; } catch (e) { /* not seekable yet */ }
    }
    var btn = player.querySelector(SKIP_SEL);
    if (btn) { try { btn.click(); } catch (e) { /* ignore */ } }
  }

  function onAdMedia(ev) {
    var v = ev.target;
    var p = playerOf(v);
    if (p) actOnAd(p, v);
  }

  function checkAd(player) {
    var v = player.querySelector('video');
    if (!v) return;
    if (player.classList.contains('ad-showing')) {
      if (!watchedVideos.has(v)) {
        watchedVideos.add(v);
        v.addEventListener('loadedmetadata', onAdMedia, true);
        v.addEventListener('durationchange', onAdMedia, true);
        v.addEventListener('playing', onAdMedia, true);
      }
      actOnAd(player, v);
    } else if (mutedBefore.has(v)) {
      try { v.muted = mutedBefore.get(v); } catch (e) { /* ignore */ }
      mutedBefore['delete'](v);
    }
  }

  function watchPlayer(p) {
    if (!weakOk) return;
    if (watchedPlayers.has(p)) {
      if (p.classList.contains('ad-showing')) checkAd(p);   // e.g. its <video> was just inserted
      return;
    }
    watchedPlayers.add(p);
    new MutationObserver(function () {
      try { checkAd(p); } catch (e) { reportError('ads', e); }
    }).observe(p, { attributes: true, attributeFilter: ['class'] });
    checkAd(p);
  }

  function scanPlayers(n) {
    var up = n.closest(PLAYER_SEL);
    if (up) watchPlayer(up);
    var list = n.querySelectorAll(PLAYER_SEL);
    for (var j = 0; j < list.length; j++) watchPlayer(list[j]);
  }

  function scanLabel(el) {
    if (el.hasAttribute('data-reelfree-shorts')) return;
    if ((el.textContent || '').trim() === 'Shorts') {
      el.setAttribute('data-reelfree-label', '');
      el.setAttribute('data-reelfree-shorts', '');
    }
  }

  // Flags Shorts UI, sponsored items and video players in the given subtrees only (added nodes,
  // changed links: D01), never the whole document in the mutation path. markUi([root]) is the
  // full pass, on route or config change only.
  // Removed content: the containers above a changed parent may no longer hold a Short or an ad.
  function markUp(ups) {
    for (var i = 0; i < ups.length; i++) {
      var n = ups[i];
      if (!n.isConnected) continue;
      upContainers(n, AD_CONTAINERS, 'data-reelfree-ad');
      if (CONFIG.hideShorts) upContainers(n, SHORTS_CONTAINERS, 'data-reelfree-shorts');
    }
  }

  function upContainers(n, table, flag) {
    for (var k = 0; k < table.length; k++) {
      var up = n.closest(table[k][0]);
      if (up) scanContainer(up, table[k][1], flag);
    }
  }

  function markUi(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || n.nodeType !== 1 || !n.isConnected) continue;
      scanContainers(n, AD_CONTAINERS, 'data-reelfree-ad');
      scanPlayers(n);
      if (!CONFIG.hideShorts) continue;
      scanContainers(n, SHORTS_CONTAINERS, 'data-reelfree-shorts');
      var lab = n.closest(LABELED);
      if (lab) scanLabel(lab);
      var labs = n.querySelectorAll(LABELED);
      for (var m = 0; m < labs.length; m++) scanLabel(labs[m]);
    }
  }

  // ---------------------------------------------------------------------------
  // Router: popstate + YouTube SPA events + mutation pass; polling only outside the app
  // (in the app, routes come from onNative {type: "route"}, Avenant 4).
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
        markUi([root]);
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
    if (!msg || typeof msg !== 'object') return;
    try {
      if (msg.type === 'route') {
        // Avenant 4: pushed on every URL change; the path is a hint, window.location decides.
        if (typeof msg.path !== 'string') return;
        if (msg.via === 'popstate') onPopstate();
        else checkRoute();
        return;
      }
      if (msg.type !== 'config') return;
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

  function onPopstate() {
    viaPopstate = true;
    try { checkRoute(); } finally { viaPopstate = false; }
  }

  function onMutations(nodes, ups) {
    applyAttrs();   // the page may have rewritten <html> attributes
    if (!styleEl.isConnected) styleEl = injectStyle('reelfree-yt-style', CSS);
    var before = lastPath;
    checkRoute();
    if (masked) { pauseMedia(); return; }
    if (lastPath !== before) return;   // the new route already ran a full pass
    try {
      markUi(nodes);
      markUp(ups);
    } catch (e) {
      setMask(true);
    }
  }

  // Single MutationObserver, batched once per frame (D01): added nodes and changed attributes are
  // queued and scanned in requestAnimationFrame (before the next paint), with a one-shot timer
  // fallback because rAF is suspended while a navigation is pending or the WebView is hidden.
  var MO_MAX_QUEUE = 2000;
  var MO_FALLBACK_MS = 100;
  var moQueue = [];
  var moUp = [];   // parents of removed nodes: only their containers (ancestors) are re-checked
  var moFull = false;
  var moScheduled = false;
  var moTimer = 0;
  // Hiding flags set by this script (G2): the page stripping one from a recycled node re-checks it.
  var MO_FLAGS = ['data-reelfree-shorts', 'data-reelfree-ad'];
  var MO_FLAG_SET = {};
  for (var fi = 0; fi < MO_FLAGS.length; fi++) MO_FLAG_SET[MO_FLAGS[fi]] = true;
  function flushMutations() {
    if (!moScheduled) return;
    moScheduled = false;
    window.clearTimeout(moTimer);
    var nodes = moFull ? [root] : moQueue;
    var ups = moFull ? [] : moUp;
    moQueue = [];
    moUp = [];
    moFull = false;
    onMutations(nodes, ups);
  }
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length && !moFull; i++) {
      var r = records[i];
      if (r.type === 'attributes') {
        // G2: our own flags are watched too, but only a removal (by the page, or by us when the
        // condition ends) re-checks the node; setting a flag never re-queues it, so this converges.
        if (!MO_FLAG_SET[r.attributeName] || !r.target.hasAttribute(r.attributeName)) moQueue.push(r.target);
      } else {
        for (var j = 0; j < r.addedNodes.length; j++) if (r.addedNodes[j].nodeType === 1) moQueue.push(r.addedNodes[j]);
        if (r.removedNodes.length && r.target.nodeType === 1) moUp.push(r.target);
      }
      if (moQueue.length + moUp.length > MO_MAX_QUEUE) { moFull = true; moQueue = []; moUp = []; }
    }
    if (moScheduled) return;
    moScheduled = true;
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(flushMutations);
    moTimer = window.setTimeout(flushMutations, MO_FALLBACK_MS);
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
    window.addEventListener('popstate', onPopstate, true);
    window.addEventListener('click', onClick, true);
    // YouTube SPA navigation events (desktop); harmless if never fired.
    document.addEventListener('yt-navigate-start', checkRoute, true);
    document.addEventListener('yt-navigate-finish', checkRoute, true);
    if (!BRIDGE) window.setInterval(checkRoute, POLL_MS);
    // href / is-shorts / title: YouTube recycles renderers and rewrites them in place.
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'is-shorts', 'title'].concat(MO_FLAGS) });
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
