/*
 * src/lib/focusReturn.ts — gives focus back to the control that led to a dialog (step A.1).
 * A native <dialog> returns focus to whatever had it when showModal() ran, but the studio's menus close the moment
 * an item is chosen, so that item is gone and focus would fall to the page. The menu's Popover remembers its own
 * button here when it closes for an item; each dialog calls `restoreFocus` when it closes. A dialog opened straight
 * from a button needs none of this (the browser puts focus back on the button) and never calls `restoreFocus`.
 * It cannot ask "has focus been lost?": at the dialog's close event focus is often still on a button inside the
 * closed dialog (Chromium fixes it up on the next render), so a remembered opener is always refocused. Connects to: TopBar.tsx (Popover), ProjectDialog, ExportDialog,
 * ImportModelDialog.
 */
let opener: HTMLElement | null = null;

/** Called by a menu as it closes for an item: this button is where focus should come back to. */
export function rememberOpener(el: HTMLElement | null) {
  opener = el;
}

/** Called when a dialog has closed: refocus the button that was remembered, once. */
export function restoreFocus() {
  const el = opener;
  opener = null;
  if (el?.isConnected) el.focus();
}
