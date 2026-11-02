"""
End-to-end browser test: the real built app + mock_supabase.py + real Postgres with schema.sql.
Three separate browsers: the owner (Deepak), an anonymous sender (B) and an anonymous room guest (C).
Usage: bash supabase/tests/e2e/run.sh
"""
import datetime as dt, json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE, API, ANON = 'http://127.0.0.1:4173/', 'http://127.0.0.1:54321', 'anon-key-test-0123456789'
results, js_errors = [], []

def check(label, cond, extra=''):
    results.append((label, bool(cond)))
    print(('ok   ' if cond else 'FAIL ') + label + (f'  [{extra}]' if (extra and not cond) else ''), flush=True)

def new_ctx(browser, name):
    ctx = browser.new_context(permissions=['microphone'], viewport={'width': 1200, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
    ctx.on('page', lambda pg: (pg.on('pageerror', lambda e: js_errors.append(f'{name}: {e}')),
                               pg.on('console', lambda m: js_errors.append(f'{name}: {m.text}') if m.type == 'error' and not re.search(r'WebSocket|realtime|ERR_|fonts|Failed to load resource|status of 4', m.text) else None)))
    return ctx

def go(pg, url):
    pg.goto('about:blank'); pg.goto(url)   # always a real page load, even when only the #hash differs

def clear_cooldown(pg):
    pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('wh_cd_')).forEach(k => localStorage.removeItem(k))")

def send_text(pg, link, text, category='general', mood=None, unlock=None):
    go(pg, link); pg.wait_for_selector('#m')
    pg.fill('#m', text)
    if mood: pg.get_by_role('button', name=re.compile(mood)).click()
    if unlock: pg.fill('#u', unlock)
    else: pg.select_option('#c', category)
    pg.get_by_role('button', name='Send anonymously').click()
    pg.get_by_role('heading', name='Sent.').wait_for(timeout=8000)
    clear_cooldown(pg)

def blobs(): return json.load(urllib.request.urlopen(API + '/__state'))['blobs']
def api_get(path):
    req = urllib.request.Request(API + path, headers={'apikey': ANON, 'Authorization': 'Bearer ' + ANON})
    return json.load(urllib.request.urlopen(req))

tomorrow = (dt.datetime.now() + dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M')

with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    A_ctx, B_ctx, C_ctx = new_ctx(br, 'owner'), new_ctx(br, 'senderB'), new_ctx(br, 'guestC')
    A, B, C = A_ctx.new_page(), B_ctx.new_page(), C_ctx.new_page()
    for pg in (A, B, C): pg.on('dialog', lambda d: d.accept()); pg.set_default_timeout(12000)

    # ------------------------------------------------------------ sign up
    go(A, BASE); A.get_by_role('link', name='Get my inbox').click()
    A.fill('#n', 'Deepak'); A.fill('#e', 'deepak@example.com'); A.fill('#p', 'secret123')
    A.get_by_role('button', name='Create inbox').click()
    A.get_by_role('heading', name="Deepak's inbox").wait_for()
    link = A.input_value('input[aria-label="Your share link"]')
    check('owner can sign up and gets a share link', re.fullmatch(r'http://127\.0\.0\.1:4173/#/u/deepak-[a-z0-9]{4}', link), link)

    # ------------------------------------------------------------ skip link (was broken with HashRouter)
    A.keyboard.press('Tab'); A.keyboard.press('Enter')
    check('skip link no longer breaks routing', 'Page not found' not in A.inner_text('body') and '/dashboard' in A.url, A.url)

    # ------------------------------------------------------------ anonymous sender
    go(B, link); B.get_by_role('heading', name='Write to Deepak').wait_for()
    check('sender page opens with no login', True)
    send_text(B, link, 'You should improve the demo pacing, it felt rushed.', category='feedback', mood='Sad')
    send_text(B, link, 'Great talk, thank you so much!', category='praise', mood='Happy')
    send_text(B, link, 'See you in the future', unlock=tomorrow)
    # voice note with a fake microphone
    go(B, link); B.get_by_role('tab', name='Voice note').click()
    B.get_by_label('Start recording').click(); B.wait_for_timeout(2200); B.get_by_label('Stop recording').click()
    B.wait_for_selector('audio', timeout=8000)
    before = len(blobs())
    B.get_by_role('button', name='Send anonymously').click(); B.get_by_role('heading', name='Sent.').wait_for(timeout=10000)
    clear_cooldown(B)
    check('voice note uploads', len(blobs()) == before + 1, str(blobs()))

    # ------------------------------------------------------------ owner reads
    A.reload(); A.get_by_role('heading', name="Deepak's inbox").wait_for()
    A.wait_for_selector('article.msg', timeout=8000)
    stats = [x.inner_text().replace('\n', ' ') for x in A.query_selector_all('.stat')]
    check('owner sees 3 readable messages and 1 sealed capsule', stats[0].startswith('3') and stats[3].startswith('1'), str(stats))
    body = A.inner_text('main')
    check('sealed capsule content stays hidden from the owner', 'See you in the future' not in body and 'opens' in body)
    check('sent text appears in the inbox', 'Great talk, thank you so much!' in body)
    check('tab title shows unread count', A.title().startswith('(3)'), A.title())
    pos = A.locator('h3', has_text='Positive feedback').locator('..').inner_text()
    imp = A.locator('h3', has_text='Suggestions to improve').locator('..').inner_text()
    check('TruthBox splits praise from suggestions', 'Great talk' in pos and 'should improve' in imp, pos + '|' + imp)
    A.get_by_role('button', name='Voice', exact=True).click()
    check('voice filter shows the voice note', A.locator('article.msg').count() == 1)
    A.get_by_role('button', name=re.compile('Play voice note')).click(); A.wait_for_selector('audio', timeout=8000)
    check('owner can play an unlocked voice note', True)
    A.get_by_role('button', name='All', exact=True).click()
    A.locator('article.msg', has_text='Great talk').get_by_role('button', name='Mark read').click()
    A.wait_for_function("document.title.startsWith('(2)')"); check('mark read updates the unread count', True)
    A.get_by_role('button', name=re.compile('Sad')).first.click()
    check('mood filter works', A.locator('article.msg').count() == 1 and 'should improve' in A.inner_text('main'))
    A.get_by_role('button', name='All', exact=True).click()
    A.screenshot(path='/tmp/e2e_dashboard.png', full_page=True)

    # ------------------------------------------------------------ block sender
    A.locator('article.msg', has_text='should improve').get_by_role('button', name='Block sender').click()
    A.wait_for_function("!document.body.innerText.includes('should improve')")
    check('blocking deletes that message', True)
    check('dashboard shows blocked sender count', '1 blocked sender' in A.inner_text('main'))
    n0 = len(blobs())
    go(B, link); B.fill('#m', 'message after being blocked'); B.get_by_role('button', name='Send anonymously').click()
    B.get_by_role('heading', name='Sent.').wait_for()
    check('blocked sender still sees "Sent." (not told)', True)
    clear_cooldown(B)
    B.get_by_role('link', name='Send another').count()
    go(B, link); B.get_by_role('tab', name='Voice note').click()
    B.get_by_label('Start recording').click(); B.wait_for_timeout(1800); B.get_by_label('Stop recording').click(); B.wait_for_selector('audio')
    B.get_by_role('button', name='Send anonymously').click(); B.get_by_role('heading', name='Sent.').wait_for(timeout=10000)
    check('blocked sender leaves no orphan audio file', len(blobs()) == n0, str(blobs()))
    A.reload(); A.get_by_role('heading', name="Deepak's inbox").wait_for(); A.wait_for_selector('article.msg')
    check('blocked sender\'s messages never reach the owner', 'after being blocked' not in A.inner_text('main'))
    A.get_by_role('button', name='Unblock all').click(); A.wait_for_function("!document.body.innerText.includes('blocked sender')")
    check('unblock all works', True)

    # ------------------------------------------------------------ owner blocks own test message, then seals a future-self note
    go(A, link); A.fill('#m', 'my own test message'); A.get_by_role('button', name='Send anonymously').click(); A.get_by_role('heading', name='Sent.').wait_for()
    go(A, BASE + '#/dashboard'); A.get_by_role('heading', name="Deepak's inbox").wait_for()
    A.locator('article.msg', has_text='my own test message').get_by_role('button', name='Block sender').click()
    A.wait_for_function("!document.body.innerText.includes('my own test message')")
    A.fill('#fs', 'Dear future me'); A.fill('#fd', tomorrow); A.get_by_role('button', name='Seal it').click()
    A.wait_for_selector('text=Sealed. It will appear here')
    A.reload(); A.get_by_role('heading', name="Deepak's inbox").wait_for(); A.wait_for_selector('.stat')
    stats = [x.inner_text().replace('\n', ' ') for x in A.query_selector_all('.stat')]
    check('blocking your own test message does not swallow future-self notes', stats[3].startswith('2'), str(stats))
    import subprocess   # let the sender's capsule "arrive": move its unlock time into the past (as time passing would)
    subprocess.run(['psql', '-X', '-q', '-h', '/var/run/postgresql', 'wh_e2e', '-c', "update public.messages set unlock_at = now() - interval '1 minute' where body = 'See you in the future'"], check=True)
    A.reload(); A.get_by_role('heading', name="Deepak's inbox").wait_for(); A.wait_for_selector('article.msg')
    A.get_by_role('button', name='Capsules', exact=True).click()
    cap = A.locator('article.msg').all_inner_texts()
    check('an unlocked capsule from a sender appears under the Capsules filter', len(cap) == 1 and 'See you in the future' in cap[0] and 'Time capsule' in cap[0], str(cap))
    A.get_by_role('button', name='All', exact=True).click()

    # ------------------------------------------------------------ private room (Campus Rooms)
    go(A, BASE + '#/rooms'); A.fill('#rn', 'Secret Club'); A.get_by_label(re.compile('Show in the public list')).uncheck()
    A.get_by_role('button', name='Create room').click(); A.wait_for_url(re.compile(r'#/room/[A-Z0-9]{6}$'))
    code = A.url.split('/')[-1]
    check('owner creates an unlisted room', re.match(r'^[A-Z0-9]{6}$', code), code)
    A.fill('input[aria-label="Message"]', 'hello from owner'); A.get_by_role('button', name='Send', exact=True).click()
    A.wait_for_selector('.bub.mine'); check('owner posts and sees "(you)"', '(you)' in A.inner_text('.bub.mine'))

    go(C, BASE + '#/rooms')
    C.wait_for_selector('text=No public rooms here yet')
    check('unlisted room is not in the public list', 'Secret Club' not in C.inner_text('main'))
    check('API does not list unlisted rooms either', all(r['code'] != code for r in api_get('/rest/v1/rooms?select=code')))
    check('API does not expose unlisted room messages', api_get('/rest/v1/room_messages?select=body') == [])
    go(C, BASE + f'#/room/{code}'); C.get_by_role('heading', name='Secret Club').wait_for()
    C.wait_for_selector('text=hello from owner', timeout=8000)
    check('guest with the code can open the unlisted room', True)
    C.fill('input[aria-label="Message"]', 'hi from guest'); C.get_by_role('button', name='Send', exact=True).click()
    C.wait_for_selector('.bub.mine'); A.wait_for_selector('text=hi from guest', timeout=9000)
    check('messages travel both ways (live refresh)', True)

    bub = C.locator('.bub', has_text='hello from owner')
    bub.get_by_label('React 🔥').click(); C.wait_for_selector('.bub button:has-text("🔥 1")')
    check('emoji reaction counts', True)
    bub.get_by_role('button', name='Report').click(); C.wait_for_selector('text=Reported. The room owner will review it.')
    A.wait_for_selector('text=1 report', timeout=9000); check('owner sees the report', True)

    A.fill('input[aria-label="Poll question"]', 'Pizza?'); A.fill('input[aria-label="Option 1"]', 'Yes'); A.fill('input[aria-label="Option 2"]', 'No')
    A.get_by_role('button', name='Post poll').click()
    C.wait_for_selector('text=Pizza?', timeout=9000); C.get_by_role('button', name=re.compile('^Yes')).click()
    C.wait_for_selector('text=1 vote'); check('poll vote shows result', True)
    C.reload(); C.get_by_role('heading', name='Secret Club').wait_for(); C.wait_for_selector('text=1 vote')
    check('a second vote from the same browser is blocked', C.get_by_role('button', name=re.compile('^Yes')).is_disabled())

    A.locator('.bub', has_text='hi from guest').get_by_role('button', name='Remove').click()
    C.wait_for_function("!document.body.innerText.includes('hi from guest')", timeout=9000)
    check('owner removes a message and it disappears for everyone', True)

    # ------------------------------------------------------------ public room still gets live updates
    go(A, BASE + '#/rooms'); A.fill('#rn', 'Open Lounge'); A.get_by_role('button', name='Create room').click(); A.wait_for_url(re.compile(r'#/room/'))
    pcode = A.url.split('/')[-1]
    go(C, BASE + '#/rooms'); C.wait_for_selector('text=Open Lounge'); check('public room is listed', True)
    go(C, BASE + f'#/room/{pcode}'); C.fill('input[aria-label="Message"]', 'public hello'); C.get_by_role('button', name='Send', exact=True).click()
    A.wait_for_selector('text=public hello', timeout=9000); check('public room works', True)

    # ------------------------------------------------------------ sign out / back in
    A.get_by_role('button', name='Sign out').click(); A.get_by_role('link', name='Get my inbox').wait_for()
    go(A, BASE + '#/dashboard'); A.wait_for_url(re.compile(r'#/auth')); check('dashboard needs login', True)
    A.get_by_role('button', name='I already have an account').click()
    A.fill('#e', 'deepak@example.com'); A.fill('#p', 'wrong-pass'); A.get_by_role('button', name='Log in').click()
    A.wait_for_selector('text=Invalid login credentials'); check('wrong password is rejected', True)
    A.fill('#p', 'secret123'); A.get_by_role('button', name='Log in').click(); A.get_by_role('heading', name="Deepak's inbox").wait_for()
    check('log in works', True)
    br.close()

bad = [e for e in js_errors if e]
check('no JavaScript errors in any browser', not bad, '; '.join(bad[:5]))
failed = [l for l, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
sys.exit(1 if failed else 0)
