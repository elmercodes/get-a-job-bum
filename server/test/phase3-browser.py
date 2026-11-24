"""End-to-end fictional Word tailoring in an unpacked Chrome extension."""
from io import BytesIO
import json
import os
from pathlib import Path
import re
import secrets
import socket
from subprocess import Popen, check_output
import sys
from tempfile import TemporaryDirectory
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
browser = sys.argv[1]
extension = repo / "extension"
token = secrets.token_hex(32)
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
base = f"http://127.0.0.1:{port}"

description = """Required qualifications
SQL reporting and a track record of reducing reporting time for data validation.
Preferred qualifications
AWS certification for data workloads.
"""


def api(endpoint, body=None):
    with urlopen(Request(base + "/api" + endpoint,
                         data=None if body is None else json.dumps(body).encode(),
                         headers={"Authorization": "Bearer " + token,
                                  "Content-Type": "application/json"}), timeout=10) as response:
        return json.load(response)


def launch(playwright, directory):
    context = playwright.chromium.launch_persistent_context(
        directory / "chrome", executable_path=browser, headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}",
              "--disable-background-networking", "--disable-sync"],
    )
    context.route("https://**/*", lambda route: route.abort())
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
    return context, worker, worker.url.split("/")[2]


def start(directory, extension_id):
    env = {"PATH": os.environ["PATH"], "CI": "true", "PORT": str(port),
           "AUTOJOB_TEST": "1", "AUTOJOB_DATA": str(directory / "app-data"),
           "AUTOJOB_TOKEN": token, "EXTENSION_ID": extension_id, "LLM_PROVIDER": "ollama",
           "OLLAMA_URL": "http://127.0.0.1:9", "OLLAMA_FALLBACK": "off",
           "DOTENV_CONFIG_PATH": str(directory / "absent.env")}
    with (directory / "server.log").open("a") as log:
        backend = Popen(["node", "server/src/index.js"], cwd=repo, env=env, stdout=log, stderr=log)
    for _ in range(45):
        try:
            if api("/health")["ok"]:
                return backend
        except OSError:
            if backend.poll() is not None:
                break
            time.sleep(0.1)
    backend.terminate()
    backend.wait(timeout=5)
    raise AssertionError("Test backend did not start")


def stop(context, backend):
    context.close()
    backend.terminate()
    backend.wait(timeout=10)


def open_panel(context, extension_id):
    portal = context.pages[0]
    portal.goto(base + "/test/phase3-form.html")
    panel = context.new_page()
    panel.goto(f"chrome-extension://{extension_id}/sidepanel.html")
    expect(panel.locator("#status")).to_have_class("pill ok")
    return portal, panel


def save(kind, data):
    revision = api("/evidence")["revision"]
    return api("/evidence/records", {"kind": kind, "data": data, "decision": "approve", "revision": revision})["record"]["id"]


def download(panel, selector):
    with panel.expect_download() as file:
        panel.locator(selector).press("Space")
    return file.value.suggested_filename, file.value.path().read_bytes()


with TemporaryDirectory() as folder, sync_playwright() as playwright:
    directory = Path(folder)
    fixture = check_output(["node", "--input-type=module", "-e",
                            "import {makeDocx} from './server/test/docx-fixture.mjs'; process.stdout.write(await makeDocx())"], cwd=repo)
    fixture_path = directory / "fictional-source.docx"
    fixture_path.write_bytes(fixture)
    context, worker, extension_id = launch(playwright, directory)
    backend = start(directory, extension_id)
    try:
        worker.evaluate("([server, apiToken]) => chrome.storage.local.set({server, apiToken, autoNext:false, autoCover:false})", [base, token])
        save("employment", {"title": "Engineer", "company": "Fictional North Labs", "start": "2019", "end": "2021"})
        role = save("employment", {"title": "Engineer", "company": "Fictional South Labs", "start": "2022", "end": "Present"})
        accomplishment = save("accomplishment", {
            "original": "Utilized SQL to reduce reporting time by 12.50%.",
            "refs": [role], "metrics": [{"value": "12.50", "unit": "%", "label": "Reporting time"}],
        })
        save("skill", {"name": "SQL", "refs": [role]})
        portal, panel = open_panel(context, extension_id)
        panel.locator('nav [data-tab="profile"]').click()
        panel.locator("#resumeFile").set_input_files(fixture_path)
        panel.locator("#importResume").press("Space")
        expect(panel.locator("#toast")).to_contain_text("Resume extracted locally")
        panel.locator('nav [data-tab="apply"]').click()
        panel.locator("#jobTitle").locator("xpath=ancestor::details[1]/summary").click()
        panel.locator("#readJob").press("Space")
        expect(panel.locator("#jobTitle")).to_have_value("Data Engineer")
        expect(panel.locator("#jobCompany")).to_have_value("Fictional South Labs")
        expect(panel.locator("#jobDesc")).to_have_value(re.compile("SQL reporting"))
        panel.locator("#jobDesc").fill(description)
        panel.locator("#docxPanel").locator("xpath=ancestor::details[1]/summary").click()
        panel.locator("#docxPanel > summary").click()
        expect(panel.locator("#docxSource")).to_have_value(re.compile(r"^[a-f0-9-]{36}$"))
        panel.locator("#docxAnalyze").press("Space")
        expect(panel.locator("#docxStatus")).to_contain_text("Awaiting review")
        edit = panel.locator("#docxEdits fieldset").filter(has_text="Prepared routine fictional reports.")
        expect(edit).to_have_count(1)
        expect(edit).to_contain_text("12.50%")
        for control in panel.locator("#docxEdits .docx-decision").all():
            control.select_option("reject")
        edit.locator(".docx-decision").select_option("accept")
        wording = edit.locator(".docx-wording")
        wording.fill("Reduced reporting time by 30%.")
        panel.locator("#docxExport").press("Space")
        expect(panel.locator("#docxStatus")).to_contain_text("does not match its approved source")
        expect(panel.locator("#docxArtifacts")).to_be_hidden()
        wording.fill("Utilized SQL to reduce reporting time by 12.50%.")
        panel.locator("#docxIncludePdf").check()
        panel.locator("#docxExport").press("Space")
        expect(panel.locator("#docxStatus")).to_contain_text("Ready for download", timeout=90000)
        prepared = api("/applications")["items"][0]
        assert prepared["status"] == "prepared" and prepared["resumeVersion"] and "appliedAt" not in prepared
        name, final = download(panel, "#docxDownload")
        assert re.fullmatch(r"tailored-resume-[a-f0-9]{10}\.docx", name)
        with ZipFile(BytesIO(final)) as artifact, ZipFile(BytesIO(fixture)) as original:
            xml = artifact.read("word/document.xml")
            assert b"Utilized SQL to reduce reporting time by 12.50%." in xml
            assert b"30%" not in xml
            assert artifact.read("word/header1.xml") == original.read("word/header1.xml")
            assert artifact.read("word/styles.xml") == original.read("word/styles.xml")
        if panel.locator("#docxDownloadPdf").is_visible():
            pdf_name, pdf = download(panel, "#docxDownloadPdf")
            assert pdf_name.removesuffix(".pdf") == name.removesuffix(".docx")
            assert pdf.startswith(b"%PDF-")
            print("Unpacked Chrome: downloaded the verified same-version PDF", flush=True)
        else:
            expect(panel.locator("#docxValidation")).to_contain_text("PDF is unavailable")
        panel.locator("#docxAttach").press("Space")
        expect(panel.locator("#docxUploadSelection")).to_contain_text("for this application")
        panel.locator("#fill").press("Space")
        expect(panel.locator("#authorizationQueue [data-attachment]")).to_have_count(1)
        assert portal.locator("#resume").evaluate("(input) => input.files.length") == 0
        panel.locator("#authorizationQueue [data-attachment]").press("Space")
        expect(panel.locator("#authorizationQueue [data-attachment]")).to_have_count(0)
        expect(panel.locator("#continue")).to_be_enabled(timeout=15000)
        panel.locator("#continue").press("Space")
        expect(portal.locator("#resume")).to_have_value(re.compile(re.escape(name)), timeout=15000)
        assert portal.locator("#resume").evaluate("(input) => input.files[0].size") == len(final)
        expect(portal.locator("#marketing")).not_to_be_checked()
        assert portal.locator("html").get_attribute("data-submitted") is None
        expect(panel.locator("#reviewApplication")).to_be_enabled()
        assert any(accomplishment in edit["evidenceIds"] for edit in api("/docx/reviews/" + panel.locator("#docxSavedReview").input_value())["review"]["proposals"])
        print("Unpacked Chrome: captured and pasted posting, imported DOCX, rejected an invented metric, edited and approved a variant, downloaded and separately approved fixture upload; application stayed unsubmitted", flush=True)
    finally:
        stop(context, backend)

    context, _, restarted_id = launch(playwright, directory)
    assert restarted_id == extension_id
    backend = start(directory, extension_id)
    try:
        _, panel = open_panel(context, extension_id)
        panel.locator("#docxPanel").locator("xpath=ancestor::details[1]/summary").click()
        panel.locator("#docxPanel > summary").click()
        expect(panel.locator("#docxSavedReview option")).to_have_count(2)
        panel.locator("#docxSavedReview").select_option(index=1)
        panel.locator("#docxOpenReview").press("Space")
        expect(panel.locator("#docxValidation")).to_contain_text("Latest validated version")
        expect(panel.locator("#jobTitle")).to_have_value("Data Engineer")
        assert download(panel, "#docxDownload") == (name, final)
        print("Restarted Chrome and backend: private saved review and checksum-verified artifact reopened and downloaded", flush=True)
    finally:
        stop(context, backend)
