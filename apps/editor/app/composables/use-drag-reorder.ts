import { onBeforeUnmount, ref } from "vue";
import type { Ref } from "vue";

export const SWITCH_DEPTH = 0.25;
const SWITCH_FLASH = 600;

export type DragAxis = "vertical" | "horizontal";
export type DragState = { lastStep: -1 | 0 | 1; extreme: number };

export type DragItemBindings = {
  ref: (element: unknown) => void;
  draggable: boolean;
  onMousedown: (event: MouseEvent) => void;
  onMouseup: () => void;
  onDragstart: (event: DragEvent) => void;
  onDragend: () => void;
};

type DragReorderOptions<T> = {
  save: (rows: T[], key: string) => void;
  move?: (rows: T[], key: string, to: number) => T[];
  axis?: DragAxis;
  handle?: string;
  previewDrop?: boolean;
  onEnd?: () => void;
};

export function moveRow<T extends { key: string }>(rows: T[], key: string, to: number): T[] {
  const from = rows.findIndex(row => row.key === key);
  if(from < 0 || to < 0 || to >= rows.length || from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function switchStep(top: number, slotTop: number, aboveHeight: number | null, belowHeight: number | null, state: DragState, gap = 0): -1 | 0 | 1 {
  if(aboveHeight !== null) {
    const from = state.lastStep === 1 ? Math.min(state.extreme, slotTop) : slotTop;
    if(top <= from - gap - aboveHeight * SWITCH_DEPTH) return -1;
  }
  if(belowHeight !== null) {
    const from = state.lastStep === -1 ? Math.max(state.extreme, slotTop) : slotTop;
    if(top >= from + gap + belowHeight * SWITCH_DEPTH) return 1;
  }
  return 0;
}

export function useDragReorder<T extends { key: string }>(rows: Ref<T[]>, { save, move = moveRow, axis: fixedAxis, handle, previewDrop = false, onEnd }: DragReorderOptions<T>) {
  const dragging = ref<string | null>(null);
  const switched = ref<string | null>(null);
  const insertionAfter = ref<string | null>(null);
  const elements = new Map<string, HTMLElement>();
  const sizes = new Map<string, number>();
  let list: HTMLElement | null = null;
  let axis: DragAxis = fixedAxis ?? "vertical";
  let beforeDrag: T[] = [];
  let dropped = false;
  let grabOffset = 0;
  let listStart = 0;
  let listScroll = 0;
  let firstSlotStart = 0;
  let gap = 0;
  let state: DragState = { lastStep: 0, extreme: 0 };
  let armedKey: string | null = null;
  let switchTimer: ReturnType<typeof setTimeout> | undefined;

  function startOf(rect: DOMRect) {
    return axis === "horizontal" ? rect.left : rect.top;
  }

  function sizeOf(rect: DOMRect) {
    return axis === "horizontal" ? rect.width : rect.height;
  }

  function pointerOf(event: DragEvent) {
    return axis === "horizontal" ? event.clientX : event.clientY;
  }

  function detectAxis(boxes: DOMRect[]): DragAxis {
    if(boxes.length < 2) return "vertical";
    const [first, second] = boxes;
    return Math.abs(second.left - first.left) > Math.abs(second.top - first.top) ? "horizontal" : "vertical";
  }

  function showSwitched(key: string) {
    clearTimeout(switchTimer);
    switched.value = key;
    switchTimer = setTimeout(() => switched.value = null, SWITCH_FLASH);
  }

  function dragItem(key: string, canDrag = true): DragItemBindings {
    return {
      ref: element => {
        if(element instanceof HTMLElement) elements.set(key, element);
        else elements.delete(key);
      },
      draggable: canDrag,
      onMousedown: event => {
        armedKey = !handle || (event.target instanceof Element && event.target.closest(handle)) ? key : null;
      },
      onMouseup: () => {
        armedKey = null;
      },
      onDragstart: event => dragStart(event, key),
      onDragend: dragEnd,
    };
  }

  function dragStart(event: DragEvent, key: string) {
    const item = event.currentTarget as HTMLElement;
    if(handle && armedKey !== key) {
      const nestedDraggable = event.target instanceof Element ? event.target.closest('[draggable="true"]') : null;
      if(nestedDraggable === null || nestedDraggable === item) event.preventDefault();
      return;
    }
    armedKey = null;
    const boxes = rows.value.flatMap(row => {
      const box = elements.get(row.key)?.getBoundingClientRect();
      return box ? [{ key: row.key, box }] : [];
    });
    event.dataTransfer?.setData("text/plain", key);
    if(event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    list = item.parentElement;
    axis = fixedAxis ?? detectAxis(boxes.map(({ box }) => box));
    const itemBox = item.getBoundingClientRect();
    const currentListStart = list ? startOf(list.getBoundingClientRect()) : 0;
    beforeDrag = rows.value;
    dropped = false;
    grabOffset = pointerOf(event) - startOf(itemBox);
    sizes.clear();
    firstSlotStart = Infinity;
    for(const { key: otherKey, box } of boxes) {
      sizes.set(otherKey, sizeOf(box));
      firstSlotStart = Math.min(firstSlotStart, startOf(box) - currentListStart);
    }
    listStart = currentListStart;
    listScroll = list ? (axis === "horizontal" ? list.scrollLeft : list.scrollTop) : 0;
    gap = gapBetween(boxes.map(({ box }) => box));
    state = { lastStep: 0, extreme: startOf(itemBox) - listStart };
    dragging.value = key;
    setDragImage(event, item, itemBox);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    window.addEventListener("keydown", cancelOnEscape);
  }

  function setDragImage(event: DragEvent, item: HTMLElement, box: DOMRect) {
    if(!event.dataTransfer) return;
    const picture = item.cloneNode(true) as HTMLElement;
    Object.assign(picture.style, {
      position: "fixed", top: "-10000px", left: "0", boxSizing: "border-box",
      width: `${box.width}px`, height: `${box.height}px`, margin: "0", opacity: "0.72",
    });
    document.body.append(picture);
    event.dataTransfer.setDragImage(picture, event.clientX - box.left, event.clientY - box.top);
    setTimeout(() => picture.remove());
  }

  function dragOver(event: DragEvent) {
    event.preventDefault();
    if(event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const key = dragging.value;
    if(key === null || list === null) return;
    if(previewDrop) {
      previewInsertion(event, key);
      return;
    }
    const top = pointerOf(event) - (axis === "horizontal" ? list.getBoundingClientRect().left : list.getBoundingClientRect().top) - grabOffset;
    state = {
      ...state,
      extreme: state.lastStep === 1 ? Math.max(state.extreme, top) : Math.min(state.extreme, top),
    };
    for(let guard = 0; guard < rows.value.length; guard++) {
      const from = rows.value.findIndex(row => row.key === key);
      const step = switchStep(top, slotStart(from), sizeAt(from - 1), sizeAt(from + 1), state, gap);
      if(step === 0) return;
      const next = move(rows.value, key, from + step);
      if(next === rows.value) return;
      showSwitched(rows.value[from + step].key);
      rows.value = next;
      state = { lastStep: step, extreme: top };
    }
  }

  function slotStart(index: number) {
    const currentScroll = list ? (axis === "horizontal" ? list.scrollLeft : list.scrollTop) : listScroll;
    return rows.value.slice(0, index).reduce((sum, row) => sum + (sizes.get(row.key) ?? 0) + gap, firstSlotStart) - (currentScroll - listScroll);
  }

  function sizeAt(index: number) {
    const row = rows.value[index];
    return row ? sizes.get(row.key) ?? null : null;
  }

  function gapBetween(boxes: DOMRect[]) {
    if(boxes.length < 2) return 0;
    const sizesBeforeLast = boxes.slice(0, -1).reduce((sum, box) => sum + sizeOf(box), 0);
    return Math.max(0, (startOf(boxes.at(-1)!) - startOf(boxes[0]) - sizesBeforeLast) / (boxes.length - 1));
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    const key = dragging.value;
    if(key === null || list === null || !(event.target instanceof Node) || !list.contains(event.target)) return;
    if(previewDrop) {
      const targetKey = insertionAfter.value;
      if(targetKey === null) return;
      const from = rows.value.findIndex(row => row.key === key);
      const target = rows.value.findIndex(row => row.key === targetKey);
      const to = from < target ? target : target + 1;
      const next = move(rows.value, key, to);
      if(next !== rows.value) {
        rows.value = next;
        save(next, key);
      }
      dropped = true;
      insertionAfter.value = null;
      return;
    }
    dropped = true;
    if(rows.value.map(row => row.key).join() !== beforeDrag.map(row => row.key).join()) save(rows.value, key);
  }

  function acceptDrop() {
    dropped = true;
    stopListening();
    dragging.value = null;
    insertionAfter.value = null;
    list = null;
    onEnd?.();
  }

  function previewInsertion(event: DragEvent, excludedKey?: string) {
    if(!previewDrop) return;
    const target = rows.value.find(row => {
      const element = elements.get(row.key);
      const content = element?.querySelector<HTMLElement>(".panel-content");
      if(!element || !content || row.key === excludedKey) return false;
      const contentBox = content.getBoundingClientRect();
      return event.clientX >= contentBox.left && event.clientX <= contentBox.right && event.clientY >= contentBox.top + contentBox.height / 2 && event.clientY <= contentBox.bottom;
    });
    if(target) {
      insertionAfter.value = target.key;
      return;
    }
    const lastRow = rows.value.at(-1);
    const lastElement = lastRow ? elements.get(lastRow.key) : null;
    const stack = lastElement?.parentElement;
    if(!lastRow || !lastElement || !stack || lastRow.key === excludedKey) {
      insertionAfter.value = null;
      return;
    }
    const lastBox = lastElement.getBoundingClientRect();
    const stackBox = stack.getBoundingClientRect();
    const overFreeSpace = event.clientX >= stackBox.left && event.clientX <= stackBox.right && event.clientY >= lastBox.bottom && event.clientY <= stackBox.bottom;
    insertionAfter.value = overFreeSpace ? lastRow.key : null;
  }

  function clearInsertion() {
    insertionAfter.value = null;
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if(event.key === "Escape") {
      dropped = false;
      dragEnd();
    }
  }

  function stopListening() {
    window.removeEventListener("dragover", dragOver);
    window.removeEventListener("drop", drop);
    window.removeEventListener("keydown", cancelOnEscape);
  }

  function dragEnd() {
    stopListening();
    if(!dropped) rows.value = beforeDrag;
    dragging.value = null;
    insertionAfter.value = null;
    list = null;
    armedKey = null;
    onEnd?.();
  }

  onBeforeUnmount(() => {
    stopListening();
    clearTimeout(switchTimer);
  });

  return { dragItem, dragging, switched, insertionAfter, previewInsertion, clearInsertion, showSwitched, acceptDrop };
}
