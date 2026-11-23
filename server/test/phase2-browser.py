"""Fictional applicant editor and memory through real Chrome and backend restarts."""
import os
import re
from pathlib import Path
import secrets
import socket
from subprocess import Popen
import sys
from tempfile import TemporaryDirectory
import time
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
browser = sys.argv[1]
token = secrets.token_hex(32)
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
base = "http://127.0.0.1:" + str(port)


def launch(playwright, directory):
    extension = repo / "extension"
    context = playwright.chromium.launch_persistent_context(
        directory / "chrome", executable_path=browser, headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
              "--disable-background-networking", "--disable-sync"],
    )
    context.route("https://**/*", lambda route: route.abort())
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
    return context, worker, worker.url.split("/")[2]


def start_backend(directory, extension_id):
    env = {
        "PATH": os.environ["PATH"], "CI": "true", "PORT": str(port),
        "AUTOJOB_TEST": "1", "AUTOJOB_DATA": str(directory / "app-data"),
        "AUTOJOB_TOKEN": token, "EXTENSION_ID": extension_id,
        "DOTENV_CONFIG_PATH": str(directory / "absent.env"),
        "LLM_PROVIDER": "ollama", "OLLAMA_URL": "http://127.0.0.1:9", "OLLAMA_FALLBACK": "off",
    }
    with (directory / "server.log").open("w") as log:
        process = Popen(["node", "server/src/index.js"], cwd=repo, env=env, stdout=log, stderr=log)
    for _ in range(40):
        try:
            with urlopen(Request(base + "/api/health", headers={"Authorization": "Bearer " + token})) as response:
                assert response.status == 200
            return process
        except OSError:
            if process.poll() is not None:
                break
            time.sleep(0.1)
    process.terminate()
    process.wait(timeout=5)
    raise AssertionError("Test backend did not start")


def setup_panel(context, extension_id):
    portal = context.pages[0]
    portal.goto(base + "/test/phase2-form.html")
    panel = context.new_page()
    panel.goto(f"chrome-extension://{extension_id}/sidepanel.html")
    expect(panel.locator("#status")).to_have_class("pill ok")
    return portal, panel


def add_record(panel, kind, values):
    panel.locator("#evidenceKind").select_option(kind)
    panel.locator("#evidenceAdd").press("Space")
    for key, value in values.items():
        field = panel.locator(f"#evidenceFields [name={key}]")
        if key == "refs":
            field.select_option(label=value)
        else:
            field.fill(value)
    panel.locator('[data-evidence-decision="approve"]').press("Space")
    expect(panel.locator("#evidenceForm")).to_be_hidden()


with TemporaryDirectory() as folder, sync_playwright() as playwright:
    directory = Path(folder)
    context, worker, extension_id = launch(playwright, directory)
    backend = start_backend(directory, extension_id)
    try:
        worker.evaluate(
            "([server, apiToken]) => chrome.storage.local.set({server, apiToken, autoNext:false, autoCover:false})",
            [base, token],
        )
        portal, panel = setup_panel(context, extension_id)
        panel.locator('nav [data-tab="profile"]').click()
        panel.locator("#evidenceDetails summary").click()
        expect(panel.locator("#evidenceKind option")).to_have_count(10)
        add_record(panel, "contact", {"legalName": "Morgan Example", "emails": "morgan@example.invalid"})
        add_record(panel, "employment", {"company": "Fictional Systems", "title": "Engineer", "start": "2020", "end": "Present"})
        expect(panel.locator("#evidenceRecords")).to_contain_text("Fictional Systems")
        add_record(panel, "accomplishment", {
            "original": "Reduced fictional test time by 12.50%.",
            "metrics": '[{"value":"12.50","unit":"%","label":"Time"}]',
            "refs": "Engineer · Fictional Systems · 2020 · approved",
        })
        add_record(panel, "skill", {"name": "Test automation", "refs": "Engineer · Fictional Systems · 2020 · approved"})
        expect(panel.locator("#evidenceRecords")).to_contain_text("Test automation")
        panel.locator("#prefPrivacy").check()
        panel.locator("#saveAutomation").press("Space")
        expect(panel.locator("#toast")).to_contain_text("Automation preferences saved")
        panel.locator('nav [data-tab="apply"]').click()
        panel.locator("#fill").press("Space")
        expect(portal.locator("#last")).to_have_value("Example")
        expect(panel.locator("#missingAnswers")).to_contain_text("How should we contact you?")
        expect(panel.locator("#fill")).to_be_enabled(timeout=15000)
        panel.locator("#authorizationQueue input[type=checkbox]").check()
        panel.get_by_role("button", name="I reviewed these terms and approve this field").press("Space")
        expect(panel.locator("#authorizationQueue details")).to_have_count(0)
        panel.locator("#missingAnswers select").first.select_option("Email")
        panel.get_by_role("button", name="Approve and save this answer").press("Space")
        expect(panel.locator("#toast")).to_contain_text("Approved answer saved")
        panel.locator("#continue").press("Space")
        expect(portal.locator("#method")).to_have_value("Email", timeout=15000)
        expect(portal.locator("#privacy")).to_be_checked()
        print("Unpacked panel: approved contact and employment; missing scoped answer prompted, saved, and filled", flush=True)
    finally:
        context.close()
        backend.terminate()
        backend.wait(timeout=5)

    context, _, restarted_id = launch(playwright, directory)
    assert restarted_id == extension_id
    backend = start_backend(directory, restarted_id)
    try:
        portal, panel = setup_panel(context, restarted_id)
        panel.locator("#fill").press("Space")
        expect(portal.locator("#last")).to_have_value("Example")
        expect(portal.locator("#method")).to_have_value("Email", timeout=15000)
        expect(portal.locator("#privacy")).to_be_checked()
        expect(panel.locator("#missingAnswers")).to_be_empty()
        expect(panel.locator("#authorizationQueue details")).to_have_count(0)
        panel.locator('nav [data-tab="profile"]').click()
        expect(panel.locator("#prefPrivacy")).to_be_checked()
        panel.locator("#evidenceDetails summary").click()
        expect(panel.locator("#evidenceRecords")).to_contain_text("Fictional Systems")
        expect(panel.locator("#evidenceRecords")).to_contain_text("How should we contact you?")
        panel.get_by_role("button", name="Reduced fictional test time by 12.50%.", exact=True).press("Space")
        expect(panel.locator("#evidenceFields [name=metrics]")).to_have_value(re.compile(r"12\.50"))
        panel.locator("#evidenceFields [name=context]").fill("Fictional Pilot A")
        panel.locator('[data-evidence-decision="approve"]').press("Space")
        expect(panel.locator("#evidenceForm")).to_be_hidden()
        print("Restarted Chrome and backend: paired profile and approved answer survived; unchanged consent reused without a prompt", flush=True)
    finally:
        context.close()
        backend.terminate()
        backend.wait(timeout=5)
