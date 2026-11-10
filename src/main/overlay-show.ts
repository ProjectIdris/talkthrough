// Showing an overlay window again after it was hidden. Hiding a window leaves Chromium's input window (the child that takes the mouse for the page) hidden, and showing
// the window again does not show it, whatever the bounds, focus or mouse state are set to: the top-level window is up and the page draws, but the system hands every
// press to the top-level window and none reaches the page (moves still do, through Electron's forwarding). Only a change of the window's size brings the child back, so
// the window is shown one pixel taller and then set to its size. Found on a hidden off-screen window; see scripts/overlay-reshow-input.cjs.

export type OverlayBounds = { x: number; y: number; width: number; height: number };

/** The part of a window this needs (a stand-in in tests). */
export type ShowableWindow = {
  showInactive(): void;
  setBounds(bounds: OverlayBounds): void;
};

/** Shows the window without giving it focus, at `bounds`, with its input child up (also when it was hidden before). */
export function showOverlayWindow(window: ShowableWindow, bounds: OverlayBounds): void {
  window.showInactive();
  // Windows places a window by the DPI of the display it started on, so the bounds are set once shown; the size is changed first so the input child is shown too.
  window.setBounds({ ...bounds, height: bounds.height + 1 });
  window.setBounds(bounds);
}
