/*
 * ReelFree YouTube ads — strips ad data from player responses before the player reads them.
 *
 * Injected by the iOS app at document-start, main frame only, in WKContentWorld.page: the ONLY
 * ReelFree script in the page world (docs/SPEC-iOS.md, Avenant 5), because the player data lives
 * there. In exchange it is deliberately powerless:
 *  - no bridge: it never touches window.webkit, and no message handler exists in .page;
 *  - no network: it only filters responses the page itself requested (fetch, XHR via JSON.parse);
 *  - no user data: it deletes ad keys at fixed paths, never reads, stores or copies other values;
 *  - no globals, no storage, no dynamic code, no HTML sinks; a no-op outside *.youtube.com.
 * The page can see and undo it: it only affects ads, never a ReelFree protection (those live in
 * youtube.js, isolated world). Every failure falls back to the untouched value.
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  var PLAYER_PATH_RE = /^\/youtubei\/v1\/player(?:\/|$)/;

  // Deletes AD_KEYS on a player response and on the player response nested in /next or /browse
  // style payloads (obj.playerResponse, and arrays of those). Fixed paths only, no deep walk.
  // Returns true when something was removed.
  function pruneOne(o) {
    if (!o || typeof o !== 'object') return false;
    var hit = false;
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(o, AD_KEYS[i])) {
        try { delete o[AD_KEYS[i]]; hit = true; } catch (e) { /* frozen: leave it */ }
      }
    }
    return hit;
  }

  function prune(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) {
      var any = false;
      for (var i = 0; i < obj.length && i < 16; i++) any = prune(obj[i]) || any;
      return any;
    }
    var hit = pruneOne(obj);
    if (obj.playerResponse && typeof obj.playerResponse === 'object') hit = pruneOne(obj.playerResponse) || hit;
    return hit;
  }

  function hostAllowed(host) {
    return typeof host === 'string' && /(^|\.)youtube\.com$/.test(host.toLowerCase());
  }

  function isPlayerUrl(u) {
    try {
      var url = new URL(typeof u === 'string' ? u : (u && u.url) || String(u), window.location.href);
      return hostAllowed(url.hostname) && PLAYER_PATH_RE.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { prune: prune, hostAllowed: hostAllowed, AD_KEYS: AD_KEYS, VERSION: VERSION };
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!hostAllowed(window.location.hostname)) return;

  // 1. Initial player response, assigned by an inline script (var ytInitialPlayerResponse = {...}).
  //    An accessor installed first receives the assignment and prunes it.
  function trapGlobal(name) {
    try {
      var d = Object.getOwnPropertyDescriptor(window, name);
      if (d && !d.configurable) return;
      var value = d && 'value' in d ? d.value : undefined;
      if (value) prune(value);
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return value; },
        set: function (v) {
          try { prune(v); } catch (e) { /* keep v as is */ }
          value = v;
        }
      });
    } catch (e) { /* leave the page alone */ }
  }
  trapGlobal('ytInitialPlayerResponse');

  // 2. /youtubei/v1/player over fetch: the JSON body is rewritten without the ad keys.
  var origFetch = window.fetch;
  if (typeof origFetch === 'function' && typeof window.Response === 'function') {
    var wrapped = function (input, init) {
      var p = origFetch.apply(this, arguments);
      if (!isPlayerUrl(input)) return p;
      return p.then(function (res) {
        try {
          if (!res || !res.ok) return res;
          return res.clone().json().then(function (data) {
            if (!prune(data)) return res;
            return new window.Response(JSON.stringify(data), {
              status: res.status, statusText: res.statusText, headers: res.headers
            });
          }, function () { return res; });
        } catch (e) {
          return res;
        }
      });
    };
    try { window.fetch = wrapped; } catch (e) { /* ignore */ }
  }

  // 3. Same data over XHR (and any other path): JSON.parse results that look like a player
  //    response (top-level ad key next to playabilityStatus or videoDetails) are pruned.
  var origParse = JSON.parse;
  try {
    JSON.parse = function () {
      var out = origParse.apply(this, arguments);
      try {
        if (out && typeof out === 'object' &&
            (out.playabilityStatus || out.videoDetails || out.playerResponse)) prune(out);
      } catch (e) { /* keep out */ }
      return out;
    };
  } catch (e) { /* ignore */ }
})();
