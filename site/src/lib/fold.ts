/**
 * A census's topics, split into the ones that always show and the ones a phone folds away.
 * The local languages stay beside the age pyramid, with the mismatch note when a language
 * is flagged; everything after them goes in the fold.
 */
export function foldTopics<T extends { topic: string }>(blocks: T[]): { shown: T[]; folded: T[] } {
  return {
    shown: blocks.filter((b) => b.topic === "localLanguages"),
    folded: blocks.filter((b) => b.topic !== "localLanguages"),
  };
}
