/**
 * A dropdown the page draws, over a native <select> that stays in the form. The browser's own
 * list can't be styled in every browser; this one can. The select keeps the value, so the
 * form reads it as before, and without a script the select is all there is.
 *
 * The button shows the chosen option and opens a list under it. The arrows move through the
 * list, Enter or Space chooses, Escape or Tab closes, Home and End jump to the ends, and a
 * letter jumps to the next option whose text starts with it. `row` draws an option, and the
 * list is drawn again whenever the select's options change.
 */
export function listbox(select: HTMLSelectElement, row: (option: HTMLOptionElement) => Node): void {
  const id = select.id || `listbox-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = document.createElement("div");
  wrap.className = "lb";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lb-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "lb-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  list.hidden = true;
  button.setAttribute("aria-controls", list.id);
  const label = select.closest("label")?.querySelector("span")?.textContent;
  if (label) list.setAttribute("aria-label", label);
  wrap.append(button, list);
  select.after(wrap);
  select.hidden = true;

  let active = select.selectedIndex;
  const options = () => [...select.options];
  const items = () => [...list.children] as HTMLElement[];

  const paint = () => {
    button.replaceChildren();
    const chosen = select.selectedOptions[0];
    if (chosen) button.append(row(chosen));
    for (const [i, item] of items().entries()) {
      item.setAttribute("aria-selected", String(i === select.selectedIndex));
      item.classList.toggle("active", i === active);
    }
    const current = items()[active];
    if (current) list.setAttribute("aria-activedescendant", current.id);
  };

  const build = () => {
    list.replaceChildren(
      ...options().map((option, i) => {
        const item = document.createElement("li");
        item.id = `${id}-option-${i}`;
        item.setAttribute("role", "option");
        item.append(row(option));
        item.addEventListener("pointermove", () => {
          if (active === i) return;
          active = i;
          paint();
        });
        item.addEventListener("click", () => choose(i));
        return item;
      }),
    );
    active = Math.max(0, select.selectedIndex);
    paint();
  };

  const open = () => {
    if (!list.hidden) return;
    active = Math.max(0, select.selectedIndex);
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
    paint();
    list.focus();
    items()[active]?.scrollIntoView({ block: "nearest" });
  };

  const close = (refocus = true) => {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    wrap.classList.remove("open");
    if (refocus) button.focus();
  };

  const choose = (i: number) => {
    if (i !== select.selectedIndex) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
    paint();
  };

  const move = (to: number) => {
    active = Math.min(Math.max(to, 0), options().length - 1);
    paint();
    items()[active]?.scrollIntoView({ block: "nearest" });
  };

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  button.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener("keydown", (event) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(options().length - 1),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const run = keys[event.key];
    if (run) {
      if (event.key !== "Tab") event.preventDefault();
      run();
      return;
    }
    // A letter jumps to the next option that starts with it.
    if (event.key.length === 1) {
      const letter = event.key.toLowerCase();
      const all = options();
      for (let step = 1; step <= all.length; step++) {
        const i = (active + step) % all.length;
        if (all[i]!.text.trim().toLowerCase().startsWith(letter)) {
          move(i);
          break;
        }
      }
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!wrap.contains(event.target as Node)) close(false);
  });

  new MutationObserver(build).observe(select, { childList: true, subtree: true });
  build();
}
