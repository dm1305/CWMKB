// Coverage for the auth/sign-up/approval flow added this session. Every bug
// that actually reached the live Supabase project (duplicate #signin DOM
// id, HAD_URL_AUTH_PARAMS assuming the wrong URL shape) was exactly the
// class of thing tests like these would have caught first.
//
// Run: node scripts/test_auth.js  (needs `npm install jsdom` first, same as test_ai.js)
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'current-build', 'cwm-knowledge-base.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};

// approvedAt controls what the staff_profiles stub returns for the current
// test; null means "no profile row yet", a string means "approved at that
// time". Reset before each scenario that cares about approval state.
let approvedAt = null;
let insertedProfile = null;
let lastAuthCall = null;

function makeDom(url) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: url || 'http://localhost:8642/',
    beforeParse(window) {
      // real supabase-js auto-detects a session from access_token= in the
      // URL hash (detectSessionInUrl); simulate that here rather than
      // always returning null, or every invite/recovery-link test would
      // exercise the "no session" path instead of the one that matters.
      const sessionFromUrl = () => {
        const m = /access_token=([^&]+)/.exec(window.location.hash);
        return m ? { user: { id: 'url-user', email: 'invited@cambridgewine.com' } } : null;
      };
      window.supabase = { createClient: () => ({
        auth: {
          onAuthStateChange: () => {},
          getSession: () => Promise.resolve({ data: { session: sessionFromUrl() } }),
          signInWithPassword: (args) => { lastAuthCall = { fn: 'signInWithPassword', args }; return Promise.resolve({ error: null }); },
          signUp: (args) => { lastAuthCall = { fn: 'signUp', args }; return Promise.resolve({ data: { session: null }, error: null }); },
          updateUser: (args) => { lastAuthCall = { fn: 'updateUser', args }; return Promise.resolve({ error: null }); },
          signOut: () => Promise.resolve({ error: null }),
        },
        from: (table) => ({
          select: () => ({ eq: () => ({ maybeSingle: () =>
            Promise.resolve({ data: approvedAt !== null || table !== 'staff_profiles' ? { approved_at: approvedAt } : null }) }) }),
          insert: (row) => { insertedProfile = row; return Promise.resolve({}); },
        }),
      }) };
    },
  });
}

async function withDom(url, fn) {
  const dom = makeDom(url);
  await new Promise((r) => setTimeout(r, 300));
  const win = dom.window;
  const ev = (expr) => win.eval(expr);
  try { await fn(win, ev); } finally { dom.window.close(); }
}

(async () => {
  console.log('\n--- 1. HAD_URL_AUTH_PARAMS: detects a URL-based auth payload regardless of shape ---');
  await withDom('http://localhost:8642/current-build/cwm-knowledge-base.html', (win, ev) => {
    ok('plain load with no URL params: false', ev('HAD_URL_AUTH_PARAMS') === false);
  });
  await withDom('http://localhost:8642/current-build/cwm-knowledge-base.html#access_token=fake.jwt&refresh_token=fake&type=recovery', (win, ev) => {
    ok('hash with access_token+type (implicit flow): true', ev('HAD_URL_AUTH_PARAMS') === true);
  });
  await withDom('http://localhost:8642/current-build/cwm-knowledge-base.html?code=abc123', (win, ev) => {
    ok('bare ?code= in query (PKCE flow): true', ev('HAD_URL_AUTH_PARAMS') === true);
  });

  console.log('\n--- 2. error_description from a dead link is captured and shown, not swallowed ---');
  await withDom('http://localhost:8642/current-build/cwm-knowledge-base.html#error=access_denied&error_description=Email+link+is+invalid+or+has+expired', async (win, ev) => {
    await new Promise((r) => setTimeout(r, 100));
    const doc = win.document;
    ok('AUTH_URL_ERROR captured verbatim', ev('AUTH_URL_ERROR') === 'Email link is invalid or has expired');
    ok('gate error text shows it', doc.getElementById('gateerr').textContent.includes('Email link is invalid or has expired'));
  });

  console.log('\n--- 3. sign-up form validation ---');
  await withDom(null, async (win, ev) => {
    const doc = win.document;
    const set = (id, v) => { doc.getElementById(id).value = v; };
    const click = (id) => doc.getElementById(id).click();
    const err = () => doc.getElementById('signuperr').textContent;

    set('suemail', ''); set('supass1', ''); set('supass2', '');
    click('signupbtn'); await new Promise((r) => setTimeout(r, 50));
    ok('empty form rejected before calling signUp', err().length > 0 && lastAuthCall === null, err());

    set('suemail', 'test@example.com'); set('supass1', 'short'); set('supass2', 'short');
    click('signupbtn'); await new Promise((r) => setTimeout(r, 50));
    ok('password under 8 chars rejected', /8 characters/.test(err()), err());

    set('supass1', 'longenoughpassword'); set('supass2', 'doesnotmatch');
    click('signupbtn'); await new Promise((r) => setTimeout(r, 50));
    ok('mismatched passwords rejected', /do not match/.test(err()), err());

    lastAuthCall = null;
    set('supass2', 'longenoughpassword');
    click('signupbtn'); await new Promise((r) => setTimeout(r, 50));
    ok('valid form actually calls signUp', lastAuthCall && lastAuthCall.fn === 'signUp',
       JSON.stringify(lastAuthCall));
    ok('signUp called with the typed email/password', lastAuthCall.args.email === 'test@example.com'
       && lastAuthCall.args.password === 'longenoughpassword');
  });

  console.log('\n--- 4. set-password form validation (invite/recovery landing) ---');
  await withDom('http://localhost:8642/current-build/cwm-knowledge-base.html#access_token=fake.jwt&type=recovery', async (win, ev) => {
    const doc = win.document;
    ok('lands on the set-password panel, not plain sign-in',
       doc.getElementById('setpwpanel').style.display !== 'none'
       && doc.getElementById('signinpanel').style.display === 'none');

    doc.getElementById('newpass1').value = 'short';
    doc.getElementById('newpass2').value = 'short';
    doc.getElementById('setpwbtn').click();
    await new Promise((r) => setTimeout(r, 50));
    ok('short password rejected on set-password too',
       /8 characters/.test(doc.getElementById('setpwerr').textContent));
  });

  console.log('\n--- 5. handleSession routes by approval state, not just session presence ---');
  await withDom(null, async (win, ev) => {
    const doc = win.document;
    const fakeSession = { user: { id: 'u1', email: 'staff@cambridgewine.com' } };

    approvedAt = null; insertedProfile = null;
    await ev('handleSession').call(null, fakeSession);
    await new Promise((r) => setTimeout(r, 50));
    ok('no staff_profiles row yet: routes to pending-approval panel, not straight into the app',
       doc.getElementById('pendingpanel').style.display !== 'none');
    ok('a profile row gets created so the admin has something to approve',
       insertedProfile && insertedProfile.user_id === 'u1');
    ok('pending panel shows the actual email', doc.getElementById('pendingemail').textContent === 'staff@cambridgewine.com');

    approvedAt = null;
    await ev('handleSession').call(null, fakeSession);
    await new Promise((r) => setTimeout(r, 50));
    ok('still not approved: still pending, not signed in',
       doc.getElementById('pendingpanel').style.display !== 'none'
       && doc.getElementById('gate').classList.contains('off') === false);

    approvedAt = '2026-09-04T12:00:00Z';
    await ev('handleSession').call(null, fakeSession);
    await new Promise((r) => setTimeout(r, 50));
    ok('approved: gate closes, into the app', doc.getElementById('gate').classList.contains('off'));
    ok('avatar shows initials from the email', doc.getElementById('whoavatar').textContent.length > 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
