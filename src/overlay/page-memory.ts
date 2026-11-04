/**
 * What the overlay works out from the page's picture (the busy map, the placement grid, the snapper), kept for as
 * long as it is the same picture. The screenshot element is one and the same object for every capture, so a new
 * picture is told by `renew()` when it arrives, not by the element; a new element also counts as new.
 */
export class PageMemory {
  private page = 0;
  private slots = new Map<string, { page: number; image: unknown; key: string; value: unknown }>();

  /** A new picture has arrived: everything kept is out of date. */
  renew(): void {
    this.page++;
    this.slots.clear();
  }

  /** The value kept in `slot` for this picture (and this `key`, such as an aspect), made by `make` when there is none. */
  recall<T>(slot: string, image: unknown, key: string, make: () => T): T {
    const held = this.slots.get(slot);
    if (held && held.page === this.page && held.image === image && held.key === key) return held.value as T;
    const value = make();
    this.slots.set(slot, { page: this.page, image, key, value });
    return value;
  }
}
