from pathlib import Path
from tempfile import TemporaryDirectory
from subprocess import Popen
from urllib.request import Request, urlopen
from playwright.sync_api import expect, sync_playwright
import base64, json, os, secrets, shutil, sys, time

repo = Path(__file__).resolve().parents[2]
browser = sys.argv[1]
port = os.environ.get('AUTOJOB_BROWSER_TEST_PORT', '18790')
base = 'http://127.0.0.1:' + port
token = secrets.token_hex(32)
with TemporaryDirectory() as folder, sync_playwright() as playwright:
    folder = Path(folder)
    data = folder / 'data'
    data.mkdir(mode=0o700)
    for source in Path(repo, 'server', 'test', 'fixtures').glob('*.json'):
        shutil.copyfile(source, data / source.name)
    profile = data / 'profile.json'
    applicant = json.loads(profile.read_text())
    applicant['personal']['dateOfBirth'] = '1990-01-01'
    applicant['documents'] = {'degree': 'degree.pdf'}
    documents = data / 'documents'
    documents.mkdir(mode=0o700)
    sample = Path(repo, 'server', 'test', 'sample.b64').read_text()
    (documents / 'degree.pdf').write_bytes(base64.b64decode(sample))
    profile.write_text(json.dumps(applicant))
    extension = str(Path(repo) / 'extension')
    context = playwright.chromium.launch_persistent_context(
        folder / 'chrome', executable_path=browser, headless=True,
        args=['--disable-background-networking', '--disable-sync',
              f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
    context.route('https://**/*', lambda route: route.abort())
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker', timeout=10000)
    extension_id = worker.url.split('/')[2]
    env = {'PATH':os.environ['PATH'], 'AUTOJOB_TOKEN':token, 'EXTENSION_ID':extension_id, 'AUTOJOB_TEST':'1',
        'AUTOJOB_DATA':str(data), 'PORT':port, 'CI':'true', 'LLM_PROVIDER':'ollama', 'OLLAMA_URL':'http://127.0.0.1:9',
        'OLLAMA_FALLBACK':'off', 'DOTENV_CONFIG_PATH':str(folder / 'missing')}
    with (folder / 'server.log').open('w') as log, Popen(['node','server/src/index.js'],cwd=repo,env=env,stdout=log,stderr=log) as server:
        try:
            def api(path):
                return json.load(urlopen(Request(base + '/api' + path, headers={'Authorization':'Bearer ' + token})))
            for i in range(30):
                try:
                    assert api('/health')['ok']
                    break
                except OSError:
                    time.sleep(0.25)
            worker.evaluate("""([server, apiToken]) => chrome.storage.local.set({server, apiToken, autoNext:true,
                autoCover:false, realTyping:false, visualCheck:false, researchFirst:false})""", [base, token])
            portal = context.pages[0]
            portal.goto(base + '/test/phase1-form.html')
            panel = context.new_page()
            panel.on('pageerror', lambda error: print('Panel error:', error, flush=True))
            panel.goto(f'chrome-extension://{extension_id}/sidepanel.html')
            expect(panel.locator('#status')).to_have_class('pill ok', timeout=10000)
            panel.locator('#fill').click()
            expect(portal.locator('#review')).to_be_visible(timeout=15000)
            expect(panel.locator('#fill')).to_be_enabled(timeout=15000)
            assert portal.evaluate('window.submissionCount') == 0
            assert not portal.locator('#privacy').is_checked()
            expect(panel.locator('#authorizationQueue details')).to_have_count(0)
            print('Unpacked extension: Next works, disabled consent untouched, synthetic form submission blocked', flush=True)
            panel.locator('nav [data-tab=profile]').click()
            for selector in ('#prefPrivacy','#prefLegal','#prefBackground','#prefSignature','#verifyFacts'):
                panel.locator(selector).check()
            panel.locator('#typedSignature').fill('Fictional Applicant')
            panel.locator('#saveAutomation').click()
            expect(panel.locator('#automationState')).to_contain_text('Signature stored locally')
            panel.locator('nav [data-tab=apply]').click()
            panel.locator('#continue').press('Enter')
            expect(panel.locator('#authorizationQueue details')).to_have_count(4, timeout=15000)
            assert portal.locator('#degree').evaluate('(input) => input.files.length') == 0
            panel.get_by_role('button', name='Approve attachment: degree.pdf').press('Space')
            for _ in range(4):
                panel.locator('#authorizationQueue button').first.click()
                time.sleep(0.2)
            expect(panel.locator('#authorizationQueue details')).to_have_count(0)
            expect(panel.locator('#continue')).to_be_enabled(timeout=15000)
            panel.locator('#continue').press('Space')
            expect(panel.locator('#continue')).to_be_enabled(timeout=15000)
            for selector in ('#privacy','#legal','#background'):
                expect(portal.locator(selector)).to_be_checked(timeout=15000)
            expect(portal.locator('#signature')).to_have_value('Fictional Applicant')
            assert portal.locator('#degree').evaluate('(input) => input.files[0]?.name') == 'degree.pdf'
            assert not portal.locator('#marketing').is_checked() and not portal.locator('#ambiguous').is_checked()
            assert portal.evaluate('window.submissionCount') == 0
            expect(panel.locator('#continue')).to_be_enabled(timeout=15000)
            portal.locator('#signature').press('Enter')
            assert portal.evaluate('window.submissionCount') == 0
            print('Unpacked extension: four scoped acknowledgments and a reviewed attachment applied; marketing and ambiguous untouched; Fill and Enter did not submit', flush=True)
            panel.locator('#reviewApplication').click()
            expect(panel.locator('#submit')).to_be_enabled(timeout=10000)
            assert api('/applications')['items'][0]['status'] == 'prepared'
            assert portal.evaluate('window.submissionCount') == 0
            panel.locator('#submit').evaluate('(button) => button.click()')
            assert portal.evaluate('window.submissionCount') == 0
            panel.locator('#submit').press('Space')
            expect(portal.locator('h1')).to_have_text('Application received')
            expect(panel.locator('#submitOut')).to_contain_text('Submission verified', timeout=10000)
            assert portal.evaluate('window.submissionCount') == 1
            record = api('/applications')['items'][0]
            assert record['status']=='applied' and record['preparedAt'] and record['verifiedAt']
            print('Unpacked extension: one explicit submit, verified receipt and separate timestamps', flush=True)
            portal.goto(base + '/test/phase1-form.html?unclear=1')
            portal.locator('#continue').click()
            portal.evaluate("""() => {
                document.getElementById('first').value = 'Fictional';
                for (const id of ['privacy', 'legal', 'background']) document.getElementById(id).checked = true;
                document.getElementById('signature').value = 'Fictional Applicant';
            }""")
            panel.locator('#reviewApplication').press('Space')
            expect(panel.locator('#submit')).to_be_enabled(timeout=10000)
            panel.locator('#submit').press('Space')
            expect(panel.locator('#submitOut')).to_contain_text('Submission unverified', timeout=10000)
            assert portal.evaluate('window.submissionCount') == 1
            pending = next(record for record in api('/applications')['items'] if record['status'] == 'submission_unverified')
            assert pending['submittedAt'] and 'verifiedAt' not in pending and 'appliedAt' not in pending
            panel.locator('#reviewApplication').press('Space')
            expect(panel.locator('#toast')).to_contain_text('previous attempt')
            assert portal.evaluate('window.submissionCount') == 1
            print('Unpacked extension: ambiguous result recorded as unverified; review retry did not click again', flush=True)

            portal.goto(base + '/test/phase1-form.html?changed=1')
            portal.locator('#continue').click()
            portal.evaluate("""() => {
                document.getElementById('first').value = 'Fictional';
                for (const id of ['privacy', 'legal', 'background']) document.getElementById(id).checked = true;
                document.getElementById('signature').value = 'Fictional Applicant';
            }""")
            panel.locator('#reviewApplication').press('Space')
            expect(panel.locator('#submit')).to_be_enabled(timeout=10000)
            portal.locator('#signature').evaluate("(input) => input.value = 'Changed value'")
            panel.locator('#submit').press('Space')
            expect(panel.locator('#submitOut')).to_contain_text('Submission unverified', timeout=10000)
            assert portal.evaluate('window.submissionCount') == 0
            print('Unpacked extension: changing the reviewed form invalidated the click', flush=True)

        finally:
            server.terminate()
            context.close()
