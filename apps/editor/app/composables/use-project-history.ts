import { computed, ref } from "vue";
import { createHistory } from "../lib/workspace/editor-commands.mjs";

export function useProjectHistory<T>(snapshot: (state: T) => T, restore: (state: T) => void) {
  const version = ref(0);
  let timeline: ReturnType<typeof createHistory> | null = null;

  const entries = computed(() => {
    version.value;
    return timeline?.entries().map(entry => ({ revision: entry.revision, label: entry.label })) ?? [];
  });
  const index = computed(() => {
    version.value;
    return timeline?.index() ?? 0;
  });
  const canUndo = computed(() => index.value > 0);
  const canRedo = computed(() => index.value < entries.value.length - 1);

  function reset(state: T) {
    timeline = createHistory(snapshot(state));
    version.value++;
  }

  function commit(state: T, label: string) {
    if(!timeline) timeline = createHistory(snapshot(state));
    restore(timeline.push(snapshot(state), label));
    version.value++;
  }

  function goTo(nextIndex: number) {
    if(!timeline) return;
    restore(timeline.goTo(nextIndex));
    version.value++;
  }

  function markSaved() {
    timeline?.markSaved();
    version.value++;
  }

  function clear() {
    timeline = null;
    version.value++;
  }

  function isDirty() {
    return timeline?.isDirty() ?? false;
  }

  return { entries, index, canUndo, canRedo, reset, commit, goTo, markSaved, clear, isDirty };
}
