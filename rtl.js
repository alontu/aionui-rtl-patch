/* aionui-rtl-patch v9 — content-driven bidi with JS-enforced direction.
   v7's `direction: revert !important` lost to AionUi's author CSS rule(s) for
   blockquote/ul/ol. v8 sidesteps the CSS specificity war by computing
   direction in JS (first-strong-char per Unicode bidi) and applying it as an
   inline style with !important via setProperty. Inline-!important beats any
   stylesheet author rule.
   Console helpers: aionuiRtl.disable() / .enable() / .reapply() / .debug()
   Per-tab disable: append ?nortl=1 to URL. */
(function () {
  'use strict';
  if (location.search.indexOf('nortl=1') !== -1) { console.info('[aionui-rtl] disabled via ?nortl=1'); return; }
  try { if (localStorage.getItem('aionui-rtl-disabled') === '1') { console.info('[aionui-rtl] disabled via localStorage'); return; } } catch (e) {}

  var HEBREW       = /[֐-׿]/;
  // Strong RTL characters: Hebrew, Arabic, Syriac, Thaana, NKo, etc.
  var STRONG_RTL_RE = /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-߿ࠀ-࠿יִ-﷿ﹰ-﻿]/;
  // Strong LTR characters: ASCII letters, Latin Extended, Greek, Cyrillic.
  var STRONG_LTR_RE = /[A-Za-zÀ-ÿĀ-ʯͰ-ϿЀ-ӿ]/;
  var SKIP_TAGS = /^(?:HTML|HEAD|BODY|SCRIPT|STYLE|META|LINK|NOSCRIPT|TEMPLATE|TITLE|SVG|PATH)$/;
  var INPUT_SELECTOR = 'textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]';

  var SHADOW_CSS =
    '[data-aionui-rtl]{text-align:start !important;unicode-bidi:plaintext;}' +
    '[data-aionui-rtl]{font-family:"Heebo",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}' +
    '[data-aionui-rtl] pre,[data-aionui-rtl] code,[data-aionui-rtl] kbd,[data-aionui-rtl] samp{' +
      'font-family:ui-monospace,"JetBrains Mono","Cascadia Mono",Menlo,Consolas,monospace;}' +
    '[data-aionui-rtl] ul[dir="auto"],[data-aionui-rtl] ol[dir="auto"]{padding-inline-start:1.6em;}' +
    /* Quotes: zero physical left/right border+padding, re-add as logical
       inline-start so the quote bar auto-flips to the right for RTL content. */
    'blockquote[data-aionui-rtl]{' +
      'border-left-width:0 !important;border-right-width:0 !important;' +
      'padding-left:0 !important;padding-right:0 !important;' +
      'border-inline-start:0.25em solid currentColor !important;' +
      'padding-inline-start:1em !important;' +
    '}';

  var sharedSheet = null;
  try {
    if (typeof CSSStyleSheet !== 'undefined' && CSSStyleSheet.prototype.replaceSync) {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(SHADOW_CSS);
    }
  } catch (e) { sharedSheet = null; }

  var stats = { walks: 0, marked: 0, shadowsTreated: 0, shadowsObserved: 0, reapplies: 0,
                dirSetRTL: 0, dirSetLTR: 0 };
  var observedShadows = new WeakSet();
  var styledShadows = new WeakSet();

  // Dominant-direction detection: count strong RTL vs strong LTR chars and pick
  // the majority. Replaces first-strong-character (HTML5 dir=auto) so that
  // Hebrew sentences that happen to start with an English term ("AI is טוב for
  // עבודה") correctly resolve to RTL — first-strong-char would have picked LTR
  // and rendered the Hebrew runs in visually-reversed order inside an LTR line.
  function detectDominantDir(text) {
    if (!text) return null;
    var rtl = 0, ltr = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (STRONG_RTL_RE.test(ch)) rtl++;
      else if (STRONG_LTR_RE.test(ch)) ltr++;
    }
    if (rtl === 0 && ltr === 0) return null;
    return rtl > ltr ? 'rtl' : 'ltr';
  }

  function isBlockLike(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.test(el.tagName)) return false;
    var d;
    try { d = getComputedStyle(el).display; } catch (e) { return false; }
    if (!d || d === 'none' || d === 'contents') return false;
    return d.indexOf('inline') === -1;
  }

  function findBlockAncestor(el) {
    while (el && el.nodeType === 1 && !isBlockLike(el)) el = el.parentElement;
    return el;
  }

  function forceDirection(el) {
    // Compute desired direction from first strong char in textContent and
    // set it as inline !important so it beats any author CSS rule.
    if (!el || el.nodeType !== 1) return;
    var dir = detectDominantDir(el.textContent || '');
    if (!dir) return;
    try {
      el.style.setProperty('direction', dir, 'important');
      if (dir === 'rtl') stats.dirSetRTL++; else stats.dirSetLTR++;
    } catch (e) {}
  }

  function markBlock(block) {
    if (!block || block.nodeType !== 1) return;
    if (block.getAttribute('dir') && block.getAttribute('dir') !== 'auto') return;
    if (block.hasAttribute('data-aionui-rtl')) return;
    block.setAttribute('dir', 'auto');
    block.setAttribute('data-aionui-rtl', '1');
    forceDirection(block);
    stats.marked++;
    // List items: also mark + force-direction the parent <ul>/<ol> so
    // bullets/numbers flip to the start side.
    if (block.tagName === 'LI') {
      var parent = block.parentElement;
      if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL') && !parent.hasAttribute('data-aionui-rtl')) {
        parent.setAttribute('dir', 'auto');
        parent.setAttribute('data-aionui-rtl', '1');
        forceDirection(parent);
        stats.marked++;
      }
    }
    // Blockquote: walk ancestors looking for the nearest enclosing
    // <blockquote> and mark it too (so the quote bar can flip side).
    var anc = block.parentElement;
    while (anc && anc.nodeType === 1 && !SKIP_TAGS.test(anc.tagName)) {
      if (anc.tagName === 'BLOCKQUOTE') {
        if (!anc.hasAttribute('data-aionui-rtl')) {
          anc.setAttribute('dir', 'auto');
          anc.setAttribute('data-aionui-rtl', '1');
          forceDirection(anc);
          stats.marked++;
        }
        break;
      }
      anc = anc.parentElement;
    }
  }

  function markInputsIn(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches(INPUT_SELECTOR) && !root.hasAttribute('dir')) {
      root.setAttribute('dir', 'auto');
    }
    if (root.querySelectorAll) {
      var inputs = root.querySelectorAll(INPUT_SELECTOR);
      for (var i = 0; i < inputs.length; i++) {
        if (!inputs[i].hasAttribute('dir')) inputs[i].setAttribute('dir', 'auto');
      }
    }
  }

  function styleShadowRoot(shadowRoot) {
    if (!shadowRoot || styledShadows.has(shadowRoot)) return;
    try {
      if (sharedSheet && 'adoptedStyleSheets' in shadowRoot) {
        var existing = shadowRoot.adoptedStyleSheets || [];
        if (existing.indexOf(sharedSheet) === -1) {
          shadowRoot.adoptedStyleSheets = existing.concat(sharedSheet);
        }
        styledShadows.add(shadowRoot);
        return;
      }
    } catch (e) {}
    try {
      var style = document.createElement('style');
      style.setAttribute('data-aionui-rtl-style', '1');
      style.textContent = SHADOW_CSS;
      shadowRoot.appendChild(style);
      styledShadows.add(shadowRoot);
    } catch (e) {}
  }

  function treatShadowRoot(shadowRoot) {
    if (!shadowRoot) return;
    styleShadowRoot(shadowRoot);
    walkRoot(shadowRoot);
    observeRoot(shadowRoot);
    stats.shadowsTreated++;
  }

  function discoverShadowsIn(root) {
    if (!root || !root.querySelectorAll) return;
    var all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) treatShadowRoot(all[i].shadowRoot);
    }
  }

  function walkRoot(root) {
    if (!root) return;
    markInputsIn(root);
    stats.walks++;
    var walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || !HEBREW.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
          var p = n.parentElement;
          if (!p || SKIP_TAGS.test(p.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
    } catch (e) { return; }
    var tn;
    while ((tn = walker.nextNode())) markBlock(findBlockAncestor(tn.parentElement));
    discoverShadowsIn(root);
  }

  function processAdded(n) {
    if (!n) return;
    if (n.nodeType === 1) {
      walkRoot(n);
      if (n.shadowRoot) treatShadowRoot(n.shadowRoot);
    } else if (n.nodeType === 3 && HEBREW.test(n.nodeValue || '')) {
      markBlock(findBlockAncestor(n.parentElement));
    }
  }

  function observeRoot(root) {
    if (!root || observedShadows.has(root)) return;
    observedShadows.add(root);
    var obs = new MutationObserver(function (muts) {
      var before = stats.marked;
      if (!('adoptedStyleSheets' in root) || root.adoptedStyleSheets.length === 0) {
        if (!root.querySelector || !root.querySelector('style[data-aionui-rtl-style]')) {
          styledShadows.delete(root);
          styleShadowRoot(root);
        }
      }
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) processAdded(m.addedNodes[j]);
        if (m.type === 'characterData') {
          var t = m.target;
          if (t && HEBREW.test(t.nodeValue || '')) markBlock(findBlockAncestor(t.parentElement));
        }
      }
      if (stats.marked > before) {
        console.debug('[aionui-rtl] +' + (stats.marked - before) + ' marked (total=' + stats.marked + ')');
      }
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    stats.shadowsObserved++;
  }

  function drainPreCapturedQueue() {
    var q = window.__aionuiShadowQueue;
    if (!q || !q.length) return;
    while (q.length) {
      try { treatShadowRoot(q.shift()); } catch (e) {}
    }
    window.__aionuiShadowQueue = {
      push: function (sr) { try { treatShadowRoot(sr); } catch (e) {} return 1; },
      length: 0
    };
  }

  function start() {
    console.info('[aionui-rtl] v9 loaded — majority-RTL detection, walking');
    drainPreCapturedQueue();
    var root = document.body || document.documentElement;
    walkRoot(root);
    observeRoot(root);
    console.info('[aionui-rtl] initial — marked', stats.marked,
                 'rtl-forced:', stats.dirSetRTL,
                 'ltr-forced:', stats.dirSetLTR,
                 'shadowsTreated:', stats.shadowsTreated);
  }

  window.aionuiRtl = {
    disable: function () { try { localStorage.setItem('aionui-rtl-disabled', '1'); location.reload(); } catch (e) {} },
    enable:  function () { try { localStorage.removeItem('aionui-rtl-disabled'); location.reload(); } catch (e) {} },
    reapply: function () {
      stats.reapplies++;
      Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function (e) {
        if (e.shadowRoot) {
          styledShadows.delete(e.shadowRoot);
          styleShadowRoot(e.shadowRoot);
          walkRoot(e.shadowRoot);
        }
      });
      walkRoot(document.body);
      console.info('[aionui-rtl] reapplied — total marked now', stats.marked,
                   'rtl-forced:', stats.dirSetRTL);
    },
    debug: function () {
      var lightMarked = document.querySelectorAll('[data-aionui-rtl]').length;
      var shadowHosts = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (e) { return e.shadowRoot; });
      var shadowMarked = 0;
      shadowHosts.forEach(function (h) { shadowMarked += h.shadowRoot.querySelectorAll('[data-aionui-rtl]').length; });
      var info = {
        stats: stats,
        lightMarked: lightMarked,
        shadowHostCount: shadowHosts.length,
        shadowMarkedTotal: shadowMarked,
        adoptedStyleSheetsAvailable: !!sharedSheet,
        shadowHosts: shadowHosts.slice(0, 5).map(function (h) {
          var sr = h.shadowRoot;
          return {
            tag: h.tagName,
            cls: (h.className && h.className.toString ? h.className.toString() : '').slice(0, 60),
            marked: sr.querySelectorAll('[data-aionui-rtl]').length,
            blockquotesMarked: sr.querySelectorAll('blockquote[data-aionui-rtl]').length,
            listsMarked: sr.querySelectorAll('ul[data-aionui-rtl],ol[data-aionui-rtl]').length,
            hasAdoptedSheet: 'adoptedStyleSheets' in sr && Array.prototype.slice.call(sr.adoptedStyleSheets).indexOf(sharedSheet) !== -1,
            hasStyleChild: !!sr.querySelector('style[data-aionui-rtl-style]')
          };
        })
      };
      console.info('[aionui-rtl] state:', info);
      return info;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
