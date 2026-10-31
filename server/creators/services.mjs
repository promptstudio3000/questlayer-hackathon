import { createCreatorLifecycle } from "./lifecycle.mjs";
import { createCreatorCommunity } from "./community.mjs";

// Supported Community composition: audience/block checks share the admission write lock.
export function createCreatorServices(db, options) {
  let community;
  const lifecycle = createCreatorLifecycle(db, {
    ...options,
    authorizeAdmission(actor, questId) {
      community.publicQuest(actor, questId);
      return true;
    },
  });
  community = createCreatorCommunity(db, options);
  return { lifecycle, community };
}
