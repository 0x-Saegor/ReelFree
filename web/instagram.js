/*
 * ReelFree — Instagram without Reels, Explore or infinite scroll. Reels received in DMs stay viewable.
 *
 * Injected by the iOS app at document-start, main frame only, in WKContentWorld.defaultClient,
 * after `window.RF_CONFIG = {...}` (docs/SPEC-iOS.md). The native route guard is authoritative;
 * this script is the second line of defense and the in-page UI (masking, feed cap, D3 lock, D4).
 * Without window.webkit (Node, Playwright) it runs standalone: DM token in sessionStorage.
 *
 * Security rules (see CLAUDE.md): no network, no dynamic code, no HTML-string DOM sinks,
 * no persistent storage (sessionStorage keys prefixed "reelfree:" only),
 * never read message content, fail-closed.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG — edit by hand.
  // ---------------------------------------------------------------------------
  var CONFIG = {
    feedMode: 'limited',   // 'limited' | 'off'
    feedLimit: 15,         // max posts shown on the home feed when feedMode === 'limited'
    blockExplore: true,    // R5
    dmReelTtlMs: 10000,    // D2: lifetime of the one-shot DM reel token
    feedVariant: 'following'   // 'following' (only accounts you follow) | 'default' ("Pour vous", mostly suggestions)
  };

  var VERSION = '0.3.1';
  var TOKEN_KEY = 'reelfree:dm-allow';   // value: "<reelId>:<createdAtMs>"
  var POLL_MS = 250;
  var DM_TAP_WINDOW_MS = 1500;   // D2 fallback: a tap-driven navigation happens within a few hundred ms

  // ---------------------------------------------------------------------------
  // URL policy — pure function, no DOM / storage / clock access.
  //
  // decide(path, ctx) -> {
  //   action: 'allow' | 'redirect' | 'hide',
  //   to: string | null,          // same-origin path when action === 'redirect'
  //   consumeToken: boolean,      // caller must delete TOKEN_KEY
  //   reason: string,             // 'R2', 'R3', 'R5', 'D2', 'D3', ...
  //   mode: string,               // page mode for CSS: feed, feed-off, dm, dm-reel, post, search, explore, other, blocked
  //   reelId: string | null       // reel admitted by this decision (D2)
  // }
  // ctx = {
  //   now: number,                          // ms epoch
  //   token: { id, ts } | null,             // parsed TOKEN_KEY
  //   lastThread: string | null,            // '/direct/t/<id>/' of the origin conversation
  //   activeReel: string | null,            // reel already admitted on this page (re-evaluation of same URL)
  //   config: { blockExplore, dmReelTtlMs, feedMode }   // optional, defaults = CONFIG
  // }
  // ---------------------------------------------------------------------------
  var REEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var THREAD_RE = /^\/direct\/t\/[A-Za-z0-9_-]{1,128}\/?$/;
  var USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

  function result(action, to, consumeToken, reason, mode, reelId) {
    return {
      action: action,
      to: action === 'redirect' ? to : null,
      consumeToken: !!consumeToken,
      reason: reason,
      mode: mode,
      reelId: reelId || null
    };
  }

  function hide(reason) {
    return result('hide', null, false, reason, 'blocked', null);
  }

  function block(to, reason, consumeToken) {
    return result('redirect', to, consumeToken, reason, 'blocked', null);
  }

  function decideReel(id, ctx, cfg) {
    var token = ctx.token || null;
    var consume = token !== null;  // any token seen on a reel route is spent (valid or not)
    var lastThread = (typeof ctx.lastThread === 'string' && THREAD_RE.test(ctx.lastThread)) ? ctx.lastThread : null;
    var back = lastThread || '/';
    var reasonDeny = (lastThread || ctx.activeReel) ? 'D3' : 'R3';

    if (!REEL_ID_RE.test(id)) return block(back, reasonDeny, consume);

    // Same reel already admitted on this page: re-evaluation (polling, replaceState), not a new navigation.
    if (typeof ctx.activeReel === 'string' && ctx.activeReel === id) {
      return result('allow', null, consume, 'D2', 'dm-reel', id);
    }

    if (tokenValid(token, id, ctx, cfg)) return result('allow', null, true, 'D2', 'dm-reel', id);
    return block(back, reasonDeny, consume);
  }

  function tokenValid(token, id, ctx, cfg) {
    if (!token || token.id !== id || typeof token.ts !== 'number' || typeof ctx.now !== 'number') return false;
    var age = ctx.now - token.ts;
    return age >= 0 && age <= cfg.dmReelTtlMs;
  }

  // /p/<id>/: a regular post, but Instagram may serve a reel under the same shortcode.
  // Always allowed; mode 'post' hides video players (CSS) unless opened from a DM with a token.
  function decidePost(id, ctx, cfg) {
    var token = ctx.token || null;
    // D3: leaving an admitted DM reel for another media (even as /p/) is chaining, not browsing.
    if (typeof ctx.activeReel === 'string' && ctx.activeReel && ctx.activeReel !== id) {
      var lastThread = (typeof ctx.lastThread === 'string' && THREAD_RE.test(ctx.lastThread)) ? ctx.lastThread : null;
      return block(lastThread || '/', 'D3', token !== null);
    }
    if (REEL_ID_RE.test(id)) {
      if (typeof ctx.activeReel === 'string' && ctx.activeReel === id) {
        return result('allow', null, !!(token && token.id === id), 'D2', 'dm-reel', id);
      }
      if (tokenValid(token, id, ctx, cfg)) return result('allow', null, true, 'D2', 'dm-reel', id);
    }
    return result('allow', null, false, 'default', 'post', null);
  }

  // S2: home feed variant. Returns the URL to load instead of the current home URL, or null.
  function feedVariantTarget(search, cfg) {
    var variant = (cfg && cfg.feedVariant) || CONFIG.feedVariant;
    if (variant !== 'following') return null;
    if (/[?&]variant=following(&|$)/.test(typeof search === 'string' ? search : '')) return null;
    return '/?variant=following';
  }

  // Media shortcode targeted by a path (/reel/<id>, /reels/<id>, /tv/<id>, /p/<id>, /<user>/{reel,p}/<id>), or null.
  function mediaIdFromPath(path) {
    if (typeof path !== 'string' || /%2f|%5c|%2e%2e/i.test(path)) return null;
    var p;
    try { p = decodeURIComponent(path.split('?')[0].split('#')[0]); } catch (e) { return null; }
    var raw = p.split('/').map(function (x) { return x.split(';')[0]; }).filter(function (x) { return x !== ''; });
    var seg = raw.map(function (x) { return x.toLowerCase(); });
    var id = null;
    if (seg.length >= 2 && (seg[0] === 'reel' || seg[0] === 'tv' || seg[0] === 'p')) id = raw[1];
    else if (seg.length === 2 && seg[0] === 'reels' && seg[1] !== 'audio') id = raw[1];
    else if (seg.length >= 3 && (seg[1] === 'reel' || seg[1] === 'reels' || seg[1] === 'tv' || seg[1] === 'p')) id = raw[2];
    return id && REEL_ID_RE.test(id) ? id : null;
  }

  function decide(path, ctx) {
    ctx = ctx || {};
    var cfg = {
      blockExplore: CONFIG.blockExplore,
      dmReelTtlMs: CONFIG.dmReelTtlMs,
      feedMode: CONFIG.feedMode
    };
    var c = ctx.config || {};
    if (typeof c.blockExplore === 'boolean') cfg.blockExplore = c.blockExplore;
    if (typeof c.dmReelTtlMs === 'number' && c.dmReelTtlMs >= 0 && isFinite(c.dmReelTtlMs)) cfg.dmReelTtlMs = c.dmReelTtlMs;
    if (c.feedMode === 'limited' || c.feedMode === 'off') cfg.feedMode = c.feedMode;

    if (typeof path !== 'string') return hide('X3-invalid');

    var p = path.split('?')[0].split('#')[0];
    // Encoded separators or dot-segments would make the decoded segments differ from what the
    // router sees ("/direct%2F..%2Freels/"): refuse them outright.
    if (/%2f|%5c|%2e%2e/i.test(p)) return hide('X3-path');
    try {
      p = decodeURIComponent(p);
    } catch (e) {
      return hide('X3-decode');
    }
    if (/\\/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p)) return hide('X3-path');
    // Drop ';params' from segments ("/reels;x/" -> "reels") so matrix-style variants cannot slip through.
    var raw = p.split('/')
      .map(function (s) { return s.split(';')[0]; })
      .filter(function (s) { return s !== ''; });
    var seg = raw.map(function (s) { return s.toLowerCase(); });

    // Home feed.
    if (seg.length === 0) {
      return result('allow', null, false, 'S', cfg.feedMode === 'off' ? 'feed-off' : 'feed', null);
    }

    // R2 / R3: /reels/, /reels/audio/..., /reels/<id>/, /reel/<id>/
    if (seg[0] === 'reels') {
      if (seg.length === 2 && seg[1] !== 'audio') return decideReel(raw[1], ctx, cfg);
      return block('/', 'R2', false);
    }
    if (seg[0] === 'reel' || seg[0] === 'tv') {
      if (seg.length >= 2) return decideReel(raw[1], ctx, cfg);
      return block('/', 'R2', false);
    }

    // R5: Explore. Account search (/explore/search/) stays usable; its grid is hidden by CSS.
    if (seg[0] === 'explore') {
      if (!cfg.blockExplore) return result('allow', null, false, 'R5-off', 'explore', null);
      // Only the bare search page; keyword/tag result grids are Explore in disguise.
      if (seg[1] === 'search' && seg.length === 2) return result('allow', null, false, 'R5-search', 'search', null);
      return block('/', 'R5', false);
    }

    // Posts (possibly a reel in disguise).
    if (seg[0] === 'p' && seg.length >= 2) return decidePost(raw[1], ctx, cfg);
    if (seg.length >= 3 && seg[1] === 'p') return decidePost(raw[2], ctx, cfg);

    // DMs.
    if (seg[0] === 'direct') {
      return result('allow', null, false, 'D1', 'dm', null);
    }

    // Profile-scoped reels: /<user>/reels/ (profile tab) and /<user>/reel/<id>/.
    if (seg.length >= 2 && (seg[1] === 'reel' || seg[1] === 'reels' || seg[1] === 'tv')) {
      if (seg.length >= 3) return decideReel(raw[2], ctx, cfg);
      // Redirect target built from the path only if it is a plain username (no open redirect).
      return block(USERNAME_RE.test(raw[0]) ? '/' + raw[0] + '/' : '/', 'R2-profile', false);
    }

    return result('allow', null, false, 'default', 'other', null);
  }

  // ---------------------------------------------------------------------------
  // Config from the app (window.RF_CONFIG, then {type: "config"} messages): only known keys with
  // valid values are copied into CONFIG; anything else is ignored. Returns the keys that changed.
  // ---------------------------------------------------------------------------
  function mergeConfig(into, from) {
    var changed = [];
    if (!from || typeof from !== 'object') return changed;
    function set(k, v) { if (into[k] !== v) { into[k] = v; changed.push(k); } }
    if (from.feedMode === 'limited' || from.feedMode === 'off') set('feedMode', from.feedMode);
    if (typeof from.feedLimit === 'number' && isFinite(from.feedLimit) && from.feedLimit >= 0 && from.feedLimit <= 1000) {
      set('feedLimit', Math.floor(from.feedLimit));
    }
    if (typeof from.blockExplore === 'boolean') set('blockExplore', from.blockExplore);
    if (typeof from.dmReelTtlMs === 'number' && isFinite(from.dmReelTtlMs) && from.dmReelTtlMs >= 0 && from.dmReelTtlMs <= 60000) {
      set('dmReelTtlMs', Math.floor(from.dmReelTtlMs));
    }
    if (from.feedVariant === 'following' || from.feedVariant === 'default') set('feedVariant', from.feedVariant);
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Node export for unit tests. Nothing below runs outside a browser.
  // ---------------------------------------------------------------------------
  // Avenant 1 (docs/SPEC-iOS.md): App-Bound Domains cover sibling hosts (CDN, YouTube, Google
  // sign-in); this script only acts on instagram.com and its subdomains, and is a no-op elsewhere.
  function hostAllowed(host) {
    return typeof host === 'string' && /(^|\.)instagram\.com$/.test(host.toLowerCase());
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { decide: decide, hostAllowed: hostAllowed, mediaIdFromPath: mediaIdFromPath, feedVariantTarget: feedVariantTarget,
      mergeConfig: mergeConfig, CONFIG: CONFIG, TOKEN_KEY: TOKEN_KEY, VERSION: VERSION };
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!hostAllowed(window.location.hostname)) return;


  // ---------------------------------------------------------------------------
  // Selectors — checked against anonymized captures of the live logged-in site (T17,
  // tests/fixtures/home-feed.html, feed-following.html, explore.html; UI in French).
  // Attribute/role/structure only, never obfuscated classes (X2).
  //  - feed reels link to /reels/<id>/ (plus /p/<id>/ and /reels/audio/<n>/); posts have no <header>;
  //  - suggested posts carry a div[role="button"] "Suivre"; ads link to /ads/ig_redirect/;
  //  - search page: main > nav (input + recent searches), main > div (grid, reels as /p/ tiles).
  // ---------------------------------------------------------------------------
  var SEL = {
    feedPost: 'main article',
    reelLink: 'a[href*="/reel/"], a[href*="/reels/"]:not([href*="/reels/audio/"])',
    adLink: 'a[href^="/ads/"], a[href*="instagram.com/ads/"]',
    loader: '[data-visualcompletion="loading-state"][role="progressbar"]',
    caughtUpImg: 'img[src*="illo-confirm-refresh"]',
    videoPlayer: 'video, [aria-label="Video player"]'
  };
  // Exact-match label of the follow button (FR + EN) on suggested posts. Only buttons are compared
  // (UI chrome), never captions; nothing is stored or copied.
  var FOLLOW_LABELS = ['Suivre', 'Follow'];

  // ---------------------------------------------------------------------------
  // Fail-closed CSS, injected synchronously at document-start.
  // The page is masked until the router has decided the current route is allowed.
  // ---------------------------------------------------------------------------
  // Set in start(): at document-start, WebKit may run us before <html> exists.
  var root = null;

  var NOT_DM = 'html:not([data-rf-mode="dm"]):not([data-rf-mode="dm-reel"])';
  var FEED = 'html[data-rf-mode="feed"]';
  var FEED_OFF = 'html[data-rf-mode="feed-off"]';
  var HIDE = ' { display: none !important; }';

  var CSS = [
    // X3 fail-closed mask: everything hidden until an 'allow' decision.
    'html[data-reelfree="mask"] body' + HIDE,
    'html[data-reelfree="mask"]::after { content: "ReelFree"; position: fixed; inset: 0;',
    '  display: flex; align-items: center; justify-content: center;',
    '  font: 600 18px -apple-system, system-ui, sans-serif; color: #888; background: #fff; z-index: 2147483647; }',

    // D01 (perf): no :has() anywhere. On Instagram's large DOM every mutation re-evaluates :has()
    // rules on iPhone; containers are flagged by JS instead (scanNodes, before the next paint).

    // R1: Reels tab in navigation, on every route (incl. DMs), with its menu item container.
    'a[href="/reels/"]' + HIDE,
    '[data-reelfree-nav]' + HIDE,

    // R1/R4: outside DMs, every link to a reel and the feed post that holds it.
    NOT_DM + ' a[href*="/reel/"], ' + NOT_DM + ' a[href*="/reels/"]' + HIDE,
    NOT_DM + ' ' + SEL.feedPost + '[data-reelfree-reel]' + HIDE,

    // R3 (reel served as /p/<id>): on a post outside DMs, hide video players.
    'html[data-rf-mode="post"] video, html[data-rf-mode="post"] [aria-label="Video player"]' + HIDE,

    // R5: on the search page keep main > nav (input, recent searches, account results); hide the grid.
    'html[data-rf-mode="search"] main > nav ~ *' + HIDE,
    'html[data-rf-mode="search"] main a[href*="/p/"], html[data-rf-mode="search"] main a[href*="/reel"]' + HIDE,
    'html[data-rf-mode="search"] a[href^="/explore/search/keyword"]' + HIDE,

    // S1: feed cap.
    FEED + ' ' + SEL.feedPost + '[data-reelfree-cap]' + HIDE,
    FEED + '[data-rf-capped] main ' + SEL.loader + HIDE,
    FEED + '[data-rf-capped] main::after { content: "Tu es à jour ✓"; display: block;',
    '  padding: 28px 16px 40px; text-align: center; font: 600 16px -apple-system, system-ui, sans-serif; color: #888; }',

    // S2: suggested posts (header label) and everything after Instagram's own "caught up" marker.
    FEED + ' ' + SEL.feedPost + '[data-reelfree-sugg]' + HIDE,
    FEED + ' ' + SEL.feedPost + '[data-reelfree-ad]' + HIDE,
    FEED + ' [data-reelfree-caughtup] ~ *, ' + FEED + '[data-rf-capped] ' + SEL.feedPost + '[data-reelfree-last] ~ *' + HIDE,

    // S3: feedMode 'off' — stories, DMs, profile, notifications stay.
    FEED_OFF + ' ' + SEL.feedPost + ', ' + FEED_OFF + ' main ' + SEL.loader + ', ' +
      FEED_OFF + ' [data-reelfree-caughtup]' + HIDE,
    FEED_OFF + ' main::after { content: "Fil masqué par ReelFree"; display: block; padding: 40px 16px;',
    '  text-align: center; font: 600 16px -apple-system, system-ui, sans-serif; color: #888; }',

    // D4 back button.
    '#reelfree-back { position: fixed; top: max(8px, env(safe-area-inset-top)); left: 8px; z-index: 2147483646;',
    '  padding: 8px 12px; border-radius: 18px; border: 0; background: rgba(0,0,0,.75); color: #fff;',
    '  font: 600 15px -apple-system, system-ui, sans-serif; }',
    'html:not([data-rf-mode="dm-reel"]) #reelfree-back' + HIDE
  ].join('\n');

  function injectStyle(id, text) {
    var style = document.createElement('style');
    style.id = id;
    style.textContent = text;
    (document.head || root).appendChild(style);
    return style;
  }
  var styleEl = null;
  var dynStyleEl = null;   // per-reel rules in dm-reel mode (D3)

  // ---------------------------------------------------------------------------
  // Bridge to the app (docs/SPEC-iOS.md). Present only inside the iOS app.
  // ---------------------------------------------------------------------------
  var BRIDGE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.reelfree);

  function post(msg) {
    if (!BRIDGE) return;
    try { window.webkit.messageHandlers.reelfree.postMessage(msg); } catch (e) { /* app gone: standalone */ }
  }

  // Debug report without user data: where it happened and the error class only.
  function reportError(where, e) {
    post({ type: 'error', where: where, message: String((e && e.name) || 'Error') });
  }

  // ---------------------------------------------------------------------------
  // Session state. DM token: sessionStorage when standalone; in the app the authoritative token is
  // native, so the script keeps its own copy in memory only (CLAUDE.md). Other keys: flags only.
  // ---------------------------------------------------------------------------
  var memToken = null;   // { id, ts } — app mode only

  function readToken() {
    if (BRIDGE) {
      if (memToken && Date.now() - memToken.ts > CONFIG.dmReelTtlMs) memToken = null;
      return memToken;
    }
    try {
      var v = window.sessionStorage.getItem('reelfree:dm-allow');
      if (!v) return null;
      var m = /^([A-Za-z0-9_-]{1,64}):(\d{1,16})$/.exec(v);
      if (!m) { window.sessionStorage.removeItem('reelfree:dm-allow'); return null; }
      var ts = Number(m[2]);
      if (Date.now() - ts > CONFIG.dmReelTtlMs) { window.sessionStorage.removeItem('reelfree:dm-allow'); return null; }
      return { id: m[1], ts: ts };
    } catch (e) {
      return null;
    }
  }

  function writeToken(id) {
    if (BRIDGE) { memToken = { id: id, ts: Date.now() }; return; }
    try { window.sessionStorage.setItem('reelfree:dm-allow', id + ':' + Date.now()); } catch (e) { /* ignore */ }
  }

  // Flags (F6, B05 review): in the app nothing is written to web storage; flags live in this
  // document's memory (lost on a full reload). Standalone: sessionStorage, "reelfree:" keys only.
  // G5: the standalone storage calls take a literal key each (checked by bin/verify); any other
  // key throws, and every caller treats a throw as "no storage".
  var memFlags = Object.create(null);
  function flagGet(key) {
    if (BRIDGE) return Object.prototype.hasOwnProperty.call(memFlags, key) ? memFlags[key] : null;
    if (key === 'reelfree:feed-variant-at') return window.sessionStorage.getItem('reelfree:feed-variant-at');
    if (key === 'reelfree:feed-count') return window.sessionStorage.getItem('reelfree:feed-count');
    if (key === 'reelfree:feed-seen') return window.sessionStorage.getItem('reelfree:feed-seen');
    throw new Error('flag key');
  }
  function flagSet(key, value) {
    if (BRIDGE) { memFlags[key] = value; return; }
    if (key === 'reelfree:feed-variant-at') window.sessionStorage.setItem('reelfree:feed-variant-at', value);
    else if (key === 'reelfree:feed-count') window.sessionStorage.setItem('reelfree:feed-count', value);
    else if (key === 'reelfree:feed-seen') window.sessionStorage.setItem('reelfree:feed-seen', value);
    else throw new Error('flag key');
  }

  var VARIANT_KEY = 'reelfree:feed-variant-at';
  function variantRecentlyTried() {
    try {
      var v = Number(flagGet(VARIANT_KEY) || 0);
      return Date.now() - v < 2000;   // a real loop reloads well within 2 s
    } catch (e) {
      return true;   // no storage: never risk a redirect loop
    }
  }
  function markVariantTried() {
    try { flagSet(VARIANT_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  // S1: feed counters persist for the tab's life (numbers only), so DM <-> feed round trips and
  // reloads never reset the cap (standalone; in the app, for the document's life). Shortcode keys stay in memory.
  var FEED_COUNT_KEY = 'reelfree:feed-count';
  var FEED_SEEN_KEY = 'reelfree:feed-seen';
  function readCount(key) {
    try {
      var v = Number(flagGet(key) || 0);
      return isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    } catch (e) {
      return 0;
    }
  }
  function writeCount(key, n) {
    try { flagSet(key, String(n)); } catch (e) { /* memory value still applies */ }
  }

  function clearToken() {
    memToken = null;
    if (BRIDGE) return;
    try { window.sessionStorage.removeItem('reelfree:dm-allow'); } catch (e) { /* ignore */ }
  }

  // D2: a tap/click on a media inside a thread. Local token (second line) + request to the app.
  function dmReelOpen(id) {
    writeToken(id);
    post({ type: 'dmReelOpen', id: id });
  }

  // In-memory page state (lost on full reload, by design).
  var state = {
    lastPath: null,
    lastThread: null,   // '/direct/t/<id>/' of the most recent conversation
    activeReel: null,   // reel id admitted via D2 on the current page
    prevPath: null,     // path before the current one
    dmTapAt: 0,         // time of the last tap inside a DM thread (in memory only, D2 fallback)
    dmOverlay: false,   // a dialog is open over a DM thread (D3 without URL change)
    feedSeq: 0,         // S1: visible posts numbered in this tab (restored from sessionStorage)
    feedSeen: 0,        // S1: all posts seen (hard cap)
    dmTapId: null,      // D2 fallback: media id under the tapped element
    viaPopstate: false, // current evaluation comes from history traversal
    feedKeys: {},       // shortcode -> feedSeq (memory only)
    feedSeenKeys: {}    // shortcode -> feedSeen (memory only)
  };
  var masked = true;
  var currentMode = 'blocked';

  function policyCtx(token) {
    return {
      now: Date.now(),
      token: token,
      lastThread: state.lastThread,
      activeReel: state.activeReel,
      config: CONFIG
    };
  }

  // ---------------------------------------------------------------------------
  // Mask & attributes.
  // ---------------------------------------------------------------------------
  function pauseMedia(scope) {
    var vids = (scope || document).getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].muted = true; vids[i].pause(); } catch (e) { /* ignore */ }
    }
  }

  function applyAttrs() {
    var want = masked ? 'mask' : 'ok';
    if (root.getAttribute('data-reelfree') !== want) root.setAttribute('data-reelfree', want);
    if (root.getAttribute('data-rf-mode') !== currentMode) root.setAttribute('data-rf-mode', currentMode);
  }

  function setMask(on) {
    masked = on;
    applyAttrs();
    if (on) pauseMedia();
  }

  function isSameOriginPath(to) {
    if (typeof to !== 'string' || to.charAt(0) !== '/') return false;
    try {
      return new URL(to, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // S1/S2: feed cap and suggested posts.
  // ---------------------------------------------------------------------------
  function feedLimit() {
    var n = CONFIG.feedLimit;
    return (typeof n === 'number' && isFinite(n) && n >= 0) ? Math.floor(n) : 15;
  }

  // Leaf elements only (no child elements): a button that wraps a caption is never read.
  function hasLabel(scope, selector, labels) {
    var els = scope.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      if (els[i].children.length !== 0) continue;
      if (labels.indexOf((els[i].textContent || '').trim()) !== -1) return true;
    }
    return false;
  }

  function isSuggested(article) {
    return hasLabel(article, '[role="button"], button', FOLLOW_LABELS);
  }

  function setFlag(el, name, on) {
    if (on) { if (!el.hasAttribute(name)) el.setAttribute(name, ''); }
    else if (el.hasAttribute(name)) el.removeAttribute(name);
  }

  // The feed is virtualized (Instagram unmounts off-screen posts and remounts them on scroll back),
  // so posts are numbered by shortcode (in memory only) and the cap survives remounts.
  // Hidden posts (reels, ads, suggestions) do not count toward the cap, but every post seen counts
  // toward a hard cap so pagination cannot run forever behind a wall of hidden posts.
  function postKey(article) {
    var link = article.querySelector('a[href^="/p/"]');
    return link ? mediaIdFromPath(link.getAttribute('href')) : null;
  }

  function seqFor(article, store, counted) {
    var key = postKey(article);
    if (key && Object.prototype.hasOwnProperty.call(store, key)) return store[key];
    var attr = article.getAttribute(counted ? 'data-reelfree-seq' : 'data-reelfree-seen');
    if (attr !== null) return Number(attr);
    var n;
    if (counted) { n = ++state.feedSeq; writeCount(FEED_COUNT_KEY, n); }
    else { n = ++state.feedSeen; writeCount(FEED_SEEN_KEY, n); }
    if (key) store[key] = n;
    article.setAttribute(counted ? 'data-reelfree-seq' : 'data-reelfree-seen', String(n));
    return n;
  }

  // Flags one post: reel and ad on every route (CSS gates them by mode), cap and suggestions in the
  // feed only. Idempotent: sequence numbers are kept on the element and by shortcode.
  function scanArticle(a, feed, limit) {
    var reel = !!a.querySelector(SEL.reelLink);
    var ad = !!a.querySelector(SEL.adLink);
    setFlag(a, 'data-reelfree-reel', reel);
    setFlag(a, 'data-reelfree-ad', ad);
    if (!feed) return;
    var sugg = !reel && !ad && isSuggested(a);
    setFlag(a, 'data-reelfree-sugg', sugg);
    var counts = !reel && !ad && !sugg;
    seqFor(a, state.feedSeenKeys, false);   // every post, for the hard cap
    var n = counts ? seqFor(a, state.feedKeys, true) : -1;
    setFlag(a, 'data-reelfree-cap', counts ? n > limit : state.feedSeq >= limit);
    setFlag(a, 'data-reelfree-last', counts && n === limit);
  }

  // R1: menu item / list item that wraps the Reels tab (replaces a :has() rule).
  function scanNav(a) {
    var p = a.parentElement;
    if (!p || !(p.tagName === 'LI' || (p.tagName === 'DIV' && p.getAttribute('role') === 'menuitem'))) return;
    setFlag(p, 'data-reelfree-nav', !!p.querySelector(':scope > a[href="/reels/"]'));
  }

  function scanNavParent(p) {
    if (p.hasAttribute('data-reelfree-nav')) setFlag(p, 'data-reelfree-nav', !!p.querySelector(':scope > a[href="/reels/"]'));
  }

  function byDocOrder(x, y) {
    return x === y ? 0 : (x.compareDocumentPosition(y) & 4 ? -1 : 1);   // 4 = DOCUMENT_POSITION_FOLLOWING
  }

  // D01: work on the given subtrees only (added nodes, changed links), never a global re-scan in
  // the mutation path. scanNodes([root]) is the full pass, run on route or config change only.
  // ups: parents of removed nodes; only the post above them is re-checked (never their subtree).
  function scanNodes(nodes, ups) {
    var feed = currentMode === 'feed';
    var arts = [];
    var i, j, n, list;
    for (i = 0; ups && i < ups.length; i++) {
      n = ups[i];
      if (!n.isConnected) continue;
      scanNavParent(n);
      n = n.closest('article');
      if (n) arts.push(n);
    }
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (!n || n.nodeType !== 1 || !n.isConnected) continue;
      var up = n.closest('article');
      if (up) arts.push(up);
      list = n.getElementsByTagName('article');
      for (j = 0; j < list.length; j++) arts.push(list[j]);
      if (n.tagName === 'A' && n.getAttribute('href') === '/reels/') scanNav(n);
      else if (n.tagName === 'A' && n.parentElement && n.parentElement.hasAttribute('data-reelfree-nav')) scanNav(n);
      list = n.querySelectorAll('a[href="/reels/"]');
      for (j = 0; j < list.length; j++) scanNav(list[j]);
      var img = n.matches(SEL.caughtUpImg) ? n : n.querySelector(SEL.caughtUpImg);
      if (img && img.parentElement && img.closest('main')) setFlag(img.parentElement, 'data-reelfree-caughtup', true);
    }
    if (arts.length > 1) arts.sort(byDocOrder);   // feed numbering follows document order
    var limit = feedLimit();
    var prev = null;
    for (i = 0; i < arts.length; i++) {
      if (arts[i] === prev) continue;
      prev = arts[i];
      if (prev.closest('main')) scanArticle(prev, feed, limit);
    }
    if (feed) setFlag(root, 'data-rf-capped', state.feedSeq >= limit || state.feedSeen >= limit * 3);
  }

  // ---------------------------------------------------------------------------
  // D3/D4: reel opened from a DM.
  // ---------------------------------------------------------------------------
  function updateDynStyle() {
    var id = currentMode === 'dm-reel' ? state.activeReel : null;
    var text = '';
    if (id && REEL_ID_RE.test(id)) {   // id is [A-Za-z0-9_-] only: safe inside a CSS string
      var not = ':not([href*="/' + id + '/"]):not([href*="/' + id + '?"]):not([href$="/' + id + '"])';
      var d = 'html[data-rf-mode="dm-reel"] ';
      text = [d + 'a[href*="/reel/"]' + not, d + 'a[href*="/reels/"]' + not,
        d + '[role="dialog"] a[href*="/p/"]' + not].join(', ') + HIDE;
    }
    if (!dynStyleEl || !dynStyleEl.isConnected) dynStyleEl = injectStyle('reelfree-dyn', text);
    else if (dynStyleEl.textContent !== text) dynStyleEl.textContent = text;
  }

  function backTarget() {
    return (state.lastThread && THREAD_RE.test(state.lastThread)) ? state.lastThread : '/direct/inbox/';
  }

  function ensureBackButton() {
    var btn = document.getElementById('reelfree-back');
    if (currentMode !== 'dm-reel') {
      if (btn) btn.remove();
      return;
    }
    if (btn || !document.body) return;
    btn = document.createElement('button');
    btn.id = 'reelfree-back';
    btn.type = 'button';
    btn.textContent = '← Retour à la conversation';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      window.location.assign(backTarget());
    }, true);
    document.body.appendChild(btn);
  }

  var SCROLL_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Spacebar', 'Home', 'End', 'j', 'k'];

  function isEditable(el) {
    return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }

  function reelLockActive() {
    return currentMode === 'dm-reel' || (currentMode === 'dm' && state.dmOverlay);
  }

  var touchStart = null;
  function onTouchStart(ev) {
    var t = ev.touches && ev.touches[0];
    touchStart = t ? { x: t.clientX, y: t.clientY } : null;
  }

  // D3: block vertical swipe/scroll only; horizontal carousels and the video scrubber keep working.
  function blockScroll(ev) {
    if (!reelLockActive()) return;
    if (ev.target && ev.target.id === 'reelfree-back') return;
    if (ev.type === 'keydown') {
      if (SCROLL_KEYS.indexOf(ev.key) === -1 || isEditable(ev.target)) return;
    } else if (ev.type === 'wheel') {
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
    } else if (ev.type === 'touchmove') {
      var t = ev.touches && ev.touches[0];
      if (t && touchStart && Math.abs(t.clientY - touchStart.y) <= Math.abs(t.clientX - touchStart.x)) return;
    }
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  }

  // Remembers which media a tap in a thread points at (a link around or inside the tapped element).
  function onDmTap(ev) {
    var t = ev.target;
    if (!t || !t.closest || isEditable(t)) return;   // typing in the composer never opens a reel
    if (!THREAD_RE.test(window.location.pathname)) return;
    if (t.closest('[role="dialog"]')) return;        // D3: never from inside an overlay
    var a = t.closest('a[href]') || (t.querySelector && t.querySelector('a[href]'));
    var id = a ? mediaIdFromPath(a.getAttribute('href')) : null;
    if (!id) return;
    state.dmTapAt = Date.now();
    state.dmTapId = id;
    // The real thread shares media without an href (React handler): the app's token comes from here.
    post({ type: 'dmReelOpen', id: id });
  }

  function onPopstate() {
    state.viaPopstate = true;
    try { checkRoute(); } finally { state.viaPopstate = false; }
  }

  // ---------------------------------------------------------------------------
  // Click capture: D2 token from DMs, R5 Explore → search, and pre-emptive blocking
  // of forbidden navigations (no flash, no SPA transition).
  // ---------------------------------------------------------------------------
  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.id === 'reelfree-back') return;
    var a = t.closest('a[href]');
    if (!a) return;
    var url;
    try { url = new URL(a.href, window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return;
    var target = url.pathname;

    // D2: one-shot token, only for a click that starts in /direct/.
    if (currentMode === 'dm' && /^\/direct\//.test(window.location.pathname)) {
      var id = mediaIdFromPath(target);
      if (id && a.closest('[role="dialog"]')) {
        // D3: no token from inside an overlay (photo or video): that would be chaining.
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      if (id) { dmReelOpen(id); return; }
    }

    // R5: the Explore tab leads to account search instead of the grid.
    if (CONFIG.blockExplore && /^\/explore\/?$/i.test(target)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.location.assign('/explore/search/');
      return;
    }

    var d;
    try { d = decide(target, policyCtx(null)); } catch (e) { d = hide('X3-error'); }
    if (d.action !== 'allow') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }

  // ---------------------------------------------------------------------------
  // Router (X1): history hooks + popstate + polling fallback.
  // ---------------------------------------------------------------------------
  function evaluate() {
    var path = window.location.pathname;
    var d;
    var token = readToken();
    // History traversal (Back/Forward, bfcache) never admits a media: a pending token is spent.
    if (state.viaPopstate && token) { clearToken(); token = null; }
    // D2 fallback: the tapped element was not an <a> (React handler). A navigation straight from a
    // thread to a media route within the TTL of a tap inside that thread gets a one-shot token.
    // Only for the very media that was tapped, never on history traversal (Back/Forward).
    if (!token && !state.viaPopstate && state.dmTapAt && state.dmTapId && state.prevPath &&
        THREAD_RE.test(state.prevPath) &&
        Date.now() - state.dmTapAt <= Math.min(DM_TAP_WINDOW_MS, CONFIG.dmReelTtlMs) &&
        mediaIdFromPath(path) === state.dmTapId) {
      token = { id: state.dmTapId, ts: state.dmTapAt };
    }
    state.dmTapAt = 0;
    state.dmTapId = null;
    try {
      d = decide(path, policyCtx(token));
    } catch (e) {
      reportError('decide', e);
      d = hide('X3-error');
    }

    if (d.consumeToken) clearToken();
    state.activeReel = d.reelId;
    currentMode = d.mode;

    // S2: prefer the "following" feed. Loop guard: a sessionStorage flag (timestamp only).
    if (d.action === 'allow' && d.mode === 'feed') {
      var variantTo = feedVariantTarget(window.location.search, CONFIG);
      if (variantTo && !variantRecentlyTried()) {
        markVariantTried();
        setMask(true);
        window.location.replace(variantTo);
        return;
      }
    }

    if (d.action === 'allow') {
      if (THREAD_RE.test(path)) state.lastThread = path;
      try {
        onRouteAllowed();   // protections (D3, feed cap) must be in place before unmasking
      } catch (e) {
        reportError('onRouteAllowed', e);
        setMask(true);
        return;
      }
      setMask(false);
      return;
    }

    setMask(true);
    if (d.action === 'redirect' && d.to !== path && isSameOriginPath(d.to)) {
      window.location.replace(d.to);
    }
  }

  function checkRoute() {
    var path = window.location.pathname;
    if (path === state.lastPath) return;
    state.prevPath = state.lastPath;
    state.lastPath = path;
    // Avenant 2: history traversal is flagged so the app drops its DM token too.
    post(state.viaPopstate ? { type: 'route', path: path, via: 'popstate' } : { type: 'route', path: path });
    evaluate();
  }

  // Native -> JS (docs/SPEC-iOS.md): window.reelfree.onNative(msg). Unknown or malformed messages
  // are ignored. Only defined inside the app, so a page cannot reach it in standalone mode.
  function onNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    try {
      if (msg.type === 'config') {
        if (!mergeConfig(CONFIG, msg.config).length) return;
        state.lastPath = null;   // re-decide the current route with the new settings
        checkRoute();
      } else if (msg.type === 'route') {
        // Avenant 4: the app pushes every URL change (KVO), so the app needs no polling. The path
        // is only a hint: the decision always reads window.location.
        if (typeof msg.path !== 'string') return;
        if (msg.via === 'popstate') onPopstate();
        else checkRoute();
      } else if (msg.type === 'dmReelDenied') {
        // Fail closed: the app refused this reel, drop any local permission for it.
        if (typeof msg.id === 'string' && memToken && memToken.id === msg.id) clearToken();
        if (state.dmTapId === msg.id) { state.dmTapAt = 0; state.dmTapId = null; }
      }
      // dmReelGranted: nothing to do, the local token was set on the tap/click itself.
    } catch (e) {
      reportError('onNative', e);
    }
  }

  function hookHistory(name) {
    // Note: under the Userscripts app's default content-world injection, this wraps the
    // isolated-world history object; the page's own calls bypass it. Standalone: polling covers that;
    // app: onNative {type: "route"} (Avenant 4) plus the mutation pass.
    try {
      var orig = window.history[name];
      if (typeof orig !== 'function') return;
      window.history[name] = function () {
        var ret = orig.apply(this, arguments);
        checkRoute();
        return ret;
      };
    } catch (e) { /* ignore: polling fallback */ }
  }

  // Route-level state: cheap, no DOM-wide query (dmOverlay looks up one dialog, in DMs only).
  function routeChrome() {
    applyAttrs();
    updateDynStyle();
    ensureBackButton();
    state.dmOverlay = currentMode === 'dm' && !!document.querySelector('[role="dialog"]');
    if (currentMode !== 'feed') setFlag(root, 'data-rf-capped', false);
    if (currentMode === 'post') pauseMedia();   // display:none does not always silence iOS
  }

  // Full pass, on a new route (or new settings) only.
  function onRouteAllowed() {
    routeChrome();
    scanNodes([root]);
  }

  function onMutations(nodes, ups) {
    applyAttrs();   // the page may have rewritten <html> attributes
    if (!styleEl.isConnected) styleEl = injectStyle('reelfree-style', CSS);
    var before = state.lastPath;
    checkRoute();   // also a route fallback in the app, where the page's pushState is not hooked
    if (masked) { pauseMedia(); return; }
    if (state.lastPath !== before) return;   // the new route already ran a full pass
    try {
      routeChrome();
      scanNodes(nodes, ups);
    } catch (e) {
      setMask(true);
    }
  }

  // Single MutationObserver (X4), batched once per frame (D01): added nodes and changed links are
  // queued, then scanned in requestAnimationFrame, i.e. before the next paint. No timer while the
  // DOM is still. Past MO_MAX_QUEUE nodes the batch becomes a full pass.
  var MO_MAX_QUEUE = 2000;
  var MO_FALLBACK_MS = 100;
  var moQueue = [];
  var moUp = [];   // parents of removed nodes: only their containers (ancestors) are re-checked
  var moFull = false;
  var moScheduled = false;
  var moTimer = 0;
  // Hiding flags set by this script (G2): the page stripping one from a recycled node re-checks it.
  var MO_FLAGS = ['data-reelfree-reel', 'data-reelfree-ad', 'data-reelfree-sugg', 'data-reelfree-cap',
    'data-reelfree-last', 'data-reelfree-nav', 'data-reelfree-caughtup'];
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
    // Fallback: rAF is suspended while a navigation is pending or the WebView is hidden, and the
    // fail-closed guards (style restore, mask) must still run. One-shot, cleared by the frame.
    moTimer = window.setTimeout(flushMutations, MO_FALLBACK_MS);
  });

  // --- Boot ------------------------------------------------------------------
  function start() {
    root = document.documentElement;
    if (BRIDGE) {
      try { mergeConfig(CONFIG, window.RF_CONFIG); } catch (e) { reportError('config', e); }
      try {
        Object.defineProperty(window, 'reelfree', {
          value: Object.freeze({ onNative: onNative, version: VERSION }), writable: false, configurable: false
        });
      } catch (e) { reportError('bridge', e); }
    }
    root.setAttribute('data-reelfree', 'mask');
    root.setAttribute('data-rf-mode', 'blocked');
    styleEl = injectStyle('reelfree-style', CSS);
    state.feedSeq = readCount(FEED_COUNT_KEY);
    state.feedSeen = readCount(FEED_SEEN_KEY);
    checkRoute();
    hookHistory('pushState');
    hookHistory('replaceState');
    window.addEventListener('popstate', onPopstate, true);
    // bfcache: a page restored by Back is re-evaluated from scratch, without any admitted reel.
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      state.lastPath = null;
      state.activeReel = null;
      state.viaPopstate = true;
      try { checkRoute(); } finally { state.viaPopstate = false; }
    });
    window.addEventListener('click', onClick, true);
    window.addEventListener('wheel', blockScroll, { capture: true, passive: false });
    window.addEventListener('touchmove', blockScroll, { capture: true, passive: false });
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.addEventListener('pointerdown', onDmTap, true);
    window.addEventListener('keydown', blockScroll, true);
    // Standalone (Userscripts app) only: in the app, routes come from onNative {type: "route"}.
    if (!BRIDGE) window.setInterval(checkRoute, POLL_MS);
    // href: React recycles nodes and rewrites links in place.
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'].concat(MO_FLAGS) });
    // Separate, synchronous guard on our own <html> attributes: restore immediately if the page strips them.
    new MutationObserver(applyAttrs).observe(root, { attributes: true, attributeFilter: ['data-reelfree', 'data-rf-mode'] });
    post({ type: 'ready', script: 'instagram', version: VERSION });
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
