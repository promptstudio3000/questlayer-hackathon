import { createCreatorLifecycle } from "./lifecycle.mjs";
import { createCreatorCommunity } from "./community.mjs";
import { createCreatorSafety } from "./safety.mjs";
import { createCreatorCompletion } from "./completion.mjs";

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
  const safety = createCreatorSafety(db, { ...options, community });
  const completion = createCreatorCompletion(db, options);
  return { lifecycle, community, safety, completion };
}
