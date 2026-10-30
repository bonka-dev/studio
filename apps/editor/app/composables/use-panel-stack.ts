import { onMounted, reactive, ref } from "vue";
import { useDragReorder } from "./use-drag-reorder";

type Panel = { key: string };

export function usePanelStack(storageKey: string, keys: string[]) {
  const panels = ref<Panel[]>(keys.map(key => ({ key })));

  onMounted(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if(!saved) return;
      const order = JSON.parse(saved);
      if(Array.isArray(order) && order.length === keys.length && order.every(key => typeof key === "string") && new Set(order).size === keys.length && keys.every(key => order.includes(key))) {
        panels.value = order.map(key => ({ key }));
      }
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Panel order remains available for the current session.
      }
    }
  });

  const reorder = useDragReorder(panels, {
    axis: "vertical",
    handle: ".panel-title, .panel-tab-header",
    save: next => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next.map(panel => panel.key)));
      } catch {
        // Panel order remains available for the current session.
      }
    },
  });

  return reactive({ panels, ...reorder });
}
