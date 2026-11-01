export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ["@/assets/styles.css"],
  modules: ['@nuxt/eslint'],
  eslint: {
    config: {
      formatters: true,
    },
  },
})
