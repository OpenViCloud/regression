#!/usr/bin/env python3
"""Tests of check-screenshots.py. Run: python3 test_check_screenshots.py"""
import contextlib
import importlib.util
import io
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_screenshots", pathlib.Path(__file__).resolve().parent / "check-screenshots.py")
check_screenshots = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_screenshots)

SPEC = """
test.describe.serial('ui', () => {
  test.beforeAll(async ({ browser }) => {
    pages = await openPages(browser)
  })

  test('UI-01 the dashboard', async () => {
    const page = await pageOf('tenant')
    await page.screenshot({ path: `${RESULTS}/UI-01-dashboard.png` })
  })

  test('UI-02 the drawer', async ({ browser }) => {
    const context = await browser.newContext()
  })

  test('API-01 no browser here', async () => {
    await get('tenant', '/v1/tenant')
  })

  test("UI-03 a screenshot under another case's name", async () => {
    const page = await pageOf('tenant')
    await page.screenshot({ path: `${RESULTS}/UI-01-again.png` })
  })
})
"""

LOG = """
  ✓  1 [chromium] › e2e/ui.spec.ts:6:3 › ui › UI-01 the dashboard (2s)
  ✓  2 [chromium] › e2e/ui.spec.ts:11:3 › ui › UI-02 the drawer (1s)
  ✓  3 [chromium] › e2e/ui.spec.ts:15:3 › ui › API-01 no browser here (1s)
  ✘  4 [chromium] › e2e/ui.spec.ts:19:3 › ui › UI-03 a screenshot under another case's name (1s)
"""


def run(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = check_screenshots.main(argv)
    return code, out.getvalue()


class UiCases(unittest.TestCase):
    def test_only_tests_that_drive_a_browser_are_ui_cases(self):
        ids = [case_id for case_id, _ in check_screenshots.ui_cases(SPEC)]
        self.assertEqual(ids, ["UI-01", "UI-02", "UI-03"])

    def test_a_screenshot_counts_only_under_the_cases_own_id(self):
        bodies = dict(check_screenshots.ui_cases(SPEC))
        self.assertTrue(check_screenshots.takes_screenshot("UI-01", bodies["UI-01"]))
        self.assertFalse(check_screenshots.takes_screenshot("UI-02", bodies["UI-02"]))
        self.assertFalse(check_screenshots.takes_screenshot("UI-03", bodies["UI-03"]))


class Main(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.specs = root / "specs"
        self.shots = root / "shots"
        self.specs.mkdir()
        self.shots.mkdir()
        self.log = root / "runner.log"
        self.log.write_text(LOG, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_static_mode_names_the_cases_with_no_screenshot_call(self):
        (self.specs / "ui.spec.ts").write_text(SPEC, encoding="utf-8")
        code, out = run([str(self.specs)])
        self.assertEqual(code, 1)
        self.assertIn("no screenshot call into ${RESULTS}/<ID>-: UI-02 UI-03", out)
        self.assertTrue(out.rstrip().endswith("SCREENSHOT_RESULT=MISSING 2"))

    def test_a_passed_ui_case_needs_its_png_and_a_failed_one_does_not(self):
        only_good = SPEC.split("  test('UI-02")[0] + "})\n"
        (self.specs / "ui.spec.ts").write_text(only_good, encoding="utf-8")
        code, out = run([str(self.specs), str(self.shots), str(self.log)])
        self.assertEqual(code, 1)
        self.assertIn("passed with no <ID>-*.png in %s: UI-01" % self.shots, out)

        (self.shots / "UI-01-dashboard.png").write_bytes(b"\x89PNG")
        code, out = run([str(self.specs), str(self.shots), str(self.log)])
        self.assertEqual(code, 0)
        self.assertTrue(out.rstrip().endswith("SCREENSHOT_RESULT=OK 1 UI case(s)"))

    def test_a_folder_with_no_ui_case_is_ok(self):
        (self.specs / "api.spec.ts").write_text("test('API-01 x', async () => {\n  await get()\n})\n", encoding="utf-8")
        code, out = run([str(self.specs)])
        self.assertEqual(code, 0)
        self.assertIn("UI cases: none", out)


if __name__ == "__main__":
    unittest.main()
