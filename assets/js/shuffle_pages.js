(function () {
  const CONTENT_SELECTOR = ".grid";
  const ITEM_SELECTOR = ":scope > .item";
  const EXCLUDE_SELECTOR = "[data-no-shuffle]";
  const KEEP_FIRST_AND_LAST_FIXED = true;

  function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffleInContentFragment(contentFragment) {
    const contentRoot = contentFragment.querySelector(CONTENT_SELECTOR);
    if (!contentRoot) return;

    const allItems = Array.from(contentRoot.querySelectorAll(ITEM_SELECTOR));

    const excluded = new Set(
      Array.from(contentRoot.querySelectorAll(EXCLUDE_SELECTOR))
    );

    let items = allItems.filter(el => el.parentElement === contentRoot && !excluded.has(el));
    if (items.length < 2) return;

    let fixedFirst = null;
    let fixedLast = null;

    if (KEEP_FIRST_AND_LAST_FIXED && items.length >= 3) {
      fixedFirst = items[0];
      fixedLast = items[items.length - 1];
      items = items.slice(1, -1);
    } else if (KEEP_FIRST_AND_LAST_FIXED && items.length === 2) {
      return;
    }

    fisherYatesShuffle(items);

    const newOrder = [];
    if (fixedFirst) newOrder.push(fixedFirst);
    newOrder.push(...items);
    if (fixedLast) newOrder.push(fixedLast);

    const frag = document.createDocumentFragment();
    newOrder.forEach(el => frag.appendChild(el));
    contentRoot.appendChild(frag);
  }

  if (!window.Paged || !window.Paged.Handler || !window.Paged.registerHandlers) {
    console.warn("Paged.js nicht gefunden. Stelle sicher, dass paged.polyfill.js vor diesem Script geladen ist.");
    return;
  }

  class ShuffleContentHandler extends window.Paged.Handler {
    beforeParsed(content) {
      shuffleInContentFragment(content);
    }
  }

  window.Paged.registerHandlers(ShuffleContentHandler);
})();