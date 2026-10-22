import { test, expect } from '@playwright/test'
import { closeSessions, useBrowser } from './auth'
import { bodyOf, call, expectStatus, get, log, newKey, startLog } from './api'
import { RUN, envOf } from './fixtures'

// Cases SUS-01..03 of plan.md. beta-user's tenant is Suspended for the length of this module only:
// afterAll puts it back to Active whatever happened.
test.describe.serial('tenant-suspend', () => {
  let tenantId = ''
  let suspended = false

  async function setStatus(status: string): Promise<void> {
    const reply = await call('admin', 'PATCH', `/v1/tenants/${tenantId}/status`, { status })
    expectStatus(reply, 204)
    expect(reply.text).toBe('')
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(10 * 60_000)
    startLog('tenant-suspend')
    useBrowser(browser)
    const tenant = await get('tenant', '/v1/tenant')
    tenantId = tenant.id
    expect(tenant.status, 'start from an Active tenant').toBe('Active')
  })

  test.afterAll(async () => {
    test.setTimeout(10 * 60_000)
    if (suspended) {
      await setStatus('Active')
      log('afterAll: beta-user Active again')
    }
    await closeSessions()
  })

  // OpenViCloud/titan-control-plane:Titan.Infrastructure/Endpoints/Tenant/UpdateTenantStatusEndpoint.cs (Configure: Patch("v1/tenants/{tenantId:guid}/status");
  // HandleAsync: SendNoContentAsync);
  // OpenViCloud/titan-control-plane:Titan.Infrastructure/Auth/TenantResolutionMiddleware.cs InvokeAsync (isWrite ⇒ TENANT_SUSPENDED) (a middleware 403 is {code, message}: OpenViCloud/titan-ops:docs/architecture/http-contract.md, named exceptions) — writes refused, reads pass
  test('SUS-01 a suspended tenant reads but cannot write: 403 TENANT_SUSPENDED', async () => {
    suspended = true
    await setStatus('Suspended')
    const tenant = await get('tenant', '/v1/tenant')
    expect(tenant.status).toBe('Suspended')
    expectStatus(await call('tenant', 'GET', '/v1/tenant/vms'), 200)
    const { zoneId } = await envOf()
    const write = await call('tenant', 'POST', '/v1/tenant/networks', { name: `rg-susnet-${RUN}`, zoneId, cidr: '10.88.0.0/24' }, newKey())
    log(`SUS-01 write → ${write.status} ${write.text.slice(0, 200)}`)
    expectStatus(write, 403)
    expect(bodyOf(write).code).toBe('TENANT_SUSPENDED')
    const networks = await get('tenant', '/v1/tenant/networks') as any[]
    expect(networks.some((n) => n.name === `rg-susnet-${RUN}`)).toBe(false)
  })

  // OpenViCloud/titan-ops:docs/features/tenant/design.md#tenant-status-repeats
  test('SUS-02 suspending again is 204', async () => {
    await setStatus('Suspended')
    expect((await get('tenant', '/v1/tenant')).status).toBe('Suspended')
  })

  test('SUS-03 Active again is 204 and writes pass', async () => {
    await setStatus('Active')
    suspended = false
    expect((await get('tenant', '/v1/tenant')).status).toBe('Active')
    // A write that changes nothing lasting: a create refused by its validator gets past the tenant gate.
    const reply = await call('tenant', 'POST', '/v1/tenant/networks', { name: '', zoneId: '' }, newKey())
    log(`SUS-03 write → ${reply.status} ${reply.text.slice(0, 200)}`)
    expectStatus(reply, 400)
    expect(bodyOf(reply).code).toBe('VALIDATION_ERROR')
  })
})
