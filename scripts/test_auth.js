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
let insertShouldFail = false;
let lastAuthCall = null;
let completionRows = [];      // rows a training_completions query should return
let lastCompletionInsert = null;

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
          select: () => ({
            eq: () => {
              // real supabase-js query builders are themselves thenable AND
              // chainable - awaiting .eq(...) directly (for "give me every
              // matching row") and calling .maybeSingle() on it (for "give
              // me the one row or null") both need to work, matching how
              // checkApproval and loadCompletions actually call this.
              const rows = table === 'staff_profiles' ? (approvedAt !== null ? [{ approved_at: approvedAt }] : [])
                : table === 'training_completions' ? completionRows : [];
              const result = Promise.resolve({ data: rows, error: null });
              result.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
              return result;
            },
          }),
          insert: (row) => {
            if (insertShouldFail) return Promise.resolve({ error: { message: 'simulated insert failure' } });
            if (table === 'staff_profiles') insertedProfile = row;
            if (table === 'training_completions') lastCompletionInsert = row;
            return Promise.resolve({ error: null });
          },
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
    ok('gate error text shows it', doc.getElementById('gateerr').textContent.includes('Email link is invalid or has expired'));
    // the initial boot's own onSignedOut() call (no session on this URL)
    // is what displays it, and clears it in the same pass - confirms the
    // fix for the stale-redisplay-on-a-later-unrelated-sign-out bug: once
    // shown, it doesn't linger to reappear on some future sign-out that
    // has nothing to do with the original dead link.
    ok('AUTH_URL_ERROR is cleared after being shown once, not left to linger', ev('AUTH_URL_ERROR') === null,
       'got ' + JSON.stringify(ev('AUTH_URL_ERROR')));
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

    // the mock's signUp always returns no session, so the block above just
    // triggered the "check your email" info message, which sets the error
    // element's color to a muted, non-error tone. A later real error must
    // not stay stuck in that color.
    ok('the "check your email" message uses the muted, non-error color',
       doc.getElementById('signuperr').style.color !== '', doc.getElementById('signuperr').style.color);
    set('supass2', 'somethingelse');
    click('signupbtn'); await new Promise((r) => setTimeout(r, 50));
    ok('a real error after that resets back to the default error color, not left muted',
       doc.getElementById('signuperr').style.color === '', doc.getElementById('signuperr').style.color);
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

  console.log('\n--- 6. checkApproval fails closed and logs when the profile-row insert fails ---');
  await withDom(null, async (win, ev) => {
    const errors = [];
    win.console.error = (...args) => errors.push(args.join(' '));
    approvedAt = null; insertShouldFail = true;
    const approved = await ev('checkApproval').call(null, { user: { id: 'u2', email: 'x@cambridgewine.com' } });
    insertShouldFail = false;
    ok('treated as not approved when the insert fails, not silently approved', approved === false);
    ok('the failure is actually logged, not swallowed', errors.some((e) => /failed to create staff_profiles row/.test(e)),
       JSON.stringify(errors));
  });

  console.log('\n--- 7. training module ids are unique across courses ---');
  await withDom(null, async (win, ev) => {
    const ids = ev("allMods().map(m=>m.id)");
    ok('no duplicate module ids across any course', new Set(ids).size === ids.length,
       `${ids.length} ids, ${new Set(ids).size} unique`);
    ok('cellar\'s pouring module resolves to itself, not comp\'s id-colliding module',
       ev("allMods().find(m=>m.id==='cl1').t") === 'Pouring a perfect pint');
    ok('comp\'s c1 still resolves to its own module, unaffected by the rename',
       ev("allMods().find(m=>m.id==='c1').t") === 'Licensing Act 2003: the framework');
  });

  console.log('\n--- 8. quiz completions are actually saved and reloaded, not just kept in memory ---');
  await withDom(null, async (win, ev) => {
    ev("SESSION={user:{id:'u3',email:'staff@cambridgewine.com'}}");

    lastCompletionInsert = null;
    await ev('saveCompletion').call(null, 'w1', 3, 3, { 0: 1, 1: 0, 2: 2 });
    ok('passing a quiz inserts into training_completions', lastCompletionInsert && lastCompletionInsert.module_id === 'w1',
       JSON.stringify(lastCompletionInsert));
    ok('the actual answers are stored, not just pass/fail',
       lastCompletionInsert && lastCompletionInsert.answers && lastCompletionInsert.answers[0] === 1);
    ok('recorded against the signed-in user, not left blank', lastCompletionInsert && lastCompletionInsert.user_id === 'u3');

    completionRows = [{ module_id: 'w1', score: 3, completed_at: '2026-01-01T00:00:00Z' }];
    await ev('loadCompletions').call(null);
    const done = ev("DONE['w1']");
    ok('a previously-saved completion is reloaded into DONE on sign-in, not lost on refresh',
       done && done.score === 3, JSON.stringify(done));
    ok('total is derived from the module\'s own quiz length, not just echoed from the row',
       done && done.total === ev("allMods().find(m=>m.id==='w1').q.length"));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
