const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('/mnt/user-data/outputs/cwm-knowledge-base.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};

setTimeout(() => {
  // top-level const/let live in the global lexical scope, not on window,
  // so reach them through eval running in that same scope
  const ev = (expr) => win.eval(expr);
  const retrieve    = (q) => ev('retrieve(' + JSON.stringify(q) + ')');
  const resolveQuery= (q) => ev('resolveQuery(' + JSON.stringify(q) + ')');
  const budget      = (q) => ev('budget(' + JSON.stringify(q) + ')');
  const isRec       = (q) => ev('isRec(' + JSON.stringify(q) + ')');
  const fold        = (t) => ev('fold(' + JSON.stringify(t) + ')');
  const W           = ev('W');

  if (typeof ev('typeof retrieve') !== 'string' || ev('typeof retrieve') !== 'function') {
    console.log('FATAL: retrieve() not reachable'); process.exit(1);
  }

  const grapeCount = (n) => W.filter(w => (w.grapes || []).some(g => fold(g.n) === fold(n))).length;
  const winesIn = (r) => (r.used || []).filter(u => u.startsWith('Wine · ')).length;

  console.log('\n--- 1. synonyms reach the right grape ---');
  [['Shiraz', 'Syrah'], ['Garnacha', 'Grenache Noir'], ['Zinfandel', 'Primitivo'],
   ['Tinta Roriz', 'Tempranillo'], ['Monastrell', 'Mourvèdre']].forEach(([typed, canon]) => {
    const r = resolveQuery(typed);
    ok(`"${typed}" resolves to ${canon}`, r.grapes.some(g => fold(g) === fold(canon)),
       'got ' + JSON.stringify(r.grapes));
  });

  console.log('\n--- 2. accent folding ---');
  [['Semillon', 'Sémillon'], ['Mourvedre', 'Mourvèdre'], ['Albarino', 'Albariño'],
   ['Gewurztraminer', 'Gewürztraminer'], ['Gruner Veltliner', 'Grüner Veltliner']].forEach(([typed, canon]) => {
    const r = resolveQuery(typed);
    ok(`"${typed}" reaches ${canon} (${grapeCount(canon)} wines)`,
       r.grapes.some(g => fold(g) === fold(canon)), 'got ' + JSON.stringify(r.grapes));
  });

  console.log('\n--- 3. traps that must NOT map ---');
  ok('"Petite Sirah" does not resolve to Syrah',
     !resolveQuery('Petite Sirah').grapes.some(g => g === 'Syrah'),
     JSON.stringify(resolveQuery('Petite Sirah').grapes));
  ok('"Auxerrois" does not resolve to Malbec',
     !resolveQuery('Auxerrois').grapes.some(g => g === 'Malbec'),
     JSON.stringify(resolveQuery('Auxerrois').grapes));
  ok('"Grenache Blanc" does not resolve to Grenache Noir',
     !resolveQuery('Grenache Blanc').grapes.some(g => g === 'Grenache Noir'),
     JSON.stringify(resolveQuery('Grenache Blanc').grapes));

  console.log('\n--- 4. phrase matching stops Pinot over-match ---');
  const pg = retrieve('Pinot Grigio');
  const pgWines = (pg.used || []).filter(u => u.startsWith('Wine · ')).map(u => u.slice(7));
  const pgIsGris = pgWines.every(nm => {
    const w = W.find(x => x.name === nm);
    return w && (w.grapes || []).some(g => fold(g.n) === 'pinot gris');
  });
  ok('every wine returned for "Pinot Grigio" is actually Pinot Gris', pgIsGris,
     pgWines.slice(0, 3).join(' | '));
  ok('"Pinot Grigio" resolves to exactly one grape',
     resolveQuery('Pinot Grigio').grapes.length === 1,
     JSON.stringify(resolveQuery('Pinot Grigio').grapes));

  console.log('\n--- 5. region hints widen and disclose ---');
  const rio = resolveQuery('what Rioja do we have');
  ok('Rioja resolves to Tempranillo', rio.grapes.includes('Tempranillo'));
  ok('Rioja hint is marked TYPICAL', rio.hints.some(h => /TYPICAL/.test(h)), JSON.stringify(rio.hints));
  const chab = resolveQuery('Chablis');
  ok('Chablis hint is marked REQUIRED', chab.hints.some(h => /REQUIRED/.test(h)), JSON.stringify(chab.hints));
  ok('context discloses the widening',
     /HOW THIS SEARCH WAS WIDENED/.test(retrieve('what Rioja do we have').ctx));

  console.log('\n--- 6. budget parsing ---');
  const cases = [['something under £15', 0, 15], ['a red around £20', 15, 25],
                 ['between £10 and £30', 10, 30], ['over £50', 50, 1e9]];
  cases.forEach(([q, lo, hi]) => {
    const b = budget(q);
    ok(`"${q}" -> ${lo}..${hi === 1e9 ? '∞' : hi}`,
       b && Math.abs(b.lo - lo) < 0.01 && Math.abs(b.hi - hi) < 0.01, JSON.stringify(b));
  });
  ok('a non-price question has no budget', budget('what grapes are in the Estaca') === null);

  console.log('\n--- 7. budget is actually enforced ---');
  const r15 = retrieve('recommend a red under £15');
  const over = (r15.used || []).filter(u => u.startsWith('Wine · ')).map(u => u.slice(7))
    .map(nm => W.find(x => x.name === nm)).filter(w => w && w.price > 15);
  ok('no wine over £15 returned for "under £15"', over.length === 0,
     over.map(w => w.name + ' £' + w.price).join(', '));
  ok('budget disclosed in context', /BUDGET APPLIED/.test(r15.ctx));

  console.log('\n--- 8. recommendation spread ---');
  ['recommend a white wine', 'something red for a party', 'suggest a wine under £25'].forEach(q => {
    const r = retrieve(q);
    const n = winesIn(r);
    ok(`"${q}" returns 3-6 wines (got ${n})`, n >= 3 && n <= 6);
    const styles = {};
    (r.used || []).filter(u => u.startsWith('Wine · ')).forEach(u => {
      const w = W.find(x => x.name === u.slice(7)); if (w) styles[w.style] = (styles[w.style] || 0) + 1;
    });
    ok(`  no more than 2 of any one style`, Object.values(styles).every(v => v <= 2),
       JSON.stringify(styles));
  });

  console.log('\n--- 8b. wines lead a recommendation ---');
  ['recommend a red under £15','something white for under £12','suggest a red for a party','a wine for a barbecue'].forEach(q=>{
    const secs=retrieve(q).ctx.split('\n').filter(l=>l.startsWith('## '))
      .filter(l=>!/BUDGET APPLIED|HOW THIS SEARCH|## NOTE/.test(l));
    ok(`"${q}" leads with WINES`, secs[0]==='## WINES', secs.join(' | '));
  });
  ok('food and occasion phrasing counts as a recommendation', isRec('a wine for a barbecue'));
  ok('a specific factual question does not', !isRec('what is the ABV of the Estaca'));
  ok('budget block warns that spirits and beer are unpriced',
     /Spirit, beer and cider records carry no price/.test(retrieve('recommend a red under £15').ctx));

  console.log('\n--- 9. specific questions are NOT diversified ---');
  ok('"what grapes are in the Estaca" is not treated as a recommendation',
     !isRec('what grapes are in the Estaca'));
  ok('"How was 2016 in Barolo" is not treated as a recommendation',
     !isRec('How was 2016 in Barolo'));

  console.log('\n--- 10. nothing else broke ---');
  const est = retrieve('what grapes are in the Estaca and how do we know');
  ok('Estaca question still returns wine records', winesIn(est) > 0);
  const law = retrieve('Someone refused for ID comes back with an older friend');
  ok('training module still leads for a compliance question',
     /## TRAINING/.test(law.ctx) && law.ctx.indexOf('## TRAINING') < (law.ctx.indexOf('## WINES') + 1 || 1e9));
  ok('glossary still retrievable', /## GLOSSARY/.test(retrieve('what is malolactic fermentation').ctx));
  ok('vintages still retrievable', /VINTAGE/.test(retrieve('How was 2016 in Barolo').ctx));
  ok('empty query is safe', retrieve('   ').ctx === '');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 2500);
