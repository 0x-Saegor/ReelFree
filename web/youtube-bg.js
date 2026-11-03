/*
 * ReelFree YouTube background — keeps the player playing when the app leaves the screen.
 *
 * m.youtube.com pauses the video as soon as the page reports itself hidden (background play is a
 * Premium feature). This script makes the page always look visible to the player:
 *  - the hidden / visibilityState getters (and webkit-prefixed variants) read as visible;
 *  - visibilitychange events are stopped before any page listener sees them.
 * The native side (WebTab D08) resumes the <video> that WebKit itself pauses on backgrounding.
 *
 * Injected by the iOS app at document-start, main frame only, in WKContentWorld.page (second and
 * last page-world exception, docs/SECURITY.md 5 ter), only when "Lecture en arrière-plan" is on.
 * Deliberately powerless: no bridge, no network, no DOM reads, no storage, no timers, no globals;
 * it only redefines four read-only getters and adds two capture listeners. No-op outside *.youtube.com.
 */
(function () {
  'use strict';

  function hostAllowed(h) { return /(^|\.)youtube\.com$/.test(h); }
  if (!hostAllowed(window.location.hostname)) return;

  var DOC = Document.prototype;
  function visible() { return 'visible'; }
  function notHidden() { return false; }

  try { Object.defineProperty(DOC, 'hidden', { configurable: true, get: notHidden }); } catch (e) { /* keep native */ }
  try { Object.defineProperty(DOC, 'visibilityState', { configurable: true, get: visible }); } catch (e) { /* keep native */ }
  try { Object.defineProperty(DOC, 'webkitHidden', { configurable: true, get: notHidden }); } catch (e) { /* keep native */ }
  try { Object.defineProperty(DOC, 'webkitVisibilityState', { configurable: true, get: visible }); } catch (e) { /* keep native */ }

  function stop(e) { e.stopImmediatePropagation(); }
  window.addEventListener('visibilitychange', stop, true);
  window.addEventListener('webkitvisibilitychange', stop, true);
})();
