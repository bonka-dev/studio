import { onMounted, reactive, ref } from "vue";

export type DockZone = "left" | "right";
export type WorkspaceDockPanel = { key: string; tabs: string[] };
export type WorkspaceDockZones = Record<DockZone, WorkspaceDockPanel[]>;

type DraggedItem = { zone: DockZone; panelKey: string; tab?: string };
type InsertionPoint = { zone: DockZone; index: number };

export function useWorkspaceDockLayout(storageKey: string, defaults: WorkspaceDockZones) {
  const zones = ref(cloneZones(defaults));
  const activeTabs = ref<Record<string, string>>({});
  const dragged = ref<DraggedItem | null>(null);
  const dockTarget = ref<{ zone: DockZone; key: string } | null>(null);
  const insertionPoint = ref<InsertionPoint | null>(null);
  const elements = new Map<string, HTMLElement>();
  let nextPanel = 0;
  let armed: { zone: DockZone; key: string } | null = null;

  onMounted(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if(!saved) return;
      const parsed = JSON.parse(saved);
      if(isValidLayout(parsed, defaults)) {
        zones.value = parsed.zones;
        activeTabs.value = validActiveTabs(parsed.activeTabs, parsed.zones);
      }
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // The default layout remains available when browser storage is unavailable.
      }
    }
  });

  function activeTab(panel: WorkspaceDockPanel) {
    return panel.tabs.includes(activeTabs.value[panel.key]) ? activeTabs.value[panel.key] : panel.tabs[0];
  }

  function setActiveTab(panel: WorkspaceDockPanel, tab: string) {
    if(!panel.tabs.includes(tab)) return;
    activeTabs.value = { ...activeTabs.value, [panel.key]: tab };
    save(zones.value);
  }

  function dragItem(zone: DockZone, key: string) {
    return {
      ref: (element: unknown) => {
        const elementKey = keyFor(zone, key);
        if(element instanceof HTMLElement) elements.set(elementKey, element);
        else elements.delete(elementKey);
      },
      draggable: true,
      onMousedown: (event: MouseEvent) => {
        armed = event.target instanceof Element && event.target.closest(".panel-title, .panel-tab-header") ? { zone, key } : null;
      },
      onMouseup: () => armed = null,
      onDragstart: (event: DragEvent) => startPanelDrag(zone, key, event),
      onDragend: clearDrag,
    };
  }

  function startPanelDrag(zone: DockZone, panelKey: string, event: DragEvent) {
    const item = event.currentTarget as HTMLElement;
    if(armed?.zone !== zone || armed.key !== panelKey) {
      const nestedDraggable = event.target instanceof Element ? event.target.closest('[draggable="true"]') : null;
      if(nestedDraggable === null || nestedDraggable === item) event.preventDefault();
      return;
    }
    armed = null;
    dragged.value = { zone, panelKey };
    event.dataTransfer?.setData("text/plain", panelKey);
    if(event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function startTabDrag(zone: DockZone, tab: string, event: DragEvent) {
    const panel = zones.value[zone].find(candidate => candidate.tabs.includes(tab));
    if(!panel || panel.tabs.length < 2) return;
    dragged.value = { zone, panelKey: panel.key, tab };
    event.dataTransfer?.setData("text/plain", tab);
    if(event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function previewDrop(zone: DockZone, event: DragEvent) {
    const source = dragged.value;
    if(!source) return;
    event.preventDefault();
    if(event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dockTarget.value = null;
    const rows = zones.value[zone];
    if(!rows.length) {
      insertionPoint.value = { zone, index: 0 };
      return;
    }
    const targetIndex = rows.findIndex(panel => {
      if(!source.tab && source.zone === zone && source.panelKey === panel.key) return false;
      const content = elements.get(keyFor(zone, panel.key))?.querySelector<HTMLElement>(".panel-content");
      if(!content) return false;
      const box = content.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top + box.height / 2 && event.clientY <= box.bottom;
    });
    if(targetIndex >= 0) {
      insertionPoint.value = { zone, index: targetIndex + 1 };
      return;
    }
    const last = rows.at(-1);
    const lastElement = last ? elements.get(keyFor(zone, last.key)) : null;
    const stack = lastElement?.parentElement;
    if(!last || !lastElement || !stack || (!source.tab && source.zone === zone && source.panelKey === last.key)) {
      insertionPoint.value = null;
      return;
    }
    const lastBox = lastElement.getBoundingClientRect();
    const stackBox = stack.getBoundingClientRect();
    insertionPoint.value = event.clientX >= stackBox.left && event.clientX <= stackBox.right && event.clientY >= lastBox.bottom && event.clientY <= stackBox.bottom ? { zone, index: rows.length } : null;
  }

  function previewMerge(zone: DockZone, panelKey: string, event: DragEvent) {
    const source = dragged.value;
    if(!source || (!source.tab && source.zone === zone && source.panelKey === panelKey)) return;
    const target = zones.value[zone].find(panel => panel.key === panelKey);
    if(!target || (source.tab && target.tabs.includes(source.tab))) return;
    event.preventDefault();
    event.stopPropagation();
    if(event.dataTransfer) event.dataTransfer.dropEffect = "move";
    insertionPoint.value = null;
    dockTarget.value = { zone, key: panelKey };
  }

  function dropAt(zone: DockZone, event: DragEvent) {
    previewDrop(zone, event);
    const source = dragged.value;
    const insertion = insertionPoint.value;
    if(!source || !insertion) {
      clearDrag();
      return;
    }
    if(source.tab) detachTab(source, insertion);
    else movePanel(source, insertion);
    clearDrag();
  }

  function mergeInto(zone: DockZone, panelKey: string, event: DragEvent) {
    previewMerge(zone, panelKey, event);
    const source = dragged.value;
    if(!source || dockTarget.value?.zone !== zone || dockTarget.value.key !== panelKey) return;
    if(source.tab) mergeTab(source, zone, panelKey);
    else mergePanel(source, zone, panelKey);
    clearDrag();
  }

  function movePanel(source: DraggedItem, insertion: InsertionPoint) {
    const next = cloneZones(zones.value);
    const sourceRows = next[source.zone];
    const sourceIndex = sourceRows.findIndex(panel => panel.key === source.panelKey);
    if(sourceIndex < 0) return;
    const [panel] = sourceRows.splice(sourceIndex, 1);
    const targetRows = next[insertion.zone];
    const targetIndex = source.zone === insertion.zone && sourceIndex < insertion.index ? insertion.index - 1 : insertion.index;
    targetRows.splice(targetIndex, 0, panel);
    zones.value = next;
    save(next);
  }

  function detachTab(source: DraggedItem, insertion: InsertionPoint) {
    const next = cloneZones(zones.value);
    const sourcePanel = next[source.zone].find(panel => panel.key === source.panelKey);
    const targetRows = next[insertion.zone];
    if(!sourcePanel || !source.tab || sourcePanel.tabs.length < 2) return;
    sourcePanel.tabs = sourcePanel.tabs.filter(tab => tab !== source.tab);
    let key = `${source.tab}-${nextPanel++}`;
    while(next.left.some(panel => panel.key === key) || next.right.some(panel => panel.key === key)) key = `${source.tab}-${nextPanel++}`;
    const panel = { key, tabs: [source.tab] };
    targetRows.splice(insertion.index, 0, panel);
    activeTabs.value = { ...activeTabs.value, [key]: source.tab };
    zones.value = next;
    save(next);
  }

  function mergePanel(source: DraggedItem, targetZone: DockZone, targetKey: string) {
    const next = cloneZones(zones.value);
    const sourceRows = next[source.zone];
    const sourceIndex = sourceRows.findIndex(panel => panel.key === source.panelKey);
    const target = next[targetZone].find(panel => panel.key === targetKey);
    if(sourceIndex < 0 || !target) return;
    const [panel] = sourceRows.splice(sourceIndex, 1);
    target.tabs.push(...panel.tabs.filter(tab => !target.tabs.includes(tab)));
    activeTabs.value = { ...activeTabs.value, [target.key]: activeTab(panel) };
    zones.value = next;
    save(next);
  }

  function mergeTab(source: DraggedItem, targetZone: DockZone, targetKey: string) {
    const next = cloneZones(zones.value);
    const sourcePanel = next[source.zone].find(panel => panel.key === source.panelKey);
    const target = next[targetZone].find(panel => panel.key === targetKey);
    if(!sourcePanel || !source.tab || !target || target.tabs.includes(source.tab)) return;
    sourcePanel.tabs = sourcePanel.tabs.filter(tab => tab !== source.tab);
    target.tabs.push(source.tab);
    if(!sourcePanel.tabs.length) next[source.zone] = next[source.zone].filter(panel => panel !== sourcePanel);
    activeTabs.value = { ...activeTabs.value, [target.key]: source.tab };
    zones.value = next;
    save(next);
  }

  function clearDrag() {
    armed = null;
    dragged.value = null;
    dockTarget.value = null;
    insertionPoint.value = null;
  }

  function isInsertionAfter(zone: DockZone, key: string) {
    const index = zones.value[zone].findIndex(panel => panel.key === key);
    return index >= 0 && insertionPoint.value?.zone === zone && insertionPoint.value.index === index + 1;
  }

  function isEmptyInsertionTarget(zone: DockZone) {
    return !zones.value[zone].length && insertionPoint.value?.zone === zone && insertionPoint.value.index === 0;
  }

  function reset() {
    zones.value = cloneZones(defaults);
    activeTabs.value = {};
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // The in-memory default remains available when browser storage is unavailable.
    }
  }

  function save(next: WorkspaceDockZones) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, zones: next, activeTabs: validActiveTabs(activeTabs.value, next) }));
    } catch {
      // The in-memory layout remains available when browser storage is unavailable.
    }
  }

  return reactive({ zones, activeTab, setActiveTab, dragItem, startTabDrag, clearDrag, previewDrop, previewMerge, dropAt, mergeInto, dragged, dockTarget, insertionPoint, isInsertionAfter, isEmptyInsertionTarget, reset });
}

function keyFor(zone: DockZone, key: string) {
  return `${zone}:${key}`;
}

function cloneZones(zones: WorkspaceDockZones): WorkspaceDockZones {
  return { left: zones.left.map(clonePanel), right: zones.right.map(clonePanel) };
}

function clonePanel(panel: WorkspaceDockPanel) {
  return { key: panel.key, tabs: [...panel.tabs] };
}

function validActiveTabs(value: unknown, zones: WorkspaceDockZones) {
  if(!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries([...zones.left, ...zones.right].flatMap(panel => {
    const tab = (value as Record<string, unknown>)[panel.key];
    return typeof tab === "string" && panel.tabs.includes(tab) ? [[panel.key, tab]] : [];
  }));
}

function isValidLayout(value: unknown, defaults: WorkspaceDockZones): value is { version: 1; zones: WorkspaceDockZones; activeTabs?: Record<string, string> } {
  if(!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return false;
  const zones = (value as { zones?: unknown }).zones;
  if(!zones || typeof zones !== "object" || !Array.isArray((zones as WorkspaceDockZones).left) || !Array.isArray((zones as WorkspaceDockZones).right)) return false;
  const panels = [...(zones as WorkspaceDockZones).left, ...(zones as WorkspaceDockZones).right];
  const allowedTabs = new Set([...defaults.left, ...defaults.right].flatMap(panel => panel.tabs));
  const tabs = panels.flatMap(panel => panel?.tabs ?? []);
  return panels.length > 0 && panels.every(panel => panel && typeof panel.key === "string" && Array.isArray(panel.tabs) && panel.tabs.length > 0 && panel.tabs.every(tab => typeof tab === "string" && allowedTabs.has(tab))) && new Set(panels.map(panel => panel.key)).size === panels.length && new Set(tabs).size === allowedTabs.size && tabs.length === allowedTabs.size;
}
