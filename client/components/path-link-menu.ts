import type { PluginClientContext } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import { Platform, type TextProps } from "react-native";
import { revealPathRpc, stripSelector } from "../../shared/file-rpc";
import { getEnhancerPreferences, updateEnhancerPreferences } from "../preferences";
import { isAllowedLink } from "./open-link";
import { isExecutablePath, normalizeOpenPath } from "./path-open-policy";
import { radius } from "./theme-tokens";

const GAP = 8;
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/** Mark absolute paths in inline code for the web context menu. */
export function pathTargetProps(text: string): TextProps | null {
  return Platform.OS === "web" && ABSOLUTE_PATH.test(text)
    ? ({ dataSet: { bcpath: text } } as unknown as TextProps)
    : null;
}

const MENU_CSS = `
:host { all: initial; }
.menu, .dialog {
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: ${radius.block}px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  font: 13px/18px "Segoe UI", system-ui, sans-serif;
}
.menu { display: flex; flex-direction: column; min-width: 190px; }
.item {
  appearance: none;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: ${radius.chip}px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.item:hover, .item:focus-visible { background: var(--hover); }
.item:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.note { max-width: 420px; padding: 6px 10px; white-space: normal; overflow-wrap: anywhere; }
.dialog { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 16px; }
.dialog::backdrop { background: rgba(0, 0, 0, 0.4); }
.title { margin: 0 0 12px; font-size: 15px; line-height: 20px; }
.path { margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.warning { margin: 0 0 12px; font-weight: 600; }
.remember { display: flex; align-items: center; gap: 8px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.actions .item { border: 1px solid var(--border); }
`;

/** Match the menu to the text under the pointer. */
function paletteFor(textColor: string): Record<string, string> {
  const [r = 0, g = 0, b = 0] = (textColor.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128
    ? { bg: "#252526", fg: "#e8e8e8", border: "rgba(255,255,255,0.12)", hover: "rgba(255,255,255,0.09)" }
    : { bg: "#ffffff", fg: "#1f1f1f", border: "rgba(0,0,0,0.12)", hover: "rgba(0,0,0,0.06)" };
}

/** The shadow root keeps host CSS out of the menu and confirmation dialog. */
export function installPathLinkMenu(client: PluginClientContext): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};

  const host = document.createElement("div");
  // Host rules can match a bare div. These placement values must take priority.
  for (const [property, value] of <Array<[string, string]>>[
    ["position", "fixed"],
    ["z-index", "2147483000"],
    ["display", "none"],
    ["margin", "0"],
    ["padding", "0"],
  ]) {
    host.style.setProperty(property, value, "important");
  }
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = MENU_CSS;
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", "open-path-title");
  dialog.setAttribute("aria-describedby", "open-path-target");
  shadow.append(style, menu, dialog);
  document.body.appendChild(host);

  let errorTimer = 0;
  let disposed = false;
  const hide = () => {
    window.clearTimeout(errorTimer);
    if (dialog.open) dialog.close();
    host.style.setProperty("display", "none", "important");
  };

  const buttonFor = (label: string, run: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      // Do not carry a double-click from the menu into the confirmation.
      if (event.detail > 1) return;
      hide();
      run();
    });
    return button;
  };
  const addItem = (label: string, run: () => void) => {
    const button = buttonFor(label, run);
    button.setAttribute("role", "menuitem");
    menu.appendChild(button);
  };

  const showError = (message: string) => {
    if (disposed) return;
    hide();
    const note = document.createElement("div");
    note.className = "note";
    note.setAttribute("role", "alert");
    note.textContent = message;
    menu.replaceChildren(note);
    menu.style.display = "flex";
    host.style.setProperty("display", "block", "important");
    errorTimer = window.setTimeout(hide, 5000);
  };

  const shell = (path: string, open: boolean) => {
    client
      .rpc(revealPathRpc, { cwd: "", path, open })
      .then((result) => {
        if (result.error) showError(`Could not ${open ? "open" : "show"} ${path}: ${result.error}`);
      })
      .catch((error: unknown) => showError(`Could not ${open ? "open" : "show"} ${path}: ${String(error)}`));
  };

  const confirmOpen = (requested: string) => {
    // Match the daemon's target before the extension check and confirmation.
    const path = normalizeOpenPath(stripSelector(requested));
    const executable = isExecutablePath(path);
    // The client asks before this RPC. The daemon does not enforce confirmation.
    if (!executable && !getEnhancerPreferences().confirmOpenPath) {
      shell(path, true);
      return;
    }

    dialog.replaceChildren();
    const title = document.createElement("h2");
    title.id = "open-path-title";
    title.className = "title";
    title.textContent = "Open in Default App?";
    const target = document.createElement("p");
    target.id = "open-path-target";
    target.className = "path";
    target.dir = "ltr";
    target.textContent = path;
    dialog.append(title, target);

    const remember = document.createElement("input");
    remember.type = "checkbox";
    if (executable) {
      const warning = document.createElement("p");
      warning.id = "open-path-warning";
      warning.className = "warning";
      warning.textContent = "This executable or script can run code on the daemon machine. Open it only if you trust it.";
      dialog.appendChild(warning);
      dialog.setAttribute("aria-describedby", "open-path-target open-path-warning");
    } else {
      const label = document.createElement("label");
      label.className = "remember";
      label.append(remember, "Don't ask again");
      dialog.appendChild(label);
      dialog.setAttribute("aria-describedby", "open-path-target");
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = buttonFor("Cancel", () => {});
    cancel.autofocus = true;
    actions.append(cancel, buttonFor("Open", () => {
      if (!executable && remember.checked) updateEnhancerPreferences({ confirmOpenPath: false });
      shell(path, true);
    }));
    dialog.appendChild(actions);
    menu.style.display = "none";
    host.style.setProperty("display", "block", "important");
    dialog.showModal();
    cancel.focus();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (dialog.open) {
      event.preventDefault();
      return;
    }
    hide();
    const target = event.target as Element | null;
    const marked = target?.closest?.("[data-bcpath]");
    const link = marked ?? target?.closest?.("a[href]");
    const path = marked?.getAttribute("data-bcpath") ?? link?.getAttribute("href") ?? "";
    if (!link || !path || (!marked && isAllowedLink(path))) return;
    // Read now. A menu press can collapse the text selection.
    const selected = document.getSelection()?.toString() ?? "";

    event.preventDefault();
    event.stopPropagation();
    menu.replaceChildren();
    menu.style.display = "flex";
    if (selected) addItem("Copy Selection", () => void copyText(selected));
    addItem("Copy Path", () => void copyText(path));
    // Relative paths get Copy only because this document listener has no agent cwd.
    if (ABSOLUTE_PATH.test(path)) {
      addItem("Open in Default App", () => confirmOpen(path));
      addItem("Show in File Manager", () => shell(path, false));
    }

    for (const [name, value] of Object.entries(paletteFor(getComputedStyle(link).color))) {
      menu.style.setProperty(`--${name}`, value);
      dialog.style.setProperty(`--${name}`, value);
    }
    host.style.setProperty("display", "block", "important");
    const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - GAP);
    const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - GAP);
    host.style.setProperty("left", `${Math.max(GAP, left)}px`, "important");
    host.style.setProperty("top", `${Math.max(GAP, top)}px`, "important");
  };

  const onPointerDown = (event: MouseEvent) => {
    if (!dialog.open && !event.composedPath().includes(host)) hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || host.style.getPropertyValue("display") === "none") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hide();
  };
  const hideMenu = () => {
    if (!dialog.open) hide();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    hide();
  });

  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  // A stream can scroll the chat. Only a user wheel action closes the menu.
  document.addEventListener("wheel", hideMenu, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hideMenu);
  return () => {
    disposed = true;
    hide();
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("wheel", hideMenu, true);
    window.removeEventListener("blur", hide);
    window.removeEventListener("resize", hideMenu);
    host.remove();
  };
}
