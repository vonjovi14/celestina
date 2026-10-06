(() => {
  "use strict";

  const GALLERY_DIR = "./gallery/";
  const BATCH_SIZE = 5;
  const WEEKDAYS = ["Sun.", "Mon.", "Tue.", "Wed.", "Thu.", "Fri.", "Sat."];

  const list = document.querySelector("#gallery-list");
  const status = document.querySelector("#gallery-status");
  const statusText = status.querySelector(".status-text");
  const sentinel = document.querySelector("#scroll-sentinel");
  const modal = document.querySelector("#modal");

  let dates = [];
  let cursor = 0;
  let loading = false;
  let observer;

  const escapeHtml = (value = "") =>
    value.replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    }[c]));

  // キャプションは <br> のみ許可。それ以外のHTMLは無効化する。
  const captionToHtml = (value = "") => {
    const token = "__CELESTINA_BR__";
    return escapeHtml(value.replace(/<br\s*\/?>/gi, token)).replaceAll(token, "<br>");
  };

  const parseDateKey = key => {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(4, 6));
    const d = Number(key.slice(6, 8));
    return new Date(y, m - 1, d);
  };

  const formatDate = key => ({
    year: key.slice(0, 4),
    monthDay: `${key.slice(4, 6)}.${key.slice(6, 8)}`,
    weekday: WEEKDAYS[parseDateKey(key).getDay()]
  });

  async function loadEntry(key) {
    const response = await fetch(`${GALLERY_DIR}${key}.txt`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${key}.txt を読み込めませんでした`);

    // 最初のカンマだけを区切りとして扱うので、キャプション内のカンマは保持される。
    const raw = (await response.text()).trim();
    const comma = raw.indexOf(",");
    const title = comma >= 0 ? raw.slice(0, comma).trim() : raw;
    const caption = comma >= 0 ? raw.slice(comma + 1).trim() : "";

    return {
      key,
      title,
      caption,
      image: `${GALLERY_DIR}${key}.png`,
      ...formatDate(key)
    };
  }

  function makeCard(entry, index) {
    const article = document.createElement("article");
    article.className = "gallery-card";
    article.style.animationDelay = `${Math.min(index, 4) * 70}ms`;

    article.innerHTML = `
      <div class="card-info">
        <div class="card-date">
          <span class="year">${entry.year}</span>
          <strong>${entry.monthDay}</strong>
          <span class="weekday">${entry.weekday}</span>
        </div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p class="card-caption">${captionToHtml(entry.caption)}</p>
        <button class="view-more" type="button">VIEW MORE →</button>
      </div>
      <div class="card-thumb">
        <img src="${entry.image}" alt="${escapeHtml(entry.title)}" loading="lazy">
      </div>
    `;

    article.querySelector(".view-more").addEventListener("click", () => openModal(entry));
    return article;
  }

  async function loadNextBatch() {
    if (loading || cursor >= dates.length) return;
    loading = true;
    status.classList.remove("done");
    statusText.textContent = "Loading Celestina...";

    const batch = dates.slice(cursor, cursor + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(loadEntry));

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        list.appendChild(makeCard(result.value, i));
      } else {
        console.warn(result.reason);
      }
    });

    cursor += batch.length;
    loading = false;

    if (cursor >= dates.length) {
      status.classList.add("done");
      statusText.textContent = "You've reached the beginning of her story. ☾";
      observer?.disconnect();
    }
  }

  function openModal(entry) {
    document.querySelector("#modal-year").textContent = entry.year;
    document.querySelector("#modal-date").textContent = entry.monthDay;
    document.querySelector("#modal-weekday").textContent = entry.weekday;
    document.querySelector("#modal-title").textContent = entry.title;
    document.querySelector("#modal-caption").innerHTML = captionToHtml(entry.caption);

    const img = document.querySelector("#modal-image");
    img.src = entry.image;
    img.alt = entry.title;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    document.querySelector(".modal-close").focus();
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    document.querySelector("#modal-image").src = "";
  }

  document.querySelectorAll("[data-close-modal]").forEach(el =>
    el.addEventListener("click", closeModal)
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
  });

  async function init() {
    document.querySelector("#copyright-year").textContent = new Date().getFullYear();

    try {
      const response = await fetch(`${GALLERY_DIR}index.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error("gallery/index.json を読み込めませんでした");

      const data = await response.json();
      dates = [...new Set(data)]
        .filter(v => /^\d{8}$/.test(v))
        .sort((a, b) => b.localeCompare(a));

      if (!dates.length) {
        status.classList.add("done");
        statusText.textContent = "Gallery is waiting for her first day. ☾";
        return;
      }

      await loadNextBatch();

      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadNextBatch();
      }, { rootMargin: "600px 0px" });

      observer.observe(sentinel);
    } catch (error) {
      console.error(error);
      status.classList.add("done");
      statusText.textContent = "Galleryを読み込めませんでした。READMEをご確認ください。";
    }
  }

  init();
})();
