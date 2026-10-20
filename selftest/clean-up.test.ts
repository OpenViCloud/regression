// Run: node --test 'selftest/*.test.ts' (Node 22.23.3 strips the types itself; nothing to install)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanUp } from '../lib/clean-up.ts'

test('every step runs although an earlier one failed, and the failure names its step', async () => {
  const ran: string[] = []
  const steps: Array<[string, () => Promise<void>]> = [
    ['quota', async () => { ran.push('quota') }],
    ['load balancer', async () => { ran.push('load balancer'); throw new Error('fetch failed') }],
    ['vm', async () => { ran.push('vm') }],
  ]

  await assert.rejects(cleanUp(steps), /load balancer: .*fetch failed/)
  assert.deepEqual(ran, ['quota', 'load balancer', 'vm'])
})

test('every failure is in the one error', async () => {
  const steps: Array<[string, () => Promise<void>]> = [
    ['a', async () => { throw new Error('one') }],
    ['b', async () => { throw new Error('two') }],
  ]

  await assert.rejects(cleanUp(steps), /a: .*one[\s\S]*b: .*two/)
})

test('steps that all pass leave nothing to report', async () => {
  const ran: string[] = []
  await cleanUp([['a', async () => { ran.push('a') }], ['b', async () => { ran.push('b') }]])
  assert.deepEqual(ran, ['a', 'b'])
})
