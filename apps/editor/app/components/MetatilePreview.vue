<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps<{ metatile: any; tilesets: any[] }>();
const canvas = ref<HTMLCanvasElement | null>(null);

async function draw() {
  await nextTick();
  if(!canvas.value) return;
  const { metatile } = props;
  const width = metatile.columns * metatile.tileWidth;
  const height = metatile.rows * metatile.tileHeight;
  canvas.value.width = width;
  canvas.value.height = height;
  const context = canvas.value.getContext("2d");
  if(!context) return;
  context.clearRect(0, 0, width, height);
  for(const [index, tile] of metatile.data.entries()) {
    if(!tile) continue;
    const tileset = props.tilesets.find(item => item.id === tile.tileset);
    if(!tileset) continue;
    const image = new Image();
    await new Promise<void>(resolve => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = tileset.image;
    });
    const sourceX = (tileset.margin ?? 0) + (tile.tile % tileset.columns) * (tileset.tileWidth + (tileset.spacing ?? 0));
    const sourceY = (tileset.margin ?? 0) + Math.floor(tile.tile / tileset.columns) * (tileset.tileHeight + (tileset.spacing ?? 0));
    context.drawImage(image, sourceX, sourceY, tileset.tileWidth, tileset.tileHeight, (index % metatile.columns) * metatile.tileWidth, Math.floor(index / metatile.columns) * metatile.tileHeight, metatile.tileWidth, metatile.tileHeight);
  }
}

onMounted(draw);
watch(() => [props.metatile, props.tilesets], draw, { deep: true });
</script>

<template>
  <canvas ref="canvas" class="metatile-preview-canvas" />
</template>
