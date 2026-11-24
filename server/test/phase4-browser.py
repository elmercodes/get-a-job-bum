"""Unpacked Chrome, production-mode pairing, and fictional interruption recovery."""
import json
import os
from pathlib import Path
import secrets
import socket
from subprocess import Popen
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from playwright.sync_api import Error as BrowserError, expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
extension = repo / "extension"
browser = sys.argv[1]
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
base = f"http://127.0.0.1:{port}"
form_url = base + "/phase4.html"
form = """<!doctype html><html lang="en"><title>Fictional Portal</title><main>
<h1>Fictional application</h1><form>
<label for="name">Full name</label><input id="name" name="name" value="Fictional Candidate" required>
<label><input id="marketing" type="checkbox">Subscribe to promotional emails</label>
<button type="submit">Submit application</button></form></main>
<script>window.submissionCount = 0;
document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault(); window.submissionCount++;
});</script></html>"""


def api(route, token, extension_id, data=None, expected=200, origin=None, paired=True):
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    if paired:
        headers["X-AutoJob-Extension"] = extension_id
    if origin:
        headers["Origin"] = origin
    request = Request(base + "/api" + route, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        with urlopen(request, timeout=3) as result:
            assert result.status == expected
            return json.load(result)
    except HTTPError as error:
        assert error.code == expected, f"Unexpected fixture response {error.code} for {route}"
        return json.load(error)


def start(directory, extension_id, token):
    env = {"PATH": os.environ["PATH"], "CI": "true", "PORT": str(port),
           "AUTOJOB_DATA": str(directory / "app-data"), "AUTOJOB_TOKEN": token, "EXTENSION_ID": extension_id,
           "LLM_PROVIDER": "ollama", "OLLAMA_URL": "http://127.0.0.1:9", "OLLAMA_FALLBACK": "off",
           "DOTENV_CONFIG_PATH": str(directory / "absent.env")}
    with (directory / "server.log").open("a") as log:
        backend = Popen(["node", "server/src/index.js"], cwd=repo, env=env, stdout=log, stderr=log)
    for _ in range(55):
        try:
            if api("/health", token, extension_id)["ok"]:
                return backend
        except OSError:
            if backend.poll() is not None:
                break
            time.sleep(0.12)
    backend.terminate()
    backend.wait(timeout=5)
    raise AssertionError("Unable to start isolated production-mode backend")


def stop(backend):
    backend.terminate()
    backend.wait(timeout=5)


def open_panel(context, extension_id):
    panel = context.new_page()
    panel.goto(f"chrome-extension://{extension_id}/sidepanel.html")
    return panel


def pair(panel, token):
    panel.locator('nav [data-tab="profile"]').click()
    if not panel.locator("#serverUrl").is_visible():
        panel.locator("#serverUrl").locator("xpath=ancestor::details[1]/summary").click()
    panel.locator("#serverUrl").fill(base)
    panel.locator("#apiToken").fill(token)
    panel.locator("#pairServer").press("Space")


def show(panel, field):
    if not panel.locator(field).is_visible():
        panel.locator(field).locator("xpath=ancestor::details[1]/summary").click()


with TemporaryDirectory() as folder, sync_playwright() as playwright:
    directory = Path(folder)
    context = playwright.chromium.launch_persistent_context(directory / "chrome", executable_path=browser, headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}", "--disable-background-networking", "--disable-sync"])
    context.route("https://**/*", lambda route: route.abort())
    context.route(form_url + "*", lambda route: route.fulfill(content_type="text/html", body=form))
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
    extension_id = worker.url.split("/")[2]
    token = secrets.token_hex(32)
    backend = start(directory, extension_id, token)
    try:
        api("/health", token, extension_id, expected=403, paired=False)
        api("/health", token, extension_id, expected=403, origin="https://unrelated.example.invalid")
        portal = context.pages[0]
        portal.goto(form_url)
        panel = open_panel(context, extension_id)
        pair(panel, token)
        expect(panel.locator("#status")).to_have_class("pill ok")
        expect(panel.locator("#apiToken")).to_have_value("")
        pair(panel, "0" * 64)
        expect(panel.locator("#toast")).to_contain_text("Pair the current backend token")
        assert worker.evaluate("(value) => chrome.storage.local.get('apiToken').then(s => s.apiToken === value)", token)
        panel.locator('nav [data-tab="apply"]').click()

        message = panel.evaluate("""async (url) => {
          const tab = (await chrome.tabs.query({url}))[0];
          const [{ result }] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: async () => {
            const response = await chrome.runtime.sendMessage({type: 'last-web-tab'}).catch(() => null);
            const storage = await chrome.storage.local.get('apiToken').catch(() => null);
            return {messageDenied: !response, tokenDenied: !storage?.apiToken};
          }});
          const valid = await chrome.runtime.sendMessage({type: 'last-web-tab'});
          const malformed = await chrome.runtime.sendMessage({type: 'side-panel-open?', since: 'bad'}).catch(() => null);
          return {...result, panelAccepted: valid?.id === tab.id, invalidShapeDenied: !malformed};
        }""", form_url)
        assert all(message.values()), message

        panel.locator("#reviewApplication").press("Space")
        expect(panel.locator("#submit")).to_be_enabled()
        assert len(api("/applications", token, extension_id)["items"]) == 1
        portal.reload()
        expect(panel.locator("#submit")).to_be_hidden()
        expect(panel.locator("#submitOut")).to_contain_text("application page changed")
        panel.locator("#reviewApplication").press("Space")
        expect(panel.locator("#submit")).to_be_enabled()
        panel.close()
        panel = open_panel(context, extension_id)
        expect(panel.locator("#status")).to_have_class("pill ok")
        expect(panel.locator("#submit")).to_be_hidden()
        prepared = api("/applications", token, extension_id)["items"]
        assert len(prepared) == 1 and prepared[0]["status"] == "prepared"
        assert portal.evaluate("window.submissionCount") == 0
        expect(portal.locator("#marketing")).not_to_be_checked()

        saved_routes = []
        panel.route("**/api/research", lambda route: saved_routes.append(route) if not saved_routes else route.fulfill(json={
            "company": "Fictional Employer", "requirements": [{"category": "required", "text": "Fictional newer skill"}],
            "unknown": ["Company overview could not be verified."], "inferences": [],
        }))
        show(panel, "#jobDesc")
        show(panel, "#research")
        panel.locator("#jobCompany").fill("Fictional Employer")
        panel.locator("#jobDesc").fill("SQL fictional posting text preserving the original description length.")
        with panel.expect_request("**/api/research"):
            panel.locator("#research").press("Space")
        panel.locator("#jobDesc").fill("AWS fictional posting text preserving the original description length.")
        expect(panel.locator("#researchOut")).to_be_empty()
        if saved_routes:
            try:
                saved_routes[0].fulfill(json={"company": "Fictional Stale Result", "unknown": ["Stale result"]})
            except BrowserError as error:
                if "canceled" not in str(error).lower() and "interception" not in str(error).lower():
                    raise
        expect(panel.locator("#research")).to_be_enabled()
        panel.locator("#research").press("Space")
        expect(panel.locator("#researchOut")).to_contain_text("Fictional newer skill")
        expect(panel.locator("#researchOut")).not_to_contain_text("Stale result")

        interrupted = {"url": form_url + "?interrupted=1", "nonce": str(uuid.uuid4()), "snapshot": secrets.token_hex(32), "label": "Submit application"}
        record = api("/submissions/review", token, extension_id, interrupted, expected=201)
        api("/submissions/" + record["id"] + "/authorize", token, extension_id, {**interrupted, "confirmed": True})
        stop(backend)
        rotated = secrets.token_hex(32)
        backend = start(directory, extension_id, rotated)
        api("/health", token, extension_id, expected=401)
        pair(panel, token)
        expect(panel.locator("#toast")).to_contain_text("Pair the current backend token")
        pair(panel, rotated)
        expect(panel.locator("#apiToken")).to_have_value("")
        pending = next(item for item in api("/applications", rotated, extension_id)["items"] if item["id"] == record["id"])
        assert pending["status"] == "submission_unverified" and "appliedAt" not in pending and "verifiedAt" not in pending
        api("/submissions/" + record["id"] + "/authorize", rotated, extension_id, {**interrupted, "confirmed": True}, expected=409)
        assert portal.evaluate("window.submissionCount") == 0
        print("Unpacked Chrome: production pairing and rotation, denied content-script storage and messages, refresh and panel recovery, stale research, and interrupted submission passed", flush=True)
    finally:
        stop(backend)
        context.close()
