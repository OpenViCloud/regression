import { test, expect } from '@playwright/test'
import { ADMIN, closeSessions, pageOf, useBrowser } from './auth'
import { bodyOf, call, expectStatus, get, log, newKey, pollUntil, RESULTS, startLog } from './api'
import { RUN } from './fixtures'

// Cases ADM-08, ADM-09 of plan.md: the admin portal screens that ADM-06..07 (admin.spec.ts) left for
// PORTAL-REDESIGN. English is forced the way portal-flows.spec.ts does (ovc-lang in localStorage), independent of
// the runner's IP, so the debt-ceiling grouping mark and every label read back are deterministic.

async function forceEnglish(): Promise<void> {
  const page = await pageOf('admin')
  await page.goto(ADMIN + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('ovc-lang', 'en'))
}

test.describe.serial('admin-portal', () => {
  test.describe.configure({ timeout: 10 * 60_000 })

  let topUpId = ''
  let paymentRef = ''
  let amount = 0
  let tenantId = ''
  let tenantName = ''
  let originalDebtCeiling: number | null = null

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(10 * 60_000)
    startLog('admin-portal')
    useBrowser(browser)
    await forceEnglish()
  })

  test.afterAll(async () => {
    test.setTimeout(10 * 60_000)
    const page = await pageOf('admin')
    await page.evaluate(() => localStorage.removeItem('ovc-lang'))
    if (originalDebtCeiling !== null) {
      expectStatus(await call('admin', 'PATCH', `/v1/tenants/${tenantId}/debt-ceiling`, { debtCeiling: originalDebtCeiling }), 204)
    }
    await closeSessions()
  })

  // portal/src/admin/pages/AdminPromotionalCreditsPage.tsx:145-190 (PendingTopUps) — a customer-started top-up
  // nobody confirmed; the admin portal's own confirm button, not the API confirm admin.spec.ts/billing.spec.ts use.
  // Creates its own Pending top-up for beta-user (as UI-07 does, portal-ui/portal-flows.spec.ts:424) instead of
  // depending on UI-07 having run first, so this module's order does not matter.
  test('ADM-08 confirming a pending top-up in the admin portal credits the wallet and removes the row', async () => {
    // beta-user's own tenant id and wallet: the plan reads/writes beta-user's wallet here on purpose (ADM-08).
    const tenant = await get('tenant', '/v1/tenant')
    const before = (await get('tenant', '/v1/tenant/wallet')).balance as number
    // OpenViCloud/control-plane:Titan.Infrastructure/Endpoints/TopUp/CreateTopUpEndpoint.cs RequestTopUpValidator — GreaterThan(0): the smallest amount the validator accepts.
    amount = 1
    const createReply = await call('tenant', 'POST', '/v1/tenant/topups', { amount }, newKey())
    expectStatus(createReply, 201)
    topUpId = bodyOf(createReply).topUpId as string
    const created = (await get('tenant', '/v1/tenant/topups') as any[]).find((t) => t.id === topUpId)
    paymentRef = created.paymentRef as string
    log(`ADM-08 created topup ${topUpId} amount=${amount} ref=${paymentRef}`)

    const page = await pageOf('admin')
    await page.goto(ADMIN + '/promotional-credits', { waitUntil: 'networkidle' })
    const section = page.locator('section[aria-labelledby="pending-topups-title"]')
    await expect(section.getByText('Top-ups waiting for confirmation')).toBeVisible()

    const row = section.getByRole('row').filter({ hasText: paymentRef })
    await expect(row).toBeVisible()
    await expect(row).toContainText(tenant.name)
    log(`ADM-08 row text before confirm: ${await row.innerText()}`)
    await page.screenshot({ path: `${RESULTS}/ADM-08-pending-topup.png` })

    await row.getByRole('button', { name: 'Confirm', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Confirm top-up' })).toBeVisible()
    const bankRef = `rg-${RUN}`
    await dialog.locator('#confirm-bank-ref').fill(bankRef)
    const confirmResponsePromise = page.waitForResponse((res) =>
      res.request().method() === 'POST' && res.url().includes(`/v1/admin/topups/${topUpId}/confirm`))
    await dialog.getByRole('button', { name: 'Confirm top-up' }).click()
    const confirmResponse = await confirmResponsePromise
    expect(confirmResponse.request().postDataJSON().paymentTxnRef).toBe(bankRef)
    expect(confirmResponse.status()).toBe(202)

    await expect(section.getByRole('row').filter({ hasText: paymentRef })).toHaveCount(0)

    const confirmed = await pollUntil('ADM-08 topup confirmed',
      () => get('admin', '/v1/admin/topups') as Promise<any[]>,
      (rows) => rows.find((t) => t.id === topUpId)?.status === 'Confirmed',
      (rows) => `status=${rows.find((t) => t.id === topUpId)?.status}`)
    const row2 = confirmed.find((t) => t.id === topUpId)
    expect(row2.source).toBe('Manual')

    await pollUntil('ADM-08 wallet credited', () => get('tenant', '/v1/tenant/wallet'),
      (w) => w.balance === before + amount, (w) => `balance=${w.balance}`)

    // Promo top-ups are never Pending (confirmed when granted) and a Confirmed one carries no Confirm button:
    // every remaining row in the section must still be Pending and not a PromotionalCredit.
    const stillPending = await get('admin', '/v1/admin/topups') as any[]
    for (const t of stillPending.filter((t) => t.status === 'Pending' && t.source !== 'PromotionalCredit')) {
      await expect(section.getByRole('row').filter({ hasText: t.paymentRef }).getByRole('button', { name: 'Confirm', exact: true }))
        .toBeVisible()
    }
    topUpId = ''
  })

  // portal/src/admin/pages/AdminTenantsPage.tsx:148-219 (EditQuotaDialog), :240-302 (EditDebtCeilingDialog)
  test('ADM-09 Edit quota shows the 9 caps of GET /v1/tenants; debt ceiling 9.000.000 PATCHes 9000000', async () => {
    const apiTenant = (await get('tenant', '/v1/tenant'))
    tenantId = apiTenant.id
    const adminRow = (await get('admin', '/v1/tenants') as any[]).find((t) => t.id === tenantId)
    tenantName = adminRow.name
    originalDebtCeiling = adminRow.debtCeiling
    log(`ADM-09 tenant ${tenantName} debtCeiling=${originalDebtCeiling}`)

    const page = await pageOf('admin')
    await page.goto(ADMIN + '/tenants', { waitUntil: 'networkidle' })
    const row = page.getByRole('row').filter({ hasText: tenantName })
    await expect(row).toBeVisible()

    // Edit quota dialog: every cap input seeded from the same row GET /v1/tenants returned.
    await row.getByRole('button', { name: 'Edit quota' }).click()
    const quotaDialog = page.getByRole('dialog')
    await expect(quotaDialog.getByRole('heading', { name: 'Edit quota' })).toBeVisible()
    const caps = [
      'maxVms', 'maxNetworks', 'maxVolumes', 'maxVmSnapshotsPerVm', 'maxVolumeSnapshotsPerVolume',
      'maxFirewallRulesPerNetwork', 'maxPublicIpv6', 'maxSshKeys', 'maxLoadBalancers',
    ] as const
    for (const cap of caps) {
      await expect(quotaDialog.locator(`#quota-${cap}`)).toHaveValue(String(adminRow[cap]))
    }
    await page.screenshot({ path: `${RESULTS}/ADM-09-edit-quota.png` })
    await quotaDialog.getByRole('button', { name: 'Cancel' }).click()

    // Debt ceiling dialog: typed the way the table shows it (9.000.000), not 9000 or 9.000.
    await row.getByRole('button', { name: 'Debt ceiling', exact: true }).click()
    const ceilingDialog = page.getByRole('dialog')
    await expect(ceilingDialog.getByRole('heading', { name: 'Debt ceiling' })).toBeVisible()
    const input = ceilingDialog.locator('#debt-ceiling')
    await input.fill('')
    await input.fill('9.000.000')
    const patchResponsePromise = page.waitForResponse((res) =>
      res.request().method() === 'PATCH' && res.url().includes(`/v1/tenants/${tenantId}/debt-ceiling`))
    await ceilingDialog.getByRole('button', { name: 'Save' }).click()
    const response = await patchResponsePromise
    // lib/money.ts parseWholeVnd: '9.000.000' (dot-grouped) reads as nine million, not nine thousand.
    expect(response.request().postDataJSON().debtCeiling).toBe(9000000)
    expect(response.status()).toBe(204)

    await expect(row.locator('span.font-mono')).toContainText('9,000,000')
    await page.screenshot({ path: `${RESULTS}/ADM-09-debt-ceiling-new.png` })

    // Restore through the API, then reload: the dialog's own query cache has no reason to refetch after an
    // out-of-band PATCH, so only a fresh load proves the table shows the old value again.
    expectStatus(await call('admin', 'PATCH', `/v1/tenants/${tenantId}/debt-ceiling`, { debtCeiling: originalDebtCeiling }), 204)
    await page.reload({ waitUntil: 'networkidle' })
    const rowAfter = page.getByRole('row').filter({ hasText: tenantName })
    if (originalDebtCeiling === 9000000) {
      log('ADM-09 original debt ceiling was already 9,000,000 ₫: the restore check cannot show a difference')
    } else {
      await expect(rowAfter.locator('span.font-mono')).not.toContainText('9,000,000')
    }
    originalDebtCeiling = null
  })
})
