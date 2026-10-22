import { test, expect } from '@playwright/test'
import { closeSessions, useBrowser } from './auth'
import { call, expectStatus, get, log, pollUntil, startLog } from './api'
import { deleteVmAndWait, existenceShape, readVolume, waitNetwork, waitVolume } from './fixtures'

// Case CLN-01 of plan.md (CLN-02 reads the Incus host). Runs last: removes every rg-* resource of beta-user
// a module left behind, in an order Titan accepts — load balancers (a VM a live one sends to refuses its delete:
// OpenViCloud/titan-ops:docs/features/load-balancer/design.md#lb-and-vm-network), rules, VMs (their snapshots go with them, attached volumes are
// released: OpenViCloud/titan-ops:docs/features/volume/design.md#vm-delete-releases-volumes), volume snapshots, volumes, networks.
function isTest(r: { name: string }): boolean {
  return r.name.startsWith('rg-')
}

test.describe.serial('cleanup', () => {
  test.describe.configure({ timeout: 30 * 60_000 })

  test.beforeAll(async ({ browser }) => {
    startLog('cleanup')
    useBrowser(browser)
  })

  test.afterAll(async () => {
    await closeSessions()
  })

  // Rules go with their network (OpenViCloud/titan-control-plane:Titan.Application/Commands/Networking/Network/UpdateNetworkStatusCommandHandler.cs
  // HandleAsync, case Deleted: rule.MarkDeleted()), VM snapshots with their VM
  // (OpenViCloud/titan-control-plane:Titan.Application/Commands/Compute/Vm/UpdateVmStatusCommandHandler.cs HandleAsync, case Deleted:
  // MarkAllDeletedByVmIdAsync); lists hide Deleted (OpenViCloud/titan-control-plane:Titan.Infrastructure/Repositories/VmRepository.cs ListByTenantAsync).
  test('CLN-01 no rg-* load balancer, network, VM, volume or snapshot is left', async () => {
    for (const lb of (await get('tenant', '/v1/tenant/load-balancers') as any[]).filter(isTest)) {
      log(`CLN-01 load balancer ${lb.name}`)
      await pollUntil(`load balancer ${lb.name} at rest`, () => get('tenant', `/v1/tenant/load-balancers/${lb.id}`),
        (row) => row.transition === null || row.transition === 'Deleting', existenceShape)
      expectStatus(await call('tenant', 'DELETE', `/v1/tenant/load-balancers/${lb.id}`), 202)
      await pollUntil(`load balancer ${lb.name} deleted`, () => get('tenant', `/v1/tenant/load-balancers/${lb.id}`),
        (row) => row.currentExistence === 'Deleted', existenceShape)
    }

    const networks = (await get('tenant', '/v1/tenant/networks') as any[]).filter(isTest)
    for (const network of networks) {
      const rules = await get('tenant', `/v1/tenant/networks/${network.id}/firewall-rules`) as any[]
      for (const rule of rules) {
        if (rule.desiredExistence !== 'Exists') {
          continue
        }
        await pollUntil(`rule ${rule.id} settles`, async () => {
          const rows = await get('tenant', `/v1/tenant/networks/${network.id}/firewall-rules`) as any[]
          return rows.find((r) => r.id === rule.id) || { transition: null }
        }, (r) => r.transition === null, existenceShape)
        expectStatus(await call('tenant', 'DELETE', `/v1/tenant/networks/${network.id}/firewall-rules/${rule.id}`), 204)
        log(`CLN-01 rule ${rule.id} delete asked`)
      }
    }

    for (const vm of (await get('tenant', '/v1/tenant/vms') as any[]).filter(isTest)) {
      log(`CLN-01 vm ${vm.name}`)
      await deleteVmAndWait(vm.id)
    }

    for (const volume of (await get('tenant', '/v1/tenant/volumes') as any[]).filter(isTest)) {
      log(`CLN-01 volume ${volume.name}`)
      await waitVolume(`volume ${volume.name} at rest`, volume.id, (v) => v.transition === null || v.currentExistence === 'Deleted')
      for (const snapshot of await get('tenant', `/v1/tenant/volumes/${volume.id}/snapshots`) as any[]) {
        if (snapshot.desiredExistence === 'Exists') {
          expectStatus(await call('tenant', 'DELETE', `/v1/tenant/volumes/${volume.id}/snapshots/${snapshot.id}`), 202)
        }
      }
      await pollUntil(`snapshots of ${volume.name} gone`, () => get('tenant', `/v1/tenant/volumes/${volume.id}/snapshots`) as Promise<any[]>,
        (rows) => rows.length === 0, (rows) => `${rows.length} left`)
      if ((await readVolume(volume.id)).currentExistence !== 'Deleted') {
        expectStatus(await call('tenant', 'DELETE', `/v1/tenant/volumes/${volume.id}`), 202)
        await waitVolume(`volume ${volume.name} deleted`, volume.id, (v) => v.currentExistence === 'Deleted')
      }
    }

    for (const network of (await get('tenant', '/v1/tenant/networks') as any[]).filter(isTest)) {
      log(`CLN-01 network ${network.name}`)
      await waitNetwork(`network ${network.name} at rest`, network.id, (n) => n.transition === null || n.currentExistence === 'Deleted')
      if (network.desiredExistence === 'Exists') {
        expectStatus(await call('tenant', 'DELETE', `/v1/tenant/networks/${network.id}`), 202)
      }
      await waitNetwork(`network ${network.name} deleted`, network.id, (n) => n.currentExistence === 'Deleted')
    }

    const left = [
      ...(await get('tenant', '/v1/tenant/load-balancers') as any[]),
      ...(await get('tenant', '/v1/tenant/networks') as any[]),
      ...(await get('tenant', '/v1/tenant/vms') as any[]),
      ...(await get('tenant', '/v1/tenant/volumes') as any[]),
    ].filter(isTest).map((r) => r.name)
    log(`CLN-01 left: [${left.join(', ')}]`)
    expect(left).toEqual([])
  })
})
