"""Fictional application, local OAuth callback, HTTP Sheets double, and restart."""
import json
import os
from pathlib import Path
import secrets
import socket
from subprocess import Popen, PIPE
import sys
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
chrome = sys.argv[1]
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
base = f"http://127.0.0.1:{port}"
portal_url = base + "/test/phase1-form.html"
token = secrets.token_hex(32)

def api(endpoint, body=None):
    request = Request(base + "/api" + endpoint, data=None if body is None else json.dumps(body).encode(),
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(request, timeout=4) as result:
        return json.load(result)

def start_server(root, google_port, extension_id):
    env = {"PATH": os.environ["PATH"], "CI": "true", "PORT": str(port),
           "AUTOJOB_TEST": "1", "AUTOJOB_DATA": str(root / "data-root"), "AUTOJOB_TOKEN": token,
           "EXTENSION_ID": extension_id, "LLM_PROVIDER": "ollama", "OLLAMA_URL": "http://127.0.0.1:9",
           "DOTENV_CONFIG_PATH": str(root / "absent.env"), "GAJ_FIXTURE_GOOGLE_PORT": str(google_port),
           "AUTOJOB_GOOGLE_CLIENT_ID": "fixture.apps.googleusercontent.com"}
    with (root / "backend.log").open("a") as log:
        process = Popen(["node", "--import", "./server/test/mock-google-fetch.mjs", "server/src/index.js"],
                        cwd=repo, env=env, stdout=log, stderr=log)
    for _ in range(50):
        try:
            if api("/health")["ok"]:
                return process
        except OSError:
            if process.poll() is not None:
                break
            time.sleep(0.1)
    process.terminate()
    process.wait(timeout=5)
    raise AssertionError("Fixture backend failed to start")

def launch(playwright, root):
    extension = repo / "extension"
    context = playwright.chromium.launch_persistent_context(root / "chrome", executable_path=chrome, headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
              "--disable-background-networking", "--disable-sync", "--no-proxy-server",
              "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"])
    context.route("https://**/*", lambda route: route.abort())
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
    return context, worker, worker.url.split("/")[2]

def panel_page(context, extension_id):
    panel = context.new_page()
    panel.goto(f"chrome-extension://{extension_id}/sidepanel.html")
    expect(panel.locator("#status")).to_have_class("pill ok")
    return panel

def tracker(panel):
    panel.locator('nav [data-tab="tracker"]').click()
    panel.locator("#sheetsPanel summary").click()
    expect(panel.locator("#sheetsStatus")).to_contain_text("Google")

with TemporaryDirectory() as work, sync_playwright() as playwright:
    root = Path(work)
    google = Popen(["node", "server/test/mock-sheets.mjs", "--listen"], cwd=repo, stdout=PIPE, text=True)
    google_origin = google.stdout.readline().strip()
    google_port = urlsplit(google_origin).port
    context = backend = None
    try:
        context, worker, extension_id = launch(playwright, root)
        backend = start_server(root, google_port, extension_id)
        worker.evaluate("([server,apiToken]) => chrome.storage.local.set({server,apiToken,autoNext:false,autoCover:false})", [base, token])
        portal = context.pages[0]
        portal.goto(portal_url)
        panel = panel_page(context, extension_id)
        tracker(panel)
        panel.locator("#addTitle").fill("Fictional Sheets role")
        panel.locator("#addCompany").fill("Fictional Sheets Employer")
        panel.locator("#addUrl").fill(portal_url)
        panel.locator("#addApp").press("Space")
        expect(panel.locator("#trackList")).to_contain_text("Fictional Sheets role")
        saved = api("/applications")["items"][0]
        assert saved["status"] == "saved" and "appliedAt" not in saved
        original_uuid = saved["applicationId"]
        # Chrome-created tabs can start navigating before Playwright intercepts them.
        # Replace the external response at the browser boundary and retain the real callback.
        panel.evaluate("""(callback) => {
          const original = chrome.tabs.create.bind(chrome.tabs);
          chrome.tabs.create = ({url}) => {
            const target = new URL(url);
            if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth'
              || target.searchParams.get('scope') !== 'https://www.googleapis.com/auth/drive.file'
              || target.searchParams.get('redirect_uri') !== callback) throw new Error('Unexpected browser fixture authorization');
            const params = new URLSearchParams({state: target.searchParams.get('state'), code: 'fixture-browser-code'});
            return original({url: callback + '?' + params});
          };
        }""", base + "/oauth/google-sheets/callback")
        with context.expect_page() as opened:
            panel.locator("#sheetsConnect").press("Space")
        oauth = opened.value
        expect(oauth.locator("body")).to_contain_text("authorization completed", timeout=10000)
        oauth.close()
        panel.locator("#sheetsRefresh").press("Space")
        expect(panel.locator("#sheetsStatus")).to_contain_text("Google connected")
        panel.locator("#sheetsCreate").press("Space")
        expect(panel.locator("#sheetsLink")).to_be_visible()
        expect(panel.locator("#sheetsStatus")).to_contain_text("Sync disabled")
        panel.locator("#sheetsToggle").press("Space")
        expect(panel.locator("#sheetsStatus")).to_contain_text("1 synchronized", timeout=15000)
        portal.locator("#continue").click()
        portal.evaluate("""() => {
          document.getElementById('first').value = 'Fictional';
          for (const id of ['privacy', 'legal', 'background']) document.getElementById(id).checked = true;
          document.getElementById('signature').value = 'Fictional Applicant';
        }""")
        panel.locator('nav [data-tab="apply"]').click()
        panel.locator("#reviewApplication").press("Space")
        expect(panel.locator("#submit")).to_be_enabled()
        prepared = api("/applications")["items"][0]
        assert prepared["status"] == "prepared" and prepared["applicationId"] == original_uuid
        assert portal.evaluate("window.submissionCount") == 0
        panel.locator("#submit").press("Space")
        expect(panel.locator("#submitOut")).to_contain_text("Submission verified", timeout=15000)
        applied = api("/applications")["items"][0]
        assert applied["applicationId"] == original_uuid and applied["status"] == "applied" and applied["verifiedAt"]
        panel.locator('nav [data-tab="tracker"]').click()
        panel.locator("#sheetsRetry").press("Space")
        expect(panel.locator("#sheetsStatus")).to_contain_text("1 synchronized", timeout=15000)
        for _ in range(30):
            if api("/sheets/status")["counts"].get("synchronized") == 1:
                break
            time.sleep(0.1)
        with urlopen(google_origin + "/fixture-state", timeout=4) as result:
            rows = json.load(result)["rows"]
        assert len(rows) == 2
        row = [cell["userEnteredValue"]["stringValue"] for cell in rows[1]]
        assert row[0] == original_uuid and row[9] == "applied" and row[8] == applied["appliedAt"]

        context.close()
        context = None
        backend.terminate()
        backend.wait(timeout=5)
        backend = None
        context, _, restarted_id = launch(playwright, root)
        assert restarted_id == extension_id
        backend = start_server(root, google_port, restarted_id)
        panel = panel_page(context, restarted_id)
        tracker(panel)
        expect(panel.locator("#sheetsStatus")).to_contain_text("1 synchronized")
        record = api("/applications")["items"][0]
        assert record["applicationId"] == original_uuid and record["verifiedAt"] == applied["verifiedAt"]
        panel.locator("#sheetsToggle").press("Space")
        expect(panel.locator("#sheetsStatus")).to_contain_text("Sync disabled")
        panel.locator("#addTitle").fill("Different fictional offline role")
        panel.locator("#addCompany").fill("Fictional Offline Employer")
        panel.locator("#addApp").press("Space")
        expect(panel.locator("#trackList")).to_contain_text("Different fictional offline role")
        panel.locator("#sheetsDisconnect").press("Space")
        expect(panel.locator("#sheetsStatus")).to_contain_text("Google disconnected")
        assert len(api("/applications")["items"]) == 2
        print("Unpacked Chrome: saved job, mock OAuth and sheet, prepared application, explicit fictional submit and receipt, sync, both restarts, and offline tracking passed")
    finally:
        if context:
            context.close()
        if backend:
            backend.terminate()
            backend.wait(timeout=5)
        google.terminate()
        google.wait(timeout=5)
