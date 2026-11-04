/**
 * Whether an overlay window lets mouse events pass through to whatever is beneath it. Normally it
 * does, except while the page says the pointer is over something the user can drag. While the pen is
 * on the window always takes the mouse, whatever the page says: a drag must reach the pen, never the
 * app beneath.
 */
export function ignoreMouse(pageWantsClicks: boolean, penOn: boolean): boolean {
  return !(penOn || pageWantsClicks);
}
