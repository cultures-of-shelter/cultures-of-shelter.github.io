(() => {
  const containerSelector = ".grid";

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffleGridItems(container) {
    if (!container) return;

    const items = Array.from(container.children);
    if (items.length < 2) return;

    shuffleArray(items);

    const frag = document.createDocumentFragment();
    for (const el of items) frag.appendChild(el);
    container.appendChild(frag);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const container = document.querySelector(containerSelector);
    shuffleGridItems(container);
  });
})();