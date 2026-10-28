<script setup lang="ts">
defineProps<{ busy: boolean; status: string }>();
defineEmits<{ open: []; create: [] }>();
</script>

<template>
  <main class="project-hub">
    <section class="hub-card" aria-labelledby="hub-title">
      <p class="eyebrow">GBA project workspace</p>
      <h1 id="hub-title">Bonka Editor</h1>
      <p class="hub-copy">Open a Project Format v1 directory or create a new project to begin building scenes and metatiles.</p>
      <div class="hub-actions">
        <button class="action" type="button" :disabled="busy" @click="$emit('open')">Open project</button>
        <button class="action primary" type="button" :disabled="busy" @click="$emit('create')">New project</button>
      </div>
      <aside class="hub-permissions" aria-labelledby="permissions-title">
        <h2 id="permissions-title">Project folder access</h2>
        <p>Bonka will ask your browser for read and write access to a folder you choose. It can access only that folder and its subfolders.</p>
        <p>Choose a dedicated Bonka project folder. Do not select your home folder or a folder containing unrelated files.</p>
        <p class="hub-permissions-links"><a href="https://bonka.dev/docs/online-editor" target="_blank" rel="noreferrer">Using the online editor</a><a href="https://bonka.dev/privacy" target="_blank" rel="noreferrer">Privacy and project access</a></p>
      </aside>
      <p class="hub-status" role="status" aria-live="polite">{{ status }}</p>
    </section>
  </main>
</template>
