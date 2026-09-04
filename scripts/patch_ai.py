#!/usr/bin/env python3
"""
patch_ai.py - AI retrieval improvements for the CWM knowledge base.

Applies four changes to the Ask feature:
  1. Accent folding, so "Semillon" reaches the 16 Sémillon wines.
  2. Grape synonyms, so "Shiraz" reaches the 162 Syrah wines.
  3. Phrase-aware grape matching, so "Pinot Grigio" stops returning 209
     wines by matching "Pinot" against every Pinot Noir.
  4. A recommendation spread: 3 to 6 wines varying by style and price,
     with budget parsing.

Deliberately NOT included: acidity. The desc field is generated from the
structured fields and contains no sensory content, so there is nothing to
parse. Style is used as the weight axis instead.

Writes no output unless every anchor matched.
"""
import re, sys, pathlib

SRC = "/mnt/user-data/uploads/cwm-knowledge-base-patched.html"
OUT = "/mnt/user-data/outputs/cwm-knowledge-base.html"

s = pathlib.Path(SRC).read_text(encoding="utf-8")
orig_len = len(s)
applied = []


def sub_once(anchor, replacement, label):
    global s
    assert s.count(anchor) == 1, f"ANCHOR {label}: found {s.count(anchor)} times, expected 1"
    s = s.replace(anchor, replacement, 1)
    applied.append(label)


# ---------------------------------------------------------------- 1. tokeniser
A1 = ("const stem=w=>w.length>4&&w.endsWith('s')?w.slice(0,-1):w;\n"
      "const toks=t=>(String(t).toLowerCase().match(/[a-zà-ÿ0-9'’-]{3,}/g)||[])"
      ".filter(x=>!STOP.has(x)).map(stem);")

R1 = r"""/* Accent folding. Nobody on a shop floor types Sémillon with the accent,
   and 120 wines sat behind accented grape names. */
const fold=t=>String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stem=w=>w.length>4&&w.endsWith('s')?w.slice(0,-1):w;
const toks=t=>(fold(t).match(/[a-z0-9'’-]{3,}/g)||[]).filter(x=>!STOP.has(x)).map(stem);

/* ===== grape vocabulary =====
   Synonyms are reference data, not inference: Shiraz and Syrah are the same
   grape as a matter of fact. Region hints are appellation law and only ever
   widen the search - they never populate a grape field on a wine.

   Deliberate omissions, each of which would be a real error:
     "sirah"      - Petite Sirah is Durif, a different grape entirely
     "auxerrois"  - means Malbec in Cahors, but the Alsace white here
     "grenache"   - left to plain token matching, because Grenache Blanc
                    and Grenache Gris are both in the range                */
const GSYN={
 'shiraz':'Syrah',
 'garnacha':'Grenache Noir','garnacha tinta':'Grenache Noir','cannonau':'Grenache Noir',
 'garnacha blanca':'Grenache Blanc',
 'pinot grigio':'Pinot Gris','grauburgunder':'Pinot Gris','rulander':'Pinot Gris',
 'pinot nero':'Pinot Noir','spatburgunder':'Pinot Noir','blauburgunder':'Pinot Noir',
 'zinfandel':'Primitivo',
 'tinta roriz':'Tempranillo','aragonez':'Tempranillo','tinto fino':'Tempranillo',
 'tinta del pais':'Tempranillo','cencibel':'Tempranillo','ull de llebre':'Tempranillo',
 'monastrell':'Mourvedre','mataro':'Mourvedre',
 'pinot meunier':'Meunier',
 'steen':'Chenin Blanc',
 'alvarinho':'Albarino',
 'cot':'Malbec','auxerrois du lot':'Malbec',
 'carinena':'Carignan','mazuelo':'Carignan','samso':'Carignan','carignan noir':'Carignan',
 'brunello':'Sangiovese','prugnolo gentile':'Sangiovese','morellino':'Sangiovese',
 'spanna':'Nebbiolo','chiavennasca':'Nebbiolo',
 'trebbiano':'Ugni Blanc',
 'weissburgunder':'Pinot Blanc',
 'macabeu':'Macabeo','viura':'Macabeo'};

/* region or appellation -> grape. REQUIRED means appellation law fixes it and
   it may be stated as fact. TYPICAL means it is the norm, not the rule, and
   must be hedged. */
const RGRAPE={
 'chablis':[['Chardonnay','REQUIRED']],
 'sancerre':[['Sauvignon Blanc','REQUIRED']],
 'pouilly-fume':[['Sauvignon Blanc','REQUIRED']],
 'barolo':[['Nebbiolo','REQUIRED']],'barbaresco':[['Nebbiolo','REQUIRED']],
 'chianti':[['Sangiovese','REQUIRED']],'brunello di montalcino':[['Sangiovese','REQUIRED']],
 'muscadet':[['Melon de Bourgogne','REQUIRED']],
 'prosecco':[['Glera','REQUIRED']],
 'gavi':[['Cortese','REQUIRED']],
 'beaujolais':[['Gamay','REQUIRED']],
 'cahors':[['Malbec','REQUIRED']],
 'vouvray':[['Chenin Blanc','REQUIRED']],
 'hermitage':[['Syrah','REQUIRED']],'cote-rotie':[['Syrah','REQUIRED']],
 'rioja':[['Tempranillo','TYPICAL']],
 'soave':[['Garganega','TYPICAL']],
 'valpolicella':[['Corvina','TYPICAL'],['Rondinella','TYPICAL']],
 'chateauneuf-du-pape':[['Grenache Noir','TYPICAL']],
 'rias baixas':[['Albarino','TYPICAL']],
 'marlborough':[['Sauvignon Blanc','TYPICAL']],
 'champagne':[['Chardonnay','TYPICAL'],['Pinot Noir','TYPICAL'],['Meunier','TYPICAL']]};

/* every grape name actually present in the range, folded */
const GNAMES=(()=>{const m=new Map();
 W.forEach(w=>(w.grapes||[]).forEach(g=>m.set(fold(g.n),g.n)));return m})();

/* Longest phrase first, so "pinot grigio" is consumed before "pinot" can
   match every Pinot Noir. Matched phrases are removed from the leftover text
   so their component words cannot score generically. */
const GTERMS=[...new Set([...GNAMES.keys(),...Object.keys(GSYN),...Object.keys(RGRAPE)])]
  .sort((a,b)=>b.length-a.length);

function resolveQuery(q){
 let pad=' '+fold(q).replace(/[^a-z0-9'’ -]/g,' ').replace(/\s+/g,' ').trim()+' ';
 const grapes=new Set(), hints=[];
 GTERMS.forEach(t=>{
  if(pad.indexOf(' '+t+' ')<0) return;
  let consume=false;
  /* union, not either/or: "Shiraz" is both a name in our data (1 wine) and a
     synonym for Syrah (162). Returning only the first would hide 162 wines. */
  if(GNAMES.has(t)){ grapes.add(GNAMES.get(t)); consume=true; }
  if(GSYN[t]){ const c=GNAMES.get(fold(GSYN[t]));
    if(c){ grapes.add(c); consume=true;
      if(fold(t)!==fold(c)) hints.push(t+' \u2192 '+c+' (same grape)'); } }
  /* region terms widen the grape search but are NOT consumed: "Barolo" still
     has to reach the regions and vintage sections. */
  if(RGRAPE[t]) RGRAPE[t].forEach(([g,conf])=>{
    const c=GNAMES.get(fold(g)); if(c){ grapes.add(c); hints.push(t+' \u2192 '+c+' ('+conf+')'); }});
  /* only grape phrases are consumed, so "Pinot Grigio" cannot leave a loose
     "pinot" behind to match every Pinot Noir */
  if(consume) pad=pad.split(' '+t+' ').join(' ');
 });
 return {grapes:[...grapes], hints, rest:pad.trim()};
}

/* ===== budget and recommendation shape ===== */
function budget(q){
 const n=x=>parseFloat(x.replace(/,/g,''));
 let m;
 if(m=q.match(/(?:between\s*)?£\s*(\d+(?:\.\d+)?)\s*(?:and|to|-|–)\s*£?\s*(\d+(?:\.\d+)?)/i))
   return {lo:n(m[1]),hi:n(m[2])};
 if(m=q.match(/(?:under|below|less than|up to|max(?:imum)?|no more than)\s*£\s*(\d+(?:\.\d+)?)/i))
   return {lo:0,hi:n(m[1])};
 if(m=q.match(/(?:over|above|more than|at least|from)\s*£\s*(\d+(?:\.\d+)?)/i))
   return {lo:n(m[1]),hi:1e9};
 if(m=q.match(/(?:around|about|circa|roughly|approx(?:imately)?|~)\s*£\s*(\d+(?:\.\d+)?)/i))
   return {lo:n(m[1])*0.75,hi:n(m[1])*1.25};
 if(m=q.match(/£\s*(\d+(?:\.\d+)?)/)) return {lo:0,hi:n(m[1])};
 return null;
}
['recommend','recommendation','suggest','suggestion','something','anything',
 'looking','option','options','customer','customers','under','over','around','about',
 'budget','price','cheap','cheaper','expensive','good','best','nice','like','want',
 'need','please','party','gift','present'].forEach(w=>STOP.add(w));
const RECRE=/\b(recommend|recommendation|suggest|suggestion|something|anything|options?|looking for|what (?:do we|have we|else)|customer wants?|goes? (?:well )?with|pair(?:ing|s)? with|gift|present|party|case of|alternative|instead of|similar to|like the|bbq|barbecue|dinner|curry|steak|roast|cheese|christmas|wedding|birthday)\b/i;
const isRec=q=>RECRE.test(q)||budget(q)!==null;

/* 3 to 6 wines, no more than two of any one style, spread across the price
   range rather than clustered at the ceiling. */
function spread(list,min,max){
 if(list.length<=min) return list;
 const priced=list.filter(x=>x.w.price!=null), np=list.filter(x=>x.w.price==null);
 const pool=priced.length?priced:np;
 const byStyle={}, out=[];
 const sorted=[...pool].sort((a,b)=>(a.w.price||0)-(b.w.price||0));
 const bands=[[],[],[]], per=Math.ceil(sorted.length/3);
 sorted.forEach((x,i)=>bands[Math.min(2,Math.floor(i/per))].push(x));
 bands.forEach(b=>b.sort((a,b2)=>b2.s-a.s));
 let i=0;
 while(out.length<max && i<40){
  const b=bands[i%3]; i++;
  const pick=b.find(x=>!out.includes(x)&&(byStyle[x.w.style]||0)<2);
  if(pick){ out.push(pick); byStyle[pick.w.style]=(byStyle[pick.w.style]||0)+1; }
  else if(bands.every(bb=>!bb.some(x=>!out.includes(x)&&(byStyle[x.w.style]||0)<2))) break;
 }
 if(out.length<min) pool.forEach(x=>{if(out.length<min&&!out.includes(x)
   &&(byStyle[x.w.style]||0)<2){out.push(x);byStyle[x.w.style]=(byStyle[x.w.style]||0)+1}});
 if(out.length<min) pool.forEach(x=>{if(out.length<min&&!out.includes(x))out.push(x)});
 return out.sort((a,b)=>b.s-a.s);
}"""
sub_once(A1, R1, "tokeniser + grape tables")

# ---------------------------------------------------------------- 2. terms
A2 = " const terms=[...new Set(toks(qs))]; if(!terms.length) return {ctx:'',used:[]};"
R2 = (" const RQ=resolveQuery(qs);\n"
      " const terms=[...new Set(toks(RQ.rest))];\n"
      " const wantG=new Set(RQ.grapes.map(fold));\n"
      " const BUD=budget(qs), REC=isRec(qs);\n"
      " /* a bare \"suggest something under £25\" has no content words but is still\n"
      "    a real shop-floor question, so it must not bail out here */\n"
      " if(!terms.length&&!wantG.size&&!REC) return {ctx:'',used:[]};")
sub_once(A2, R2, "query resolution")

# ---------------------------------------------------------------- 3. wine scoring
A3 = """ const ws=W.map(w=>{
   const head=(w.name+' '+(w.producer||'')+' '+w.grapes.map(g=>g.n).join(' ')+' '+(w.o?[w.o.country,w.o.region,w.o.sub].join(' '):''));
   return {w, s: scoreHits(head,terms,3)+scoreHits(w.desc||'',terms,1)+scoreHits(w.style||'',terms,2)};
  }).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);"""
R3 = """ let ws=W.map(w=>{
   const head=(w.name+' '+(w.producer||'')+' '+w.grapes.map(g=>g.n).join(' ')+' '+(w.o?[w.o.country,w.o.region,w.o.sub].join(' '):''));
   /* a resolved grape is a much stronger signal than a loose word match */
   const gs=(w.grapes||[]).filter(g=>wantG.has(fold(g.n))).length*12;
   return {w, s: gs+scoreHits(head,terms,3)+scoreHits(w.desc||'',terms,1)+scoreHits(w.style||'',terms,2)};
  }).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);
 let budgetCut=0;
 if(BUD){ const before=ws.length;
   ws=ws.filter(x=>x.w.price!=null&&x.w.price>=BUD.lo&&x.w.price<=BUD.hi);
   budgetCut=before-ws.length; }
 /* "suggest a wine under £25" has nothing to rank on, so keyword scoring
    returns whichever wines happen to share a noise word. Fall back to the
    whole range instead of pretending three arbitrary bottles are a match. */
 let broadened=false;
 if(REC && ws.length<3){
   ws=W.filter(w=>!BUD||(w.price!=null&&w.price>=BUD.lo&&w.price<=BUD.hi)).map(w=>({w,s:1}));
   broadened=true; }"""
sub_once(A3, R3, "wine scoring with grape weight and budget")

# ---------------------------------------------------------------- 4. selection
A4 = (" const wineCap = (ws[0] && ws[0].s >= topOther) ? 8 : 4;\n\n"
      " if(ws.length) sec.push({s:ws[0].s, h:'## WINES', lines:ws.slice(0,wineCap).map(({w})=>{")
R4 = (" const wineCap = (ws[0] && ws[0].s >= topOther) ? 8 : 4;\n"
      " /* recommendations get a spread of style and price rather than the top N,\n"
      "    which otherwise cluster on one style at the budget ceiling */\n"
      " const wsel = REC ? spread(ws,3,6) : ws.slice(0,wineCap);\n\n"
      " if(ws.length) sec.push({s:ws[0].s, h:'## WINES', lines:wsel.map(({w})=>{")
sub_once(A4, R4, "recommendation spread")

# ---------------------------------------------------------------- 5. disclosure
A5 = " sec.sort((a,b)=>b.s-a.s);\n const parts=[], used=[];"
R5 = (" sec.sort((a,b)=>b.s-a.s);\n"
      " /* a recommendation is a question about what to sell someone. Glossary and\n"
      "    beer records should not lead the context just because they matched the\n"
      "    word \'red\'. */\n"
      " if(REC){ const wi=sec.findIndex(x=>x.h==='## WINES'); if(wi>0) sec.unshift(sec.splice(wi,1)[0]); }\n"
      " const parts=[], used=[];\n"
      " /* tell the model what the retrieval layer did, so the answer can say so */\n"
      " if(RQ.hints.length) parts.push('## HOW THIS SEARCH WAS WIDENED\\n- appellation hint: '\n"
      "   +RQ.hints.join('; ')+'\\n- REQUIRED may be stated as fact. TYPICAL is the norm, not the rule: hedge it.');\n"
      " if(broadened) parts.push('## NOTE\\n- the question named no grape, style or region, "
      "so this is a spread across the range rather than a set of close matches');\n"
      " if(BUD) parts.push('## BUDGET APPLIED\\n- only wines priced £'+BUD.lo.toFixed(2)+' to £'\n"
      "   +(BUD.hi>1e8?'(no ceiling)':BUD.hi.toFixed(2))+' were retrieved'\n"
      "   +(budgetCut?'; '+budgetCut+' otherwise-matching wines fell outside it':'')\n"
      "   +'\\n- the budget was applied to wines only. Spirit, beer and cider records carry no price, '\n"
      "   +'so do not present any of them as meeting a budget.');")
sub_once(A5, R5, "retrieval disclosure")

# ---------------------------------------------------------------- 6. system prompt
A6 = '+"7. Say which records you used at the end, briefly.";'
R6 = ('+"7. Say which records you used at the end, briefly.\\n"\n'
      '+"8. When recommending, offer between three and six wines that differ in style and in price, "\n'
      '+"and say what makes each different. Never present them as a ranked list of best to worst.\\n"\n'
      '+"9. We hold no tasting notes and no acidity, body or tannin data. If asked how something tastes, "\n'
      '+"say the range carries style and grape but not tasting notes, give the style and grape, and stop there. "\n'
      '+"Do not infer flavour from the grape or region.\\n"\n'
      '+"10. If a HOW THIS SEARCH WAS WIDENED block is present, mention the grape equivalence plainly, "\n'
      '+"for example that Shiraz and Syrah are the same grape, or that Rioja is typically Tempranillo.";')
sub_once(A6, R6, "system prompt rules 8-10")

# ---------------------------------------------------------------- checks
for ph in ["__GLOSS__", "__WINES__", "__VREGIONS__", "__GUIDE__", "__NW__"]:
    assert ph not in s, f"UNSUBSTITUTED PLACEHOLDER {ph}"
assert len(applied) == 6, f"expected 6 patches, applied {applied}"
assert len(s) > orig_len, "file shrank, something replaced more than intended"

pathlib.Path(OUT).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(OUT).write_text(s, encoding="utf-8")
print("applied:", *applied, sep="\n  - ")
print(f"\nwrote {OUT}  ({orig_len:,} -> {len(s):,} chars)")
