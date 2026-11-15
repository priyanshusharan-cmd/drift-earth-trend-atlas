// Inline pickers for the headline question. The native <select> stays in the
// DOM as the source of truth (its options and change events drive the app);
// this replaces only what people see and touch, because native menus inherit
// the headline's display size.

let openPicker = null;

document.addEventListener("pointerdown", (e) => {
  if (openPicker && !openPicker.root.contains(e.target)) openPicker.close();
});

/**
 * columns > 1 lays options out as a grid (used for years); arrow keys move
 * through it in both directions.
 */
export function enhanceSelect(select, { columns = 1, label = "" } = {}) {
  const root = select.closest(".pick");
  root.classList.add("pick-enhanced");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pick-btn";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<span class="pick-text"></span><svg class="pick-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>`;

  const menu = document.createElement("div");
  menu.className = "pick-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", label);
  menu.hidden = true;
  if (columns > 1) {
    menu.classList.add("pick-grid");
    menu.style.setProperty("--cols", columns);
  }
  root.append(button, menu);

  const options = () => [...menu.querySelectorAll("[role=option]")];

  function sync() {
    const current = select.selectedOptions[0];
    button.querySelector(".pick-text").textContent = current ? current.textContent : "";
    button.setAttribute("aria-label", `${label}: ${current ? current.textContent : "none"}`);
    menu.replaceChildren(...[...select.options].map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick-opt";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(o.selected));
      b.dataset.value = o.value;
      b.textContent = o.textContent;
      b.tabIndex = -1;
      return b;
    }));
  }

  function choose(value) {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
    close();
    button.focus({ preventScroll: true });
  }

  function open() {
    if (openPicker && openPicker !== api) openPicker.close();
    openPicker = api;
    sync();
    menu.hidden = false;
    // Keep the menu inside the viewport horizontally.
    menu.style.left = "0px";
    const r = menu.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 12);
    if (over > 0) menu.style.left = `${-over}px`;
    // Open upward when there is no room below (the hero frame clips overflow).
    root.classList.toggle("up", r.bottom > window.innerHeight - 12 && r.top - r.height - button.offsetHeight > 70);
    button.setAttribute("aria-expanded", "true");
    root.classList.add("open");
    const selected = menu.querySelector('[aria-selected="true"]') || options()[0];
    // Scroll inside the menu only; scrollIntoView would also move the page.
    if (selected) menu.scrollTop = selected.offsetTop - menu.clientHeight / 2 + selected.offsetHeight / 2;
    selected?.focus({ preventScroll: true });
  }

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    root.classList.remove("open");
    if (openPicker === api) openPicker = null;
  }

  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(); }
  });
  menu.addEventListener("click", (e) => {
    const opt = e.target.closest("[role=option]");
    if (opt) choose(opt.dataset.value);
  });
  menu.addEventListener("keydown", (e) => {
    const list = options();
    const i = list.indexOf(document.activeElement);
    const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const j = Math.max(0, Math.min(list.length - 1, step === Infinity ? list.length - 1 : step === -Infinity ? 0 : i + step));
      list[j].focus({ preventScroll: true });
      const o = list[j];
      if (o.offsetTop < menu.scrollTop || o.offsetTop + o.offsetHeight > menu.scrollTop + menu.clientHeight) {
        menu.scrollTop = o.offsetTop - menu.clientHeight / 2;
      }
    } else if (e.key === "Escape") {
      e.preventDefault(); close(); button.focus({ preventScroll: true });
    } else if (e.key === "Tab") {
      close();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (i >= 0) choose(list[i].dataset.value);
    }
  });

  // The app rewrites options (and sets values) on the select; mirror it.
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
  select.addEventListener("change", sync);

  const api = { root, open, close, sync };
  sync();
  return api;
}

/** A row of toggle buttons mirroring a short <select> (variable, season). */
export function enhanceSegmented(select, { label = "" } = {}) {
  const host = select.closest(".seg-host");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  const group = document.createElement("div");
  group.className = "seg";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  const thumb = document.createElement("span");
  thumb.className = "seg-thumb";
  thumb.setAttribute("aria-hidden", "true");
  host.append(group);

  function placeThumb(animate) {
    const on = group.querySelector('[aria-checked="true"]');
    if (!on) return;
    thumb.style.transition = animate ? "" : "none";
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.height = `${on.offsetHeight}px`;
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  }

  function sync(animate = false) {
    const buttons = [...select.options].map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg-opt";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(o.selected));
      b.tabIndex = o.selected ? 0 : -1;
      b.dataset.value = o.value;
      b.textContent = o.textContent;
      return b;
    });
    group.replaceChildren(thumb, ...buttons);
    requestAnimationFrame(() => placeThumb(animate));
  }

  function choose(value) {
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  group.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-opt");
    if (b) choose(b.dataset.value);
  });
  group.addEventListener("keydown", (e) => {
    const list = [...group.querySelectorAll(".seg-opt")];
    const i = list.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d && i >= 0) {
      e.preventDefault();
      const next = list[(i + d + list.length) % list.length];
      choose(next.dataset.value);
      requestAnimationFrame(() => group.querySelector(`[data-value="${next.dataset.value}"]`)?.focus());
    }
  });
  new MutationObserver(() => sync(false)).observe(select, { childList: true, subtree: true, attributes: true });
  select.addEventListener("change", () => sync(true));
  new ResizeObserver(() => placeThumb(false)).observe(group);
  sync();
}
