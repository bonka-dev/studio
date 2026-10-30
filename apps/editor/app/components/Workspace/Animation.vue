<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useWorkspaceDockLayout } from "../../composables/use-workspace-dock-layout";

const props = defineProps<{ sprites: any[]; selectedId: string; sourceUrls: Map<string, string>; busy?: boolean }>();
const emit = defineEmits(["import", "create", "select", "update", "rename", "rename-animation", "remove-animation", "rename-directional-set", "remove-directional-set", "remove-sprite"]);
const selected = computed(() => props.sprites.find(sprite => sprite.id === props.selectedId) ?? null);
const layout = computed(() => selected.value?.layout);
const previewAnimationId = ref("");
const previewFrameOffset = ref(0);
const previewPlaying = ref(false);
const previewSpeed = ref(1);
const selectedDirectionalSetId = ref("");
const dockPanels = computed(() => [
  { id: "preview", label: "Animation Preview", class: "sprite-preview-panel" },
  { id: "library", label: "Sprites", class: "sprite-library" },
  { id: "settings", label: `${previewAnimationId.value} Settings`, class: "sprite-inspector" },
  { id: "animations", label: "Animations", class: "sprite-animations-panel" },
  { id: "directions", label: "Directional sets", class: "sprite-directional-panel" },
]);
const dockLayout = useWorkspaceDockLayout("bonka.workspace-layout.animation.v1", {
  left: [{ key: "preview", tabs: ["preview"] }, { key: "library", tabs: ["library"] }],
  right: [{ key: "settings", tabs: ["settings"] }, { key: "animations", tabs: ["animations"] }, { key: "directions", tabs: ["directions"] }],
});
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const frames = computed(() => {
  const currentLayout = selected.value?.animations[previewAnimationId.value]?.layout ?? selected.value?.layout;
  if(!currentLayout) return [];
  return Array.from({ length: currentLayout.columns * currentLayout.rows }, (_, index) => index);
});
const warning = computed(() => {
  if(!selected.value) return "";
  const { width, height } = selected.value.frameSize;
  return width % 8 || height % 8 ? "Frame size is not aligned to the GBA 8px tile grid." : "";
});
const previewAnimation = computed(() => {
  if(!selected.value) return null;
  return selected.value.animations[previewAnimationId.value] ?? null;
});
const directionalSets = computed(() => selected.value?.directionalSets ?? []);
const selectedDirectionalSet = computed(() => directionalSets.value.find((set: any) => set.id === selectedDirectionalSetId.value) ?? null);
const activeLayout = computed(() => {
  if(!selected.value) return null;
  return selected.value.animations[previewAnimationId.value]?.layout ?? selected.value.layout;
});
const previewFrame = computed(() => previewAnimation.value?.frames[previewFrameOffset.value] ?? null);
const previewViewportStyle = computed(() => selected.value ? {
  width: `${selected.value.frameSize.width * 4}px`,
  height: `${selected.value.frameSize.height * 4}px`,
} : {});
const previewImageStyle = computed(() => {
  if(!selected.value || !activeLayout.value || !previewFrame.value) return {};
  const frame = previewFrame.value.index;
  const x = activeLayout.value.margin.x + (frame % activeLayout.value.columns) * (selected.value.frameSize.width + activeLayout.value.spacing.x);
  const y = activeLayout.value.margin.y + Math.floor(frame / activeLayout.value.columns) * (selected.value.frameSize.height + activeLayout.value.spacing.y);
  return {
    width: `${activeLayout.value.imageWidth * 4}px`,
    height: `${activeLayout.value.imageHeight * 4}px`,
    left: `${-x * 4}px`,
    top: `${-y * 4}px`,
  };
});

function stopPreview() {
  if(previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
}

function playNextFrame() {
  const animation = previewAnimation.value;
  const frame = previewFrame.value;
  if(!previewPlaying.value || !animation || !frame) return;
  previewTimer = setTimeout(() => {
    const next = previewFrameOffset.value + 1;
    if(next < animation.frames.length) {
      previewFrameOffset.value = next;
      playNextFrame();
    } else if(animation.loop) {
      previewFrameOffset.value = 0;
      playNextFrame();
    } else {
      previewPlaying.value = false;
    }
  }, Math.max(1, frame.duration) * 1000 / 60 / previewSpeed.value);
}

function restartPreview() {
  stopPreview();
  if(!selected.value) return;
  if(!selected.value.animations[previewAnimationId.value]) {
    previewAnimationId.value = Object.keys(selected.value.animations)[0] ?? "";
  }
  previewFrameOffset.value = 0;
  if(previewPlaying.value) playNextFrame();
}

function togglePreview() {
  previewPlaying.value = !previewPlaying.value;
  if(previewPlaying.value) playNextFrame();
  else stopPreview();
}

function resetPreview() {
  stopPreview();
  previewFrameOffset.value = 0;
}

function endPreview() {
  const animation = previewAnimation.value;
  if(!animation?.frames.length) return;
  stopPreview();
  previewPlaying.value = false;
  previewFrameOffset.value = animation.frames.length - 1;
}

function stepPreview(direction: -1 | 1) {
  const animation = previewAnimation.value;
  if(!animation?.frames.length) return;
  stopPreview();
  previewPlaying.value = false;
  previewFrameOffset.value = (previewFrameOffset.value + direction + animation.frames.length) % animation.frames.length;
}

watch(() => [selected.value, previewAnimationId.value], restartPreview);
watch(directionalSets, sets => {
  if(!sets.some((set: any) => set.id === selectedDirectionalSetId.value)) {
    selectedDirectionalSetId.value = sets[0]?.id ?? "";
  }
}, { immediate: true });
watch(previewSpeed, () => {
  if(previewPlaying.value) {
    stopPreview();
    playNextFrame();
  }
});
onMounted(restartPreview);
onBeforeUnmount(stopPreview);

function patch(path: string, value: string | number | boolean) {
  if(!selected.value) return;
  const next = structuredClone(selected.value);
  const animationId = previewAnimationId.value;
  const animationLayout = next.animations[animationId].layout ??= structuredClone(next.layout);
  const targetPath = path.startsWith("layout.") ? path.slice("layout.".length) : path;
  const target = targetPath.split(".").reduce((current, key, index, parts) => index === parts.length - 1 ? current : current[key], path.startsWith("layout.") ? animationLayout : next);
  target[targetPath.split(".").at(-1)!] = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if(path === "layout.columns" || path === "layout.rows") {
    const capacity = animationLayout.columns * animationLayout.rows;
    // A grid defines the imported frame set; update its count so each box is addressable.
    const animation = next.animations[animationId];
    const duration = animation.frames[0]?.duration ?? 8;
    animation.frames = Array.from({ length: capacity }, (_, index) => ({ index, duration }));
  }
  emit("update", next);
}

function addAnimation() {
  if(!selected.value) return;
  const name = window.prompt("Animation name", "animation");
  if(!name) return;
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if(!id || selected.value.animations[id]) return;
  const next = structuredClone(selected.value);
  const sourceAnimation = next.animations[previewAnimationId.value];
  const layout = structuredClone(sourceAnimation?.layout ?? next.layout);
  const duration = sourceAnimation?.frames[0]?.duration ?? 8;
  next.animations[id] = {
    loop: true,
    frames: Array.from({ length: layout.columns * layout.rows }, (_, index) => ({ index, duration })),
    layout,
  };
  emit("update", next);
}

function setGbaMode(value: string) {
  if(!selected.value) return;
  const next = structuredClone(selected.value);
  next.gba.colors = Number(value);
  next.gba.bpp = Number(value) === 16 ? 4 : 8;
  emit("update", next);
}

function patchAnimation(id: string, patch: Record<string, unknown>) {
  if(!selected.value) return;
  const next = structuredClone(selected.value);
  Object.assign(next.animations[id], patch);
  emit("update", next);
}

function renameAnimation(from: string, value: string | number) {
  const to = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if(!to || to === from || !selected.value || selected.value.animations[to]) return;
  previewAnimationId.value = to;
  emit("rename-animation", { spriteId: selected.value.id, from, to });
}

function removeAnimation(id: string) {
  if(!selected.value || Object.keys(selected.value.animations).length === 1) return;
  emit("remove-animation", { spriteId: selected.value.id, animationId: id });
}

function updateDirectionalSets(update: (sets: any[]) => void) {
  if(!selected.value) return;
  const next = structuredClone(selected.value);
  next.directionalSets ??= [];
  update(next.directionalSets);
  emit("update", next);
}

function addDirectionalSet() {
  if(!selected.value) return;
  const name = window.prompt("Directional set name", "idle");
  const id = name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if(!id || directionalSets.value.some((set: any) => set.id === id)) return;
  updateDirectionalSets(sets => sets.push({ id, variants: [{ angle: 0, animation: previewAnimationId.value || Object.keys(selected.value.animations)[0] }] }));
  selectedDirectionalSetId.value = id;
}

function renameDirectionalSet(from: string, value: string | number) {
  const to = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if(!to || to === from || directionalSets.value.some((set: any) => set.id === to)) return;
  emit("rename-directional-set", { spriteId: selected.value.id, from, to });
  selectedDirectionalSetId.value = to;
}

function removeDirectionalSet(id: string) {
  if(selected.value) emit("remove-directional-set", { spriteId: selected.value.id, setId: id });
}

function addDirectionalVariant() {
  const set = selectedDirectionalSet.value;
  if(!set || !selected.value) return;
  updateDirectionalSets(sets => {
    const next = sets.find(set => set.id === selectedDirectionalSetId.value);
    const angle = Math.round(360 * next.variants.length / (next.variants.length + 1)) % 360;
    next.variants.push({ angle, animation: previewAnimationId.value || Object.keys(selected.value.animations)[0] });
  });
}

function updateDirectionalVariant(index: number, patch: Record<string, unknown>) {
  updateDirectionalSets(sets => Object.assign(sets.find(set => set.id === selectedDirectionalSetId.value).variants[index], patch));
}

function updateDirectionalVariantLabel(index: number, value: string | number) {
  updateDirectionalSets(sets => {
    const variant = sets.find(set => set.id === selectedDirectionalSetId.value).variants[index];
    const label = String(value).trim();
    if(label) variant.label = label;
    else delete variant.label;
  });
}

function removeDirectionalVariant(index: number) {
  updateDirectionalSets(sets => {
    const variants = sets.find(set => set.id === selectedDirectionalSetId.value).variants;
    if(variants.length > 1) variants.splice(index, 1);
  });
}

function distributeDirectionalVariants() {
  updateDirectionalSets(sets => {
    const variants = sets.find(set => set.id === selectedDirectionalSetId.value).variants;
    variants.forEach((variant: any, index: number) => { variant.angle = Math.round(index * 360 / variants.length) % 360; });
  });
}

function directionStyle(angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { left: `${50 + Math.cos(radians) * 39}%`, top: `${50 + Math.sin(radians) * 39}%` };
}

</script>

<template>
  <section class="workspace-layout animation-editor" aria-label="Animation editor">
    <WorkspaceDocks :panels="dockPanels" :layout="dockLayout" left-label="Sprite resources" right-label="Animation settings">
      <template #preview>
        <div v-if="selected && layout && activeLayout" class="sprite-preview">
          <template v-if="previewAnimation && previewFrame">
            <div class="sprite-preview-frame" :style="previewViewportStyle"><img :src="sourceUrls.get(`sprite:${selected.id}`)" alt="" :style="previewImageStyle" /></div>
            <small>Frame {{ previewFrame.index }} · {{ previewFrame.duration }} ticks</small>
            <div class="sprite-preview-controls">
            <label>Animation<PillEditor :model-value="previewAnimationId" aria-label="Preview animation" :options="Object.keys(selected.animations).map(id => ({ label: id, value: id }))" @change="previewAnimationId = String($event)" /></label>
            <button class="action icon-action" type="button" aria-label="Go to first frame" title="Go to first frame" @click="resetPreview"><EditorIcon name="skip-start" /></button>
            <button class="action icon-action" type="button" aria-label="Previous frame" title="Previous frame" @click="stepPreview(-1)"><EditorIcon name="previous" /></button>
            <button class="action icon-action" type="button" :aria-label="previewPlaying ? 'Pause preview' : 'Play preview'" :title="previewPlaying ? 'Pause preview' : 'Play preview'" @click="togglePreview"><EditorIcon :name="previewPlaying ? 'pause' : 'play'" /></button>
            <button class="action icon-action" type="button" aria-label="Next frame" title="Next frame" @click="stepPreview(1)"><EditorIcon name="next" /></button>
            <button class="action icon-action" type="button" aria-label="Go to last frame" title="Go to last frame" @click="endPreview"><EditorIcon name="skip-end" /></button>
              <label>Speed<PillEditor :model-value="previewSpeed" aria-label="Preview speed" :options="[{ label: '0.25x', value: .25 }, { label: '0.5x', value: .5 }, { label: '1x', value: 1 }, { label: '2x', value: 2 }, { label: '4x', value: 4 }]" @change="previewSpeed = Number($event)" /></label>
            </div>
          </template>
        </div>
      </template>
      <template #library><SpriteLibraryPanel :sprites="sprites" :selected-id="selectedId" :source-urls="sourceUrls" :busy="busy" @import="emit('import', $event)" @create="emit('create')" @remove="emit('remove-sprite', $event)" @rename="(id, name) => emit('rename', id, name)" @select="emit('select', $event)" /></template>
      <template #settings>
        <div v-if="selected && layout && activeLayout" class="sprite-fields">
          <label>Cell width<PillEditor :model-value="selected.frameSize.width" type="number" aria-label="Frame width" @change="patch('frameSize.width', $event)" /></label>
          <label>Cell height<PillEditor :model-value="selected.frameSize.height" type="number" aria-label="Frame height" @change="patch('frameSize.height', $event)" /></label>
          <label>Columns<PillEditor :model-value="activeLayout.columns" type="number" aria-label="Columns" @change="patch('layout.columns', $event)" /></label>
          <label>Rows<PillEditor :model-value="activeLayout.rows" type="number" aria-label="Rows" @change="patch('layout.rows', $event)" /></label>
          <label>Margin X<PillEditor :model-value="activeLayout.margin.x" type="number" aria-label="Margin X" @change="patch('layout.margin.x', $event)" /></label>
          <label>Margin Y<PillEditor :model-value="activeLayout.margin.y" type="number" aria-label="Margin Y" @change="patch('layout.margin.y', $event)" /></label>
          <label>Spacing X<PillEditor :model-value="activeLayout.spacing.x" type="number" aria-label="Spacing X" @change="patch('layout.spacing.x', $event)" /></label>
          <label>Spacing Y<PillEditor :model-value="activeLayout.spacing.y" type="number" aria-label="Spacing Y" @change="patch('layout.spacing.y', $event)" /></label>
          <label>Colors<PillEditor :model-value="selected.gba.colors" aria-label="Colors" :options="[{ label: '16 / 4 bpp', value: 16 }, { label: '256 / 8 bpp', value: 256 }]" @change="setGbaMode(String($event))" /></label>
        </div>
      </template>
      <template #animations>
        <div v-if="selected && layout && activeLayout" class="sprite-animations">
          <div class="layer-actions sprite-animations-title"><button class="action primary" type="button" @click="addAnimation">Add Animation</button></div>
          <section v-for="(animation, id) in selected.animations" :key="id" class="sprite-animation">
            <label class="field sprite-animation-header"><span>Name</span><PillEditor :model-value="String(id)" :aria-label="`${id} animation name`" @change="renameAnimation(String(id), $event)" /></label>
            <div class="sprite-animation-actions">
              <div class="sprite-animation-icons"><button class="action icon-action loop-action" :class="{ active: animation.loop }" type="button" title="Loop" aria-label="Toggle loop" @click="patchAnimation(String(id), { loop: !animation.loop })"><EditorIcon name="repeat" /></button><button class="action danger icon-action" type="button" :disabled="Object.keys(selected.animations).length === 1" :aria-label="`Delete ${id}`" :title="`Delete ${id}`" @click="removeAnimation(String(id))"><EditorIcon name="trash" /></button></div>
              <PillEditor :model-value="animation.frames.map((frame: any) => `${frame.index}:${frame.duration}`).join(', ')" :aria-label="`${id} frames`" @change="patchAnimation(String(id), { frames: String($event).split(',').map(item => item.trim().split(':')).filter(parts => parts.length === 2).map(parts => ({ index: Number(parts[0]), duration: Number(parts[1]) })) })" />
            </div>
          </section>
        </div>
      </template>
      <template #directions>
        <div v-if="selected && layout && activeLayout" class="sprite-directional">
          <div class="layer-actions sprite-animations-title"><button class="action primary" type="button" @click="addDirectionalSet">Add set</button></div>
          <label v-if="directionalSets.length" class="field sprite-animation-header"><span>Active set</span><PillEditor :model-value="selectedDirectionalSetId" aria-label="Active directional set" :options="directionalSets.map((set: any) => ({ label: set.id, value: set.id }))" @change="selectedDirectionalSetId = String($event)" /></label>
          <template v-if="selectedDirectionalSet">
            <label class="field sprite-animation-header"><span>Name</span><PillEditor :model-value="selectedDirectionalSet.id" aria-label="Directional set name" @change="renameDirectionalSet(selectedDirectionalSet.id, $event)" /></label>
            <div class="direction-wheel" aria-label="Directional set preview"><button v-for="variant in selectedDirectionalSet.variants" :key="`${variant.angle}-${variant.animation}`" class="direction-wheel-point" type="button" :style="directionStyle(variant.angle)" :title="`${variant.angle}°: ${variant.animation}`" @click="previewAnimationId = variant.animation">{{ variant.angle }}°</button></div>
            <p class="direction-wheel-note">0° up · 90° right · angles increase clockwise</p>
            <div class="directional-actions"><button class="action" type="button" @click="addDirectionalVariant">Add direction</button><button class="action" type="button" @click="distributeDirectionalVariants">Distribute evenly</button><button class="action danger" type="button" @click="removeDirectionalSet(selectedDirectionalSet.id)">Delete set</button></div>
            <section v-for="(variant, index) in selectedDirectionalSet.variants" :key="`${variant.angle}-${index}`" class="directional-variant">
              <label>Clip<PillEditor :model-value="variant.animation" :aria-label="`Direction ${index + 1} clip`" :options="Object.keys(selected.animations).map(id => ({ label: id, value: id }))" @change="updateDirectionalVariant(index, { animation: String($event) })" /></label>
              <label>Angle<PillEditor :model-value="variant.angle" type="number" :aria-label="`Direction ${index + 1} angle`" @change="updateDirectionalVariant(index, { angle: Number($event) })" /></label>
              <label>Label<PillEditor :model-value="variant.label ?? ''" :aria-label="`Direction ${index + 1} label`" @change="updateDirectionalVariantLabel(index, $event)" /></label>
              <button class="action danger icon-action" type="button" :disabled="selectedDirectionalSet.variants.length === 1" :aria-label="`Delete direction ${index + 1}`" @click="removeDirectionalVariant(index)"><EditorIcon name="trash" /></button>
            </section>
          </template>
          <p v-else class="empty-note">Add a set to map clips to any number of directions.</p>
        </div>
      </template>
    </WorkspaceDocks>
    <template v-if="selected && layout && activeLayout">
      <EditorPanel :title="selected.id" :collapsible="false" class="sprite-sheet workspace-region--main">
        <p class="sprite-summary">{{ selected.frameCount }} frames</p>
        <div class="sprite-image-scroll"><div class="sprite-image" :style="{ aspectRatio: `${activeLayout.imageWidth} / ${activeLayout.imageHeight}` }">
           <img :src="sourceUrls.get(`sprite:${selected.id}`)" :alt="`${selected.id} sprite sheet`" />
          <span v-for="frame in frames" :key="frame" class="sprite-frame" :style="{ left: `${(activeLayout.margin.x + (frame % activeLayout.columns) * (selected.frameSize.width + activeLayout.spacing.x)) / activeLayout.imageWidth * 100}%`, top: `${(activeLayout.margin.y + Math.floor(frame / activeLayout.columns) * (selected.frameSize.height + activeLayout.spacing.y)) / activeLayout.imageHeight * 100}%`, width: `${selected.frameSize.width / activeLayout.imageWidth * 100}%`, height: `${selected.frameSize.height / activeLayout.imageHeight * 100}%` }">{{ frame }}</span>
        </div></div>
        <p v-if="warning" class="sprite-warning">{{ warning }}</p>
       </EditorPanel>
    </template>
    <p v-else class="empty-note workspace-region--main">Import a PNG sprite sheet to begin.</p>
  </section>
</template>
