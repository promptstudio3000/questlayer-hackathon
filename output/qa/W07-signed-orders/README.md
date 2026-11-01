# W07 signed Aura offers: UI evidence

The fixture is `dev/signed-orders.html?state=on|off|empty`. It renders the real `NativeMarketPanel` with `SignedOrdersPanel`. All requests are answered in memory, and market calls are recorded but never sent. Orders are signed with throwaway in-memory keys, through the same `signNep413Message` path that the device key uses.

| File | State |
|---|---|
| `360-orders.png` | 360 px: the sell form, an open sell order and a buy offer from another explorer, a make-offer card, and the player's own history (one open order, one expired) |
| `390-orders-large-text.png` | 390 px with text at 125 % |
| `landscape-844x390.png`, `desktop-1280.png` | Short landscape and desktop |
| `390-off.png` → `390-turned-on.png` | The signing key is not registered yet. Turning it on records `add_signing_key`, which is relayed with 1 yocto. |
| `390-signed-sell.png` | Signing a sell order for 4.5 test NEAR adds an open order to the history. |
| `390-price-error.png` | `1e2` is rejected, the entered value is kept, and focus returns to the price input. |
| `390-make-offer.png` | The offer is higher than the market balance, so `deposit_near` is recorded first (self-paid), then the order is signed. |
| `390-empty.png` | No orders and no Auras held by the market |

**Results:** no horizontal overflow at any size, and no console or page errors.

**Not covered:** a real device and the live chain. The signed bytes are checked separately in `tests/signed-orders.test.mjs`: the near-api-js device-key signature is byte-identical to the fixture that the Rust contract verifies.
