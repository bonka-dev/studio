<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  definitions: any[];
  selectedId: string;
  sprites: any[];
  sourceUrls: Map<string, string>;
  instances: any[];
  inputMaps: any[];
  selectedInputMapId: string;
  historyEntries: { revision: number; label: string }[];
  historyIndex: number;
}>();

const emit = defineEmits<{
  create: [];
  select: [id: string];
  "update-name": [value: string | number];
  "update-sprite": [value: string | number];
  "update-sprite-mode": [value: string | number];
  "update-animation": [value: string | number];
  "update-directional-set": [value: string | number];
  "update-behavior": [value: string | number];
  "update-input-actions": [value: string | number];
  "add-directional-movement": [];
  "update-directional-movement": [patch: Record<string, string | number | boolean>];
  "update-collider": [patch: { width?: number; height?: number }];
  "add-input-map": [];
  "select-input-map": [id: string];
  "update-input-map": [inputMap: any, label: string];
  "open-instance": [id: string];
  "go-to-history": [index: number];
}>();

const activeTab = ref<"definitions" | "input">("definitions");
const selected = computed(() => props.definitions.find(definition => definition.id === props.selectedId) ?? null);
const sprite = computed(() => selected.value?.components.sprite
  ? props.sprites.find(item => item.id === selected.value.components.sprite.asset) ?? null
  : null);
const references = computed(() => props.instances.filter(instance => instance.definition === props.selectedId));
const selectedInputMap = computed(() => props.inputMaps.find(inputMap => inputMap.id === props.selectedInputMapId) ?? null);
const directionalParameters = computed(() => selected.value?.components.behavior?.parameters ?? {});
const controls = ["up", "down", "left", "right", "a", "b", "l", "r", "start", "select"];
const triggers = ["held", "pressed", "released"];

function formatId(value: string, fallback: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function updateInputMap(transform: (inputMap: any) => void, label: string) {
  if(!selectedInputMap.value) return;
  const inputMap = structuredClone(selectedInputMap.value);
  transform(inputMap);
  emit("update-input-map", inputMap, label);
}

function addAction() {
  updateInputMap(inputMap => {
    const used = new Set(inputMap.actions.map((action: any) => action.id));
    let index = inputMap.actions.length + 1;
    while(used.has(`action-${index}`)) index++;
    inputMap.actions.push({ id: `action-${index}`, bindings: [{ platform: "gba", control: "a", trigger: "pressed" }] });
  }, "Add input action");
}

function renameAction(index: number, value: string | number) {
  updateInputMap(inputMap => {
    const used = new Set(inputMap.actions.filter((_: any, actionIndex: number) => actionIndex !== index).map((action: any) => action.id));
    const base = formatId(String(value), `action-${index + 1}`);
    let id = base;
    for(let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    inputMap.actions[index].id = id;
  }, "Rename input action");
}

function removeAction(index: number) {
  updateInputMap(inputMap => { inputMap.actions.splice(index, 1); }, "Remove input action");
}

function addBinding(actionIndex: number) {
  updateInputMap(inputMap => { inputMap.actions[actionIndex].bindings.push({ platform: "gba", control: "a", trigger: "pressed" }); }, "Add input binding");
}

function updateBinding(actionIndex: number, bindingIndex: number, patch: Record<string, string>) {
  updateInputMap(inputMap => Object.assign(inputMap.actions[actionIndex].bindings[bindingIndex], patch), "Edit input binding");
}

function removeBinding(actionIndex: number, bindingIndex: number) {
  updateInputMap(inputMap => {
    if(inputMap.actions[actionIndex].bindings.length > 1) inputMap.actions[actionIndex].bindings.splice(bindingIndex, 1);
  }, "Remove input binding");
}

function directionalSets(asset: string) {
  return props.sprites.find(sprite => sprite.id === asset)?.directionalSets ?? [];
}
</script>

<template>
  <section class="workspace-layout entities-workspace" aria-label="Entities and input maps">
    <aside class="workspace-stack workspace-region--left" aria-label="Entity resources">
      <EditorPanel title="Entities" :collapsible="false" class="entity-library">
        <div class="entity-workspace-tabs" role="tablist" aria-label="Entity workspace sections">
          <button class="action" :class="{ primary: activeTab === 'definitions' }" type="button" role="tab" :aria-selected="activeTab === 'definitions'" @click="activeTab = 'definitions'">Definitions</button>
          <button class="action" :class="{ primary: activeTab === 'input' }" type="button" role="tab" :aria-selected="activeTab === 'input'" @click="activeTab = 'input'">Input Map</button>
        </div>
        <template v-if="activeTab === 'definitions'">
          <button class="action primary entity-create" type="button" @click="emit('create')">New definition</button>
          <div class="entity-definition-list" role="listbox" aria-label="Entity definitions">
            <button v-for="definition in definitions" :key="definition.id" class="entity-definition-row" :class="{ active: definition.id === selectedId }" type="button" role="option" :aria-selected="definition.id === selectedId" @click="emit('select', definition.id)">
              <strong>{{ definition.name }}</strong><span>{{ definition.id }}</span>
            </button>
            <p v-if="!definitions.length" class="empty-note">Create a generic definition to describe a reusable scene entity.</p>
          </div>
        </template>
        <template v-else>
          <button class="action primary entity-create" type="button" @click="emit('add-input-map')">New input map</button>
          <div class="entity-definition-list" role="listbox" aria-label="Input maps">
            <button v-for="inputMap in inputMaps" :key="inputMap.id" class="entity-definition-row" :class="{ active: inputMap.id === selectedInputMapId }" type="button" role="option" :aria-selected="inputMap.id === selectedInputMapId" @click="emit('select-input-map', inputMap.id)">
              <strong>{{ inputMap.name }}</strong><span>{{ inputMap.id }}</span>
            </button>
            <p v-if="!inputMaps.length" class="empty-note">Create an input map to bind generic actions to GBA controls.</p>
          </div>
        </template>
      </EditorPanel>
    </aside>

    <EditorPanel v-if="activeTab === 'definitions' && selected" :title="selected.name" :collapsible="false" class="workspace-region--main entity-component-editor">
      <div class="entity-editor-heading"><div><p class="eyebrow">Entity definition</p><h2>{{ selected.name }}</h2></div><code>{{ selected.id }}</code></div>
      <div class="entity-component-grid">
        <section class="entity-component-card">
          <h3>Identity</h3>
          <label class="field field-stack"><span>Display name</span><PillEditor :model-value="selected.name" aria-label="Entity definition name" @change="emit('update-name', $event)" /></label>
          <div class="context-row"><span>Format ID</span><strong>{{ selected.id }}</strong></div>
        </section>
        <section class="entity-component-card entity-presentation-card">
          <h3>Sprite presentation</h3>
          <div v-if="sprite" class="entity-sprite-preview"><img :src="sourceUrls.get(`sprite:${sprite.id}`) ?? sprite.source" :alt="`${sprite.id} sprite sheet`"></div>
          <label class="field field-stack"><span>Sprite asset</span><PillEditor :model-value="selected.components.sprite?.asset ?? ''" aria-label="Entity sprite asset" :options="[{ label: 'No sprite', value: '' }, ...sprites.map(item => ({ label: item.name ?? item.id, value: item.id }))]" @change="emit('update-sprite', $event)" /></label>
          <template v-if="selected.components.sprite && sprite">
            <label class="field field-stack"><span>Animation mode</span><PillEditor :model-value="selected.components.sprite.directionalSet ? 'directional' : 'clip'" aria-label="Entity animation mode" :options="[{ label: 'Single clip', value: 'clip' }, { label: 'Directional set', value: 'directional' }]" @change="emit('update-sprite-mode', $event)" /></label>
            <label v-if="selected.components.sprite.animation" class="field field-stack"><span>Animation</span><PillEditor :model-value="selected.components.sprite.animation" aria-label="Entity sprite animation" :options="Object.keys(sprite.animations ?? {}).map(id => ({ label: id, value: id }))" @change="emit('update-animation', $event)" /></label>
            <label v-if="selected.components.sprite.directionalSet" class="field field-stack"><span>Directional set</span><PillEditor :model-value="selected.components.sprite.directionalSet" aria-label="Entity directional animation set" :options="(sprite.directionalSets ?? []).map((set: any) => ({ label: set.id, value: set.id }))" @change="emit('update-directional-set', $event)" /></label>
          </template>
        </section>
        <section class="entity-component-card">
          <h3>Behavior</h3>
          <label class="field field-stack"><span>Behavior ID</span><PillEditor :model-value="selected.components.behavior?.id ?? ''" placeholder="No behavior" aria-label="Entity behavior ID" @change="emit('update-behavior', $event)" /></label>
          <label v-if="selected.components.behavior" class="field field-stack"><span>Input actions</span><PillEditor :model-value="(selected.components.behavior.inputActions ?? []).join(', ')" placeholder="Comma-separated action IDs" aria-label="Entity input actions" @change="emit('update-input-actions', $event)" /></label>
          <p class="entity-help">Behavior IDs, action subscriptions, and scalar parameters remain opaque project data.</p>
        </section>
        <section class="entity-component-card directional-movement-card">
          <h3>Directional Movement</h3>
          <template v-if="selected.components.behavior?.id === 'directional-movement'">
            <div class="field-pair">
              <label class="field field-stack"><span>Movement space</span><PillEditor :model-value="directionalParameters.movementSpace ?? 'screen'" aria-label="Movement space" :options="[{ label: 'Screen', value: 'screen' }, { label: 'Isometric', value: 'isometric' }]" @change="emit('update-directional-movement', { movementSpace: String($event) })" /></label>
              <label class="field field-stack"><span>Speed</span><PillEditor :model-value="directionalParameters.speed ?? 1" type="number" aria-label="Movement speed" @change="emit('update-directional-movement', { speed: Math.max(Number($event) || 1, 0.001) })" /></label>
            </div>
            <label class="checkbox-row"><input type="checkbox" :checked="directionalParameters.normalizeDiagonal !== false" @change="emit('update-directional-movement', { normalizeDiagonal: ($event.target as HTMLInputElement).checked })"> Normalize diagonal movement</label>
            <label class="field field-stack"><span>Idle asset</span><PillEditor :model-value="directionalParameters.idleAsset ?? ''" aria-label="Idle sprite asset" :options="[{ label: 'None', value: '' }, ...sprites.map(item => ({ label: item.name ?? item.id, value: item.id }))]" @change="emit('update-directional-movement', { idleAsset: String($event), idleSet: directionalSets(String($event))[0]?.id ?? '' })" /></label>
            <label class="field field-stack"><span>Idle directional set</span><PillEditor :model-value="directionalParameters.idleSet ?? ''" aria-label="Idle directional set" :options="[{ label: 'None', value: '' }, ...directionalSets(directionalParameters.idleAsset ?? '').map((set: any) => ({ label: set.id, value: set.id }))]" @change="emit('update-directional-movement', { idleSet: String($event) })" /></label>
            <label class="field field-stack"><span>Moving asset</span><PillEditor :model-value="directionalParameters.movingAsset ?? ''" aria-label="Moving sprite asset" :options="[{ label: 'None', value: '' }, ...sprites.map(item => ({ label: item.name ?? item.id, value: item.id }))]" @change="emit('update-directional-movement', { movingAsset: String($event), movingSet: directionalSets(String($event))[0]?.id ?? '' })" /></label>
            <label class="field field-stack"><span>Moving directional set</span><PillEditor :model-value="directionalParameters.movingSet ?? ''" aria-label="Moving directional set" :options="[{ label: 'None', value: '' }, ...directionalSets(directionalParameters.movingAsset ?? '').map((set: any) => ({ label: set.id, value: set.id }))]" @change="emit('update-directional-movement', { movingSet: String($event) })" /></label>
          </template>
          <template v-else>
            <p class="entity-help">Configure four action subscriptions and provider-defined scalar parameters on this reusable definition.</p>
            <button class="action primary" type="button" @click="emit('add-directional-movement')">Add Directional Movement</button>
          </template>
        </section>
        <section class="entity-component-card">
          <h3>Box collider</h3>
          <div class="field-pair">
            <label class="field field-stack"><span>Width</span><PillEditor :model-value="selected.components.collider?.width ?? 1" type="number" aria-label="Collider width" @change="emit('update-collider', { width: Number($event) })" /></label>
            <label class="field field-stack"><span>Height</span><PillEditor :model-value="selected.components.collider?.height ?? 1" type="number" aria-label="Collider height" @change="emit('update-collider', { height: Number($event) })" /></label>
          </div>
        </section>
      </div>
    </EditorPanel>

    <EditorPanel v-else-if="activeTab === 'input' && selectedInputMap" :title="selectedInputMap.name" :collapsible="false" class="workspace-region--main entity-component-editor input-map-editor">
      <div class="entity-editor-heading"><div><p class="eyebrow">Selected project input map</p><h2>{{ selectedInputMap.name }}</h2></div><code>{{ selectedInputMap.id }}</code></div>
      <label class="field field-stack"><span>Display name</span><PillEditor :model-value="selectedInputMap.name" aria-label="Input map name" @change="updateInputMap(inputMap => { inputMap.name = String($event).trim() || inputMap.name; }, 'Rename input map')" /></label>
      <div class="input-action-list">
        <section v-for="(action, actionIndex) in selectedInputMap.actions" :key="`${action.id}-${actionIndex}`" class="entity-component-card input-action-card">
          <div class="input-action-heading"><label class="field field-stack"><span>Action ID</span><PillEditor :model-value="action.id" aria-label="Input action ID" @change="renameAction(actionIndex, $event)" /></label><button class="action danger" type="button" @click="removeAction(actionIndex)">Remove action</button></div>
          <div v-for="(binding, bindingIndex) in action.bindings" :key="bindingIndex" class="input-binding-row">
            <span class="binding-platform">GBA</span>
            <select :value="binding.control" :aria-label="`${action.id} GBA control`" @change="updateBinding(actionIndex, bindingIndex, { control: ($event.target as HTMLSelectElement).value })"><option v-for="control in controls" :key="control" :value="control">{{ control }}</option></select>
            <select :value="binding.trigger" :aria-label="`${action.id} trigger`" @change="updateBinding(actionIndex, bindingIndex, { trigger: ($event.target as HTMLSelectElement).value })"><option v-for="trigger in triggers" :key="trigger" :value="trigger">{{ trigger }}</option></select>
            <button class="action danger" type="button" :disabled="action.bindings.length === 1" @click="removeBinding(actionIndex, bindingIndex)">Remove</button>
          </div>
          <button class="action" type="button" @click="addBinding(actionIndex)">Add binding</button>
        </section>
      </div>
      <button class="action primary" type="button" @click="addAction">Add action</button>
      <p class="entity-help">This resource maps generic action IDs only to GBA digital controls and triggers. Subscribed IDs remain stable until their entity definitions unsubscribe.</p>
    </EditorPanel>
    <div v-else class="workspace-region--main entity-empty-state"><p>Select or create a {{ activeTab === 'input' ? 'input map' : 'definition' }}.</p></div>

    <aside class="workspace-stack workspace-region--right" aria-label="Entity references and history">
      <EditorPanel v-if="activeTab === 'definitions'" title="Scene references" :collapsible="false">
        <dl class="entity-summary"><div><dt>Definitions</dt><dd>{{ definitions.length }}</dd></div><div><dt>Selected uses</dt><dd>{{ references.length }}</dd></div></dl>
        <div class="entity-reference-list">
          <button v-for="instance in references" :key="instance.id" class="entity-reference" type="button" @click="emit('open-instance', instance.id)"><strong>{{ instance.id }}</strong><span>cell {{ instance.x }}, {{ instance.y }}</span></button>
          <p v-if="selected && !references.length" class="empty-note">This definition is not placed in the current scene.</p>
        </div>
      </EditorPanel>
      <EditorPanel v-else title="Input boundary" :collapsible="false"><p class="entity-help">The selected map is stored in <code>project.inputMap</code>. Actions are generic; bindings are explicitly GBA-only.</p></EditorPanel>
      <HistoryPanel :entries="historyEntries" :current-index="historyIndex" @go-to="emit('go-to-history', $event)" />
    </aside>
  </section>
</template>
