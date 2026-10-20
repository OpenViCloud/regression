// Runs every clean-up step even when one fails, then fails once naming each step that did: a network error on the
// first step must not leave the later resources alive or a raised quota in place.
// No imports: selftest runs this file without Playwright.
export async function cleanUp(steps: Array<[string, () => Promise<void>]>): Promise<void> {
  const failures: string[] = []
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`clean-up failed in ${failures.length} step(s):\n${failures.join('\n')}`)
  }
}
