<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  metatiles: any[];
  prefabs: any[];
  tilesets: any[];
  selectedMetatileId: string | null;
  selectedPrefabId: string | null;
}>();
const emit = defineEmits<{ "select-metatile": [id: string]; "select-prefab": [id: string] }>();
const mode = ref<"prefabs" | "metatiles">("prefabs");
const tabs = [{ id: "prefabs", label: "Prefabs" }, { id: "metatiles", label: "Metatiles" }];
const resources = computed(() => mode.value === "prefabs" ? props.prefabs : props.metatiles);
</script>

<template>
  <EditorPanel title="Map resources" class="map-resource-palette" :tabs="tabs" :active-tab="mode" @update:active-tab="mode = $event as 'prefabs' | 'metatiles'">
    <div class="resource-list" role="list">
      <template v-if="mode === 'prefabs'">
        <button v-for="prefab in resources" :key="prefab.id" class="resource-button" :class="{ selected: prefab.id === selectedPrefabId }" type="button" @click="$emit('select-prefab', prefab.id)">
          <span>{{ prefab.name }}</span><small>{{ prefab.columns }}x{{ prefab.rows }}</small>
        </button>
        <p v-if="!resources.length" class="empty-note">Create Prefabs in Tiles.</p>
      </template>
      <template v-else>
        <button v-for="metatile in resources" :key="metatile.id" class="resource-button" :class="{ selected: metatile.id === selectedMetatileId }" type="button" @click="$emit('select-metatile', metatile.id)">
          <MetatilePreview :metatile="metatile" :tilesets="tilesets" />
          <span>{{ metatile.name }}</span>
        </button>
        <p v-if="!resources.length" class="empty-note">Create Metatiles in Tiles.</p>
      </template>
    </div>
  </EditorPanel>
</template>
