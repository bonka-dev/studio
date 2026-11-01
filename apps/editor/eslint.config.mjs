// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  name: 'bonka/legacy-types',
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
})
