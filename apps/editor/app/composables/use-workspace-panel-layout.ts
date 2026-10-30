import { onMounted, reactive, ref } from "vue";
import { useDragReorder } from "./use-drag-reorder";

export type WorkspacePanel = { key: string; tabs: string[] };

export function useWorkspacePanelLayout(storageKey: string, initialPanels: WorkspacePanel[], detachableTabs: string[]) {
  const panels = ref<WorkspacePanel[]>(clonePanels(initialPanels));
  const activeTabs = ref<Record<string, string>>({});
  const draggedTab = ref<string | null>(null);
  const dockTarget = ref<string | null>(null);
  let nextPanel = 0;

  onMounted(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if(!saved) return;
      const parsed = JSON.parse(saved);
      if(isValidLayout(parsed, initialPanels, detachableTabs)) {
        panels.value = parsed.panels;
        activeTabs.value = validActiveTabs(parsed.activeTabs, parsed.panels);
      }
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Layout persistence is optional when browser storage is unavailable.
      }
    }
  });

  const reorder = useDragReorder(panels, {
    axis: "vertical",
    handle: ".panel-title, .panel-tab-header",
    previewDrop: true,
    save: next => {
      save(next);
    },
    onEnd: clearDropTargets,
  });

  function activeTab(panel: WorkspacePanel) {
    return panel.tabs.includes(activeTabs.value[panel.key]) ? activeTabs.value[panel.key] : panel.tabs[0];
  }

  function setActiveTab(panel: WorkspacePanel, tab: string) {
    if(panel.tabs.includes(tab)) {
      activeTabs.value = { ...activeTabs.value, [panel.key]: tab };
      save(panels.value);
    }
  }

  function startTabDrag(tab: string, event: DragEvent) {
    if(!detachableTabs.includes(tab)) return;
    reorder.clearInsertion();
    draggedTab.value = tab;
    event.dataTransfer?.setData("text/plain", tab);
    if(event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function endTabDrag() {
    draggedTab.value = null;
    clearDropTargets();
  }

  function allowDockDrop(event: DragEvent, targetKey?: string) {
    if(!draggedTab.value && !reorder.dragging.value) return;
    event.preventDefault();
    if(event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if(targetKey !== undefined) {
      reorder.insertionAfter.value = null;
    } else {
      reorder.previewInsertion(event, reorder.dragging.value ?? undefined);
    }
    const target = targetKey ? panels.value.find(panel => panel.key === targetKey) : null;
    const validTarget = target && target.key !== reorder.dragging.value && (!draggedTab.value || !target.tabs.includes(draggedTab.value));
    dockTarget.value = validTarget ? target.key : null;
  }

  function detachTab(event: DragEvent) {
    allowDockDrop(event);
    const tab = draggedTab.value;
    if(!tab) return;
    const insertionAfter = reorder.insertionAfter.value;
    endTabDrag();
    if(insertionAfter === null) return;
    const sourceIndex = panels.value.findIndex(panel => panel.tabs.includes(tab));
    const source = panels.value[sourceIndex];
    if(!source || source.tabs.length < 2) return;
    const next = clonePanels(panels.value);
    next[sourceIndex].tabs = next[sourceIndex].tabs.filter(item => item !== tab);
    let key = `${tab}-${nextPanel++}`;
    while(next.some(panel => panel.key === key)) key = `${tab}-${nextPanel++}`;
    const panel = { key, tabs: [tab] };
    const targetIndex = insertionAfter === null ? sourceIndex : next.findIndex(candidate => candidate.key === insertionAfter);
    next.splice(targetIndex + 1, 0, panel);
    panels.value = next;
    setActiveTab(panel, tab);
    save(next);
  }

  function dockIntoPanel(targetKey: string, event: DragEvent) {
    allowDockDrop(event);
    if(draggedTab.value) {
      dockTab(targetKey, draggedTab.value);
      endTabDrag();
      return;
    }
    const sourceKey = reorder.dragging.value;
    if(!sourceKey || sourceKey === targetKey) return;
    const next = clonePanels(panels.value);
    const source = next.find(panel => panel.key === sourceKey);
    const target = next.find(panel => panel.key === targetKey);
    if(!source || !target) return;
    const selectedTab = activeTab(source);
    target.tabs.push(...source.tabs.filter(tab => !target.tabs.includes(tab)));
    next.splice(next.indexOf(source), 1);
    reorder.acceptDrop();
    panels.value = next;
    setActiveTab(target, selectedTab);
    save(next);
  }

  function dockTab(targetKey: string, tab: string) {
    const source = panels.value.find(panel => panel.tabs.includes(tab));
    const target = panels.value.find(panel => panel.key === targetKey);
    if(!source || !target || source === target || target.tabs.includes(tab)) return;
    const next = clonePanels(panels.value);
    const nextSource = next.find(panel => panel.tabs.includes(tab))!;
    const nextTarget = next.find(panel => panel.key === targetKey)!;
    nextSource.tabs = nextSource.tabs.filter(item => item !== tab);
    nextTarget.tabs.push(tab);
    if(!nextSource.tabs.length) next.splice(next.indexOf(nextSource), 1);
    panels.value = next;
    setActiveTab(nextTarget, tab);
    save(next);
  }

  function save(next: WorkspacePanel[]) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, panels: next, activeTabs: validActiveTabs(activeTabs.value, next) }));
    } catch {
      // The in-memory layout still works when browser storage is unavailable.
    }
  }

  function clearDropTargets() {
    dockTarget.value = null;
    reorder.clearInsertion();
  }

  return reactive({ panels, activeTab, setActiveTab, startTabDrag, endTabDrag, allowDockDrop, detachTab, dockIntoPanel, dockTarget, ...reorder });
}

function clonePanels(panels: WorkspacePanel[]) {
  return panels.map(panel => ({ key: panel.key, tabs: [...panel.tabs] }));
}

function validActiveTabs(value: unknown, panels: WorkspacePanel[]) {
  if(!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(panels.flatMap(panel => {
    const tab = (value as Record<string, unknown>)[panel.key];
    return typeof tab === "string" && panel.tabs.includes(tab) ? [[panel.key, tab]] : [];
  }));
}

function isValidLayout(value: unknown, initialPanels: WorkspacePanel[], detachableTabs: string[]): value is { version: 1; panels: WorkspacePanel[]; activeTabs?: Record<string, string> } {
  if(!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { panels?: unknown }).panels)) return false;
  const panels = (value as { panels: unknown[] }).panels;
  const allowedTabs = new Set(initialPanels.flatMap(panel => panel.tabs));
  const tabs = panels.flatMap(panel => typeof panel === "object" && panel !== null && Array.isArray((panel as WorkspacePanel).tabs) ? (panel as WorkspacePanel).tabs : []);
  const validPanels = panels.length > 0 && panels.every(panel => {
    if(!panel || typeof panel !== "object") return false;
    const candidate = panel as WorkspacePanel;
    return typeof candidate.key === "string" && Array.isArray(candidate.tabs) && candidate.tabs.length > 0 && candidate.tabs.every(tab => typeof tab === "string" && allowedTabs.has(tab));
  });
  const keys = panels.map(panel => (panel as WorkspacePanel).key);
  const expectedProjectTabs = allowedTabs.has("project") ? 1 : 0;
  return validPanels && new Set(keys).size === keys.length && new Set(tabs).size === allowedTabs.size && tabs.length === allowedTabs.size && [...allowedTabs].every(tab => tabs.includes(tab)) && tabs.filter(tab => tab === "project").length === expectedProjectTabs && detachableTabs.every(tab => tabs.includes(tab));
}
