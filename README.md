# regression — OpenViCloud's regression suite

The durable regression suite of [OpenViCloud](https://github.com/OpenViCloud/titan). Every behaviour that must still
hold at the next release has a case in [`plan.md`](plan.md) and, once written, a Playwright spec here. Before each
release the whole suite runs against staging; a release pins the commit of this repository it ran.

The specs drive the public API, the portals and the CLI of a running OpenViCloud environment. They do not run on a
laptop: each module runs as a job of the `titan-regression` runner inside the cluster (its manifests are in
[titan's `gitops/regression-runner/`](https://github.com/OpenViCloud/titan/tree/main/gitops/regression-runner)),
which signs in with the test accounts there, so no credential passes through the machine that starts the run.

## Layout

| Path | What it is |
|---|---|
| [`plan.md`](plan.md) | Every case: stable ID, expectation, source |
| `<module>/*.spec.ts` | Specs of one module; the test name carries the case ID |
| `lib/` | Helpers loaded with every module (sign-in, API calls with polling, cleanup, fixtures) |
| `run-module.sh` | Runs one module in the cluster and copies its results and logs back |
| `count-cases.py` | Counts `plan.md`'s IDs against the runner logs, for the report's first line |
| `check-screenshots.py` | Fails when a browser case passed without its `<ID>-*.png` screenshot |
| `trim-cp-log.py` | Drops the control plane's routine info lines from a saved log |
| `selftest/`, `test_*.py` | Tests of the helpers and scripts above |
| [`CLAUDE.md`](CLAUDE.md) | How specs are written and the assumptions a run on staging makes |

## Run one module

```sh
bash run-module.sh <kubeconfig> <source tree> <module> <label> <work dir> <log dir> [cli binary]
python3 count-cases.py <work dir of each module>/runner.log ...
```

The source tree is `git archive <sha>` of this repository, extracted, with any new specs copied in; run the
script from a checkout so its first line names the commit. The full procedure (order, steps outside the runner, evidence) is
[`release:regression`](https://github.com/OpenViCloud/titan/blob/main/.claude/commands/release/regression.md).

## Test the tooling

Needs Node 22.18 or later (it strips the TypeScript types without a flag; CI pins 22.23.3) and Python 3. CI runs the same:

```sh
node --test 'selftest/*.test.ts'
python3 test_count_cases.py
python3 test_check_screenshots.py
python3 test_trim_cp_log.py
```

## Modules and order

Rows the runner runs go in this order, one job each: a later module may use what an earlier one left in the run (the run's network); the
module that changes the tenant's state and the one that deletes the run's network go last.

| # | Module | Measures | Dev | Staging | Spec |
|---|---|---|---|---|---|
| 1 | `smoke` | health, zones, anonymous catalog, clean test account | yes | yes | yes |
| 2 | `catalog` | offerings and prices, templates per zone, live clusters/OS images, template sync | yes | yes | yes |
| 3 | `network` | the run's network on Incus: create, Idempotency-Key, quota, overlapping CIDR, rename | yes | yes | yes |
| 4 | `firewall` | rules in the network's ACL: create, delete, quota | yes | yes | yes |
| 5 | `vm` | VMs: create per tier, stop/start, repeats and conflicts, IPv6, rename, delete; SSH keys | yes | yes | yes |
| 6 | `vm-snapshot` | VM snapshots: create, cap, revert, delete, deleted with their VM | yes | yes | yes |
| 7 | `volume` | volumes and volume snapshots: create, attach/detach, restore, delete | yes | yes | yes |
| 8 | `load-balancer` | L4 load balancer on an IPv6 network: create, VIP, reconfigure, backend VM delete refused, delete (zone without an IPv6 block: negative cases only) | yes | yes | yes |
| 9 | `tenant` | tenant, quota, terms consent | yes | yes | yes |
| 10 | `api-token` | API tokens: create, call the API with one, duplicate name/secret, delete ⇒ `401`, unknown token | yes | yes | no |
| 11 | `cli` | `openvicloud`: version, web sign-in, `OPENVICLOUD_TOKEN`, `tenant get` matches the API, `vm ssh` + `scp` into a real VM, sign-out | yes | yes | yes |
| 12 | `terraform-provider` | the public provider: catalog, network + firewall rule, SSH key + VM + volume + attachment, load balancer (create, import, update in place, delete), plan-time validation — `TF_ACC` on the agent's machine | no | yes | yes — `acceptance_*test.go` of the provider repo (TFP-04, TFP-08 by hand) |
| 13 | `billing` | metering, costs, invoices, paying from the wallet, top-ups, promo credit, `/healthz/wallet` | no | yes | yes |
| 14 | `contract` | HTTP contract: status codes, Idempotency-Key, error envelope, auth, CORS, TLS | no | yes | yes |
| 15 | `concurrency` | double clicks, invoice paid twice at once | no | yes | yes |
| 16 | `admin` | admin API: networks/VMs of every tenant, VM deleted on a tenant's behalf + audit, clusters, prices (admin portal screens: deferred) | no | yes | yes (API) |
| 17 | `portal-ui` | customer portal end to end, signed in | no | yes | yes |
| 18 | `tenant-suspend` | suspended ⇒ writes refused, reads allowed; reactivated | no | yes | yes |
| 19 | `network-lifecycle` | deletes the run's network (with its rules), recreates the same name | yes | yes | yes |
| 20 | `login-page` | Keycloak sign-in page: layout, colours, font, brand, sign-up form, language (no sign-in) | yes | yes | yes |
| 21 | `cleanup` | sweeps `rg-*` through the API, asserts 0 (on Incus: CLN-02, host) | yes | yes | yes |
| 22 | `worker` | the worker image staging runs comes from `OpenViCloud/incus-worker`, pulls anonymously; the worker's command kinds match the control plane's — `gh`/`curl`/`kubectl` reads on the agent's machine | no | yes | no |
| 23 | `control-plane-image` | the control plane image staging runs comes from `OpenViCloud/control-plane`, pulls anonymously, digest matches the pod — `gh`/`curl`/`kubectl` reads on the agent's machine | no | yes | no |

Steps outside the runner: before `billing` the agent runs `billing/seed-invoices.sql` (psql on the environment's
database; on staging an approved `L-x`), after `concurrency` it runs `billing/check-wallets.sql` (read only, BIL-14);
module `cli` needs the agent to copy the binary into the pod when the spec logs `BINARY_WAIT`.

Not run by the runner (Phase 4 of `release:regression`): `observation` — state changed on the Incus host outside
OpenViCloud, needs an approved `L-x` command; `site` — the public site through Playwright MCP on the agent's machine;
`worker`, `control-plane-image` — read-only `gh`/`curl`/`kubectl` on the agent's machine; `terraform-provider` —
`TF_ACC` of the provider repository on the agent's machine, against staging.

**Spec** is `yes` when every case of the module in `plan.md` has a spec that ran green on staging at a release, except `(host)` cases (Phase 4
of the release), **NOT COVERED** cases (the reason is in `plan.md`) and cases not applicable to the measured
environment (the spec calls `test.skip` with the reason, e.g. VM-12 with a single zone). `ACT-*` cases are measured
in the module that owns the resource. A case with no spec yet gets one at the next release; a case no spec can be
written for and that Phase 4 does not measure by hand is **NOT COVERED**, with the reason in its row of `plan.md`. Specs pick the first zone with a listed template (`lib/fixtures.ts`,
`envOf()`); staging's zone is `singapore01`.

## License

[Mozilla Public License 2.0](LICENSE).
