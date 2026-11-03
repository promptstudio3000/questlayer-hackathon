import { useEffect, useState } from "react";
import { tr } from "./i18n";
export type OriginalItem = { itemId: string; quantity: string };
export function OriginalItemPicture({
  item,
  src,
  reference = false,
}: {
  item: OriginalItem;
  src?: string;
  reference?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.itemId, src]);
  return (
    <article className="original-item">
      <div className="original-item-art">
        {failed ? (
          <span>{tr("Preview unavailable")}</span>
        ) : (
          <img
            src={
              src ||
              `/api/aavegotchi/wearable/${encodeURIComponent(item.itemId)}.svg`
            }
            alt={tr("Original item #{0}", { 0: item.itemId })}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <strong>{tr("Item #")}{item.itemId}</strong>
      <span>{reference ? tr("Public reference") : tr("Owned: {0}", { 0: item.quantity })}</span>
    </article>
  );
}
export function OriginalItemGallery({ items }: { items: OriginalItem[] }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [items]);
  const total = Math.ceil(items.length / 12),
    visible = items.slice(page * 12, (page + 1) * 12);
  if (!items.length)
    return <p>{tr("No original items were found in this ownership check.")}</p>;
  return (
    <section className="original-items" aria-label={tr("Original item inventory")}>
      <h3>{tr("Original item inventory")}</h3>
      <p>
        {tr("Read-only items from your linked address and its originals. They stay in your wallet.")}</p>
      <div className="original-item-grid">
        {visible.map((item) => (
          <OriginalItemPicture key={item.itemId} item={item} />
        ))}
      </div>
      {total > 1 && (
        <div className="original-item-pages">
          <button
            className="secondary-button"
            disabled={!page}
            onClick={() => setPage((p) => p - 1)}
          >
            {tr("Previous items")}</button>
          <span role="status">
            {tr("Page")}{" "}{page + 1} of {total}
          </span>
          <button
            className="secondary-button"
            disabled={page + 1 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {tr("Next items")}</button>
        </div>
      )}
    </section>
  );
}
