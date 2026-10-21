<script lang="ts">
const imageCache = new Map<string, { url: string; image: HTMLImageElement }>();
</script>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps<{ tileset: any; tile: number }>();
const emit = defineEmits<{ error: [message: string] }>();
const canvas = ref<HTMLCanvasElement | null>(null);

function loadImage() {
  const cached = imageCache.get(props.tileset.id);
  if(cached?.url === props.tileset.image) return Promise.resolve(cached.image);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      imageCache.set(props.tileset.id, { url: props.tileset.image, image });
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Unable to load tileset image '${props.tileset.name}'.`));
    image.src = props.tileset.image;
  });
}

async function draw() {
  await nextTick();
  if(!canvas.value) return;
  const { tileWidth, tileHeight, columns, margin = 0, spacing = 0 } = props.tileset;
  canvas.value.width = tileWidth;
  canvas.value.height = tileHeight;
  const context = canvas.value.getContext("2d");
  if(!context) return;
  context.clearRect(0, 0, tileWidth, tileHeight);
  try {
    const image = await loadImage();
    const sourceX = margin + (props.tile % columns) * (tileWidth + spacing);
    const sourceY = margin + Math.floor(props.tile / columns) * (tileHeight + spacing);
    context.drawImage(image, sourceX, sourceY, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
  } catch(error: any) {
    emit("error", error?.message ?? "Unable to load tileset image.");
  }
}

onMounted(draw);
watch(() => [props.tileset.image, props.tile], draw);
</script>

<template>
  <canvas ref="canvas" class="preview-canvas" />
</template>
