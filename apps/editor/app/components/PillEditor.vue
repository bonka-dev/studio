<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

type PillValue = string | number;

const props = withDefaults(defineProps<{
  modelValue: PillValue;
  id?: string;
  type?: "text" | "number";
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  options?: Array<{ label: string; value: PillValue }>;
}>(), {
  type: "text",
  placeholder: "Set value",
  disabled: false,
  options: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [value: PillValue];
  change: [value: PillValue];
}>();

const editing = ref(false);
const control = ref<HTMLInputElement | HTMLSelectElement | null>(null);
const label = computed(() => {
  if(props.options) return props.options.find(option => option.value === props.modelValue)?.label ?? "Select";
  return String(props.modelValue === "" ? props.placeholder : props.modelValue);
});

async function startEditing() {
  editing.value = true;
  await nextTick();
  control.value?.focus();
  if(control.value instanceof HTMLInputElement) control.value.select();
}

function finish(event: Event) {
  if(!editing.value) return;
  const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
  const nextValue = props.options
    ? props.options.find(option => String(option.value) === value)?.value ?? value
    : props.type === "number" ? Number(value) : value;
  editing.value = false;
  emit("update:modelValue", nextValue);
  emit("change", nextValue);
}

function handleKeydown(event: KeyboardEvent) {
  if(event.key === "Enter") {
    event.preventDefault();
    (event.target as HTMLElement).blur();
  }
  if(event.key === "Escape") {
    event.preventDefault();
    editing.value = false;
    (event.target as HTMLElement).blur();
  }
}
</script>

<template>
  <span class="pill-editor" :class="{ editing }">
    <button class="pill-edit-button" type="button" :disabled="disabled" @click="startEditing">{{ label }}</button>
    <select v-if="options" :id="id" ref="control" class="pill-edit-control" :value="modelValue" :disabled="disabled" :aria-label="ariaLabel" @change="finish" @blur="finish" @keydown="handleKeydown">
      <option v-for="option in options" :key="String(option.value)" :value="option.value">{{ option.label }}</option>
    </select>
    <input v-else :id="id" ref="control" class="pill-edit-control" :type="type" :value="modelValue" :placeholder="placeholder" :disabled="disabled" :aria-label="ariaLabel" @change="finish" @blur="finish" @keydown="handleKeydown">
  </span>
</template>
