/**
 * "Open the camera for this work order" (EVM-108; security requirement 18): the port `session.openCamera(orderId)` of the entries (the bottom bar
 * of the details, the sheet "Dodaj", EVM-108 stage 3). The shell hosts the screen and reads the order that is open here — an id and nothing else
 * (never a number, a title or a name; lives in memory only and is dropped by the shell when the session ends).
 * The camera opens ONLY for a work order that is in the replica of the phone (or waits in the queue): an id that is not there (outside the scope,
 * deleted, made up) is refused, so a photo is never taken for an order the technician cannot see. The check reads ids only (`orderList(false)`
 * — no customer, no place — so it also works in the hidden-data mode).
 */
export interface CameraOrderSource {
  /** The orders of the replica and of the queue without personal data (`SyncControl.orderList(false)`). */
  orders(): Promise<readonly { readonly id: string }[]>;
}

export class CameraRequests {
  readonly #source: CameraOrderSource;
  readonly #listeners = new Set<() => void>();
  #open: string | null = null;

  constructor(source: CameraOrderSource) {
    this.#source = source;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The id of the order whose camera is open; `null` = none. */
  getSnapshot = (): string | null => this.#open;

  /** `true` = the camera is open for the order; `false` = the order is not on the phone (nothing opened). */
  async open(orderId: string): Promise<boolean> {
    const known = await this.#source.orders().then(
      (orders) => orders.some((order) => order.id === orderId),
      () => false,
    );
    if (!known) return false;
    this.#set(orderId);
    return true;
  }

  close = (): void => {
    this.#set(null);
  };

  #set(next: string | null): void {
    if (this.#open === next) return;
    this.#open = next;
    for (const listener of [...this.#listeners]) listener();
  }
}
