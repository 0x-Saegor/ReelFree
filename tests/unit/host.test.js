'use strict';
// Avenant 1 (docs/SPEC-iOS.md): each injected script acts only on its own host family.

const test = require('node:test');
const assert = require('node:assert/strict');
const ig = require('../../web/instagram.js');
const yt = require('../../web/youtube.js');

const IG_OK = ['instagram.com', 'www.instagram.com', 'WWW.INSTAGRAM.COM', 'help.instagram.com'];
const YT_OK = ['youtube.com', 'm.youtube.com', 'www.youtube.com', 'M.YouTube.com'];
const OTHERS = ['', 'cdninstagram.com', 'scontent.cdninstagram.com', 'evilinstagram.com', 'instagram.com.evil.example',
  'fbcdn.net', 'accounts.google.com', 'www.gstatic.com', 'i.ytimg.com', 'rr1.googlevideo.com', 'evilyoutube.com',
  'youtube.com.evil.example', 'instagram.com.', 'localhost', null, undefined, 42];

for (const h of IG_OK) test(`instagram.js active on ${h}`, () => assert.equal(ig.hostAllowed(h), true));
for (const h of YT_OK) test(`youtube.js active on ${h}`, () => assert.equal(yt.hostAllowed(h), true));
for (const h of [...OTHERS, ...YT_OK]) test(`instagram.js no-op on ${JSON.stringify(h)}`, () => assert.equal(ig.hostAllowed(h), false));
for (const h of [...OTHERS, ...IG_OK]) test(`youtube.js no-op on ${JSON.stringify(h)}`, () => assert.equal(yt.hostAllowed(h), false));
