/**
 * Test-only Node loader: map React peer imports to the local stub.
 *
 * Imported via node:module.register() from tests/ui/ui-runtime.spec.mjs.
 * It never affects production/build output.
 */
const stubUrl = new URL('./react-runtime.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') {
    return { shortCircuit: true, url: stubUrl }
  }
  return nextResolve(specifier, context)
}
