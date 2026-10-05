export const meta = {
  name: 'deliver-story',
  description: 'EVia Manager: realizacja jednej historyjki (ready) — plan, implementacja TDD, weryfikacja QA, przeglądy i pętla poprawek aż do spełnienia bramek',
  whenToUse: 'Uruchamiany przez /deliver dla historyjki w statusie ready. args: { storyId, storyPath, branch, owner, today?, contributors?, reviewers?, appUrl?, userNotes?, model?, maxRounds? }',
  phases: [
    { title: 'Plan', detail: 'plan techniczny wykonawcy + konsultacje (architekt / UX / security)' },
    { title: 'Implementacja', detail: 'TDD: owner, potem contributors — sekwencyjnie' },
    { title: 'Weryfikacja', detail: 'QA (AC → testy), potem przeglądy równolegle' },
    { title: 'Poprawki', detail: 'naprawa blocker/major i ponowna weryfikacja (limit rund)' },
  ],
}

// ---------- wejście ----------
const KNOWN_AGENTS = [
  'product-owner', 'solution-architect', 'ux-designer', 'backend-developer', 'web-developer',
  'mobile-developer', 'qa-engineer', 'security-engineer', 'devops-engineer', 'code-reviewer',
]
const a = args || {}
const storyId = a.storyId
const storyPath = a.storyPath
const branch = a.branch
const owner = a.owner
if (!storyId || !storyPath || !branch || !owner) {
  throw new Error('deliver-story: wymagane args: storyId, storyPath, branch, owner')
}
const today = a.today || 'brak daty'
const contributors = (a.contributors || []).filter((x) => x && x !== owner)
const reviewers = Array.from(new Set((a.reviewers && a.reviewers.length ? a.reviewers : ['code-reviewer'])
  .filter((r) => r !== 'qa-engineer')))
for (const name of [owner, ...contributors, ...reviewers]) {
  if (!KNOWN_AGENTS.includes(name)) throw new Error(`deliver-story: nieznany agent "${name}"`)
}
const implementers = [owner, ...contributors]
const MAX_ROUNDS = a.maxRounds || 3
const appUrl = a.appUrl || ''
const userNotes = a.userNotes || ''
// Story `model` (docs/process/workflow.md → „Modele i effort agentów”): the implementers (plan, implementation, fixes)
// get it; `opus` also raises the reviews, `sonnet` never lowers them. QA and consultations keep their agent definitions,
// and effort always comes from the definitions.
const MODELS = ['sonnet', 'opus']
const model = a.model || ''
if (model && !MODELS.includes(model)) {
  throw new Error(`deliver-story: nieobsługiwany model "${model}" (dozwolone: ${MODELS.join(', ')})`)
}
const implementerOpts = (opts) => (model ? Object.assign({}, opts, { model }) : opts)
const reviewerOpts = (opts) => (model === 'opus' ? Object.assign({}, opts, { model }) : opts)

// ---------- schematy wyników ----------
const str = { type: 'string' }
const strList = { type: 'array', items: { type: 'string' } }
const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
    area: { type: 'string', enum: ['backend', 'web', 'mobile', 'infra', 'design', 'docs', 'tests', 'other'] },
    location: str,
    issue: str,
    fix: str,
  },
  required: ['severity', 'area', 'location', 'issue', 'fix'],
}
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'blocked'] },
    summary: str,
    needsArchitectReview: { type: 'boolean' },
    needsUiSpec: { type: 'boolean' },
    securityRelevant: { type: 'boolean' },
    questions: strList,
  },
  required: ['status', 'summary', 'needsArchitectReview', 'needsUiSpec', 'securityRelevant', 'questions'],
}
const CONSULT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes', 'blocked'] },
    notes: str,
    questions: strList,
  },
  required: ['verdict', 'notes', 'questions'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: str,
    filesChanged: strList,
    commits: strList,
    checks: str,
    questions: strList,
  },
  required: ['status', 'summary', 'filesChanged', 'checks', 'questions'],
}
const QA_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str,
          status: { type: 'string', enum: ['pass', 'fail', 'manual'] },
          evidence: str,
        },
        required: ['id', 'status', 'evidence'],
      },
    },
    gatesPassed: { type: 'boolean' },
    gatesSummary: str,
    coverage: str,
    findings: { type: 'array', items: FINDING },
    howToVerify: str,
  },
  required: ['verdict', 'acceptanceCriteria', 'gatesPassed', 'gatesSummary', 'findings', 'howToVerify'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes_required'] },
    summary: str,
    findings: { type: 'array', items: FINDING },
  },
  required: ['verdict', 'summary', 'findings'],
}

// ---------- pomocnicze ----------
const isBlocking = (f) => f.severity === 'blocker' || f.severity === 'major'
const AREA_FIXER = {
  backend: 'backend-developer',
  web: 'web-developer',
  mobile: 'mobile-developer',
  infra: 'devops-engineer',
}
function fixerFor(f) {
  if (f.area === 'design') {
    return implementers.find((x) => x === 'web-developer' || x === 'mobile-developer') || owner
  }
  return AREA_FIXER[f.area] || owner
}
const CTX = [
  `Historyjka: ${storyId} — plik: ${storyPath}`,
  `Gałąź robocza: ${branch} (jesteś już na niej; nie przełączaj gałęzi, nie rób push ani merge).`,
  `Data: ${today}.`,
  userNotes ? `Decyzje i uwagi użytkownika: ${userNotes}` : '',
  'Działasz w workflow deliver-story (docs/process/workflow.md). Twój wynik to dane dla skryptu: wypełnij pola zwięźle i konkretnie.',
].filter(Boolean).join('\n')

// ---------- 1. Plan ----------
phase('Plan')
const plan = await agent(`${CTX}

KROK: PLAN TECHNICZNY (bez implementacji).
1. Przeczytaj historyjkę oraz powiązane ADR-y i dokumenty.
2. Uzupełnij w pliku historyjki sekcję „Plan techniczny”: zakres zmian (moduły / pliki / dokumenty), kontrakt API (jeśli dotyczy), migracje, plan testów AC → testy (dla dokumentów: jak sprawdzić każde AC), kolejność kroków. Dopisz w „Dziennik”: "${today} — plan techniczny (${owner})".
3. Oceń: needsArchitectReview — nowy moduł, nowa zależność zewnętrzna, zmiana współdzielonego modelu danych, niekompatybilna zmiana API, nowa infrastruktura; needsUiSpec — historyjka ma UI bez kompletnej sekcji „UX / UI”; securityRelevant — uwierzytelnianie, autoryzacja, dane osobowe, pliki / media, nowe endpointy, zależności, infrastruktura, dane na urządzeniu.
4. Gdy AC są niejasne lub sprzeczne albo brakuje decyzji użytkownika: status "blocked" i konkretne pytania (każde z rekomendowaną odpowiedzią).`,
  implementerOpts({ agentType: owner, label: `plan:${owner}`, phase: 'Plan', schema: PLAN_SCHEMA }))

if (!plan) return { status: 'needs-attention', storyId, stage: 'plan', reason: `${owner} nie zwrócił planu` }
if (plan.status === 'blocked') return { status: 'blocked', storyId, stage: 'plan', summary: plan.summary, questions: plan.questions }

const consults = []
if (plan.needsArchitectReview && owner !== 'solution-architect') {
  consults.push({ who: 'solution-architect', prompt: `${CTX}

KROK: PRZEGLĄD PLANU TECHNICZNEGO. Przeczytaj sekcję „Plan techniczny” historyjki i ADR-y. Oceń granice modułów, model danych i migracje, kontrakt API i kompatybilność wsteczną, wpływ na offline-sync, wydajność i testowalność. Nie edytuj plików.
verdict: approve / changes (w notes — konkretne, obowiązujące wytyczne dla implementujących) / blocked (tylko gdy potrzebna decyzja użytkownika → questions).` })
}
if (plan.needsUiSpec && owner !== 'ux-designer') {
  consults.push({ who: 'ux-designer', prompt: `${CTX}

KROK: SPECYFIKACJA UI. Uzupełnij w pliku historyjki wyłącznie sekcję „UX / UI”: ekrany i przepływ, komponenty i tokeny ze styleguide'u, stany (pusty / ładowanie / błąd / offline / brak uprawnień), zachowanie responsywne, mikrocopy po polsku, uwagi a11y. Brak wzorca w styleguide'zie → zaprojektuj zgodnie z jego zasadami i dopisz propozycję do changelogu styleguide'u.
verdict: approve (specyfikacja gotowa; w notes jej skrót) / blocked (potrzebna decyzja użytkownika → questions).` })
}
if (plan.securityRelevant && owner !== 'security-engineer') {
  consults.push({ who: 'security-engineer', prompt: `${CTX}

KROK: WYMAGANIA BEZPIECZEŃSTWA PRZED IMPLEMENTACJĄ. Przeczytaj historyjkę, plan techniczny i docs/security/. Nie edytuj plików.
W notes: zagrożenia istotne dla tej zmiany i obowiązkowe kontrole (np. testy macierzy ról dla konkretnych endpointów, walidacja, limity, audyt, dane osobowe) z odniesieniem do ASVS / MASVS.
verdict: approve / changes (plan wymaga zmian) / blocked (potrzebna decyzja użytkownika → questions).` })
}

let consultResults = []
if (consults.length) {
  log(`Konsultacje: ${consults.map((c) => c.who).join(', ')}`)
  consultResults = (await parallel(consults.map((c) => () =>
    agent(c.prompt, { agentType: c.who, label: `consult:${c.who}`, phase: 'Plan', schema: CONSULT_SCHEMA })
      .then((r) => r && Object.assign({ who: c.who }, r))))).filter(Boolean)
  const missing = consults.filter((c) => !consultResults.some((r) => r.who === c.who)).map((c) => c.who)
  if (missing.length) return { status: 'needs-attention', storyId, stage: 'consultations', reason: `Brak wyniku konsultacji: ${missing.join(', ')}` }
  const blocked = consultResults.filter((r) => r.verdict === 'blocked')
  if (blocked.length) {
    return { status: 'blocked', storyId, stage: 'consultations', summary: plan.summary, consultations: consultResults, questions: blocked.flatMap((r) => r.questions) }
  }
}
const consultBlock = consultResults.length
  ? 'Obowiązujące ustalenia z konsultacji (zapisz je w historyjce: „Plan techniczny” → „Ustalenia z konsultacji”):\n' +
    consultResults.map((r) => `- ${r.who} (${r.verdict}): ${r.notes}`).join('\n')
  : ''

// ---------- 2. Implementacja ----------
phase('Implementacja')
const implReports = []
for (const who of implementers) {
  const prev = implReports.length
    ? 'Wcześniejsi wykonawcy tej historyjki:\n' + implReports.map((r) => `- ${r.who}: ${r.summary}`).join('\n')
    : ''
  const r = await agent(`${CTX}

KROK: IMPLEMENTACJA (${who}).
Zrealizuj SWOJĄ część historyjki zgodnie z AC i „Planem technicznym”: TDD (testy oznaczone "${storyId} AC#"), małe commity (Conventional Commits po angielsku z [${storyId}]). Jeśli rezultatem są dokumenty — zadbaj, by każde AC było jednoznacznie spełnione i łatwe do sprawdzenia.
${consultBlock}
${prev}
Na koniec uruchom lokalną bramkę jakości (komendy w CLAUDE.md) — musi być zielona. Dopisz wpis w „Dziennik” historyjki.
Gdy nie da się kontynuować bez decyzji użytkownika: status "blocked" + questions (z rekomendacją).`,
    implementerOpts({ agentType: who, label: `impl:${who}`, phase: 'Implementacja', schema: IMPL_SCHEMA }))
  if (!r) return { status: 'needs-attention', storyId, stage: 'implementation', reason: `${who} nie zwrócił wyniku`, implementation: implReports }
  implReports.push(Object.assign({ who }, r))
  if (r.status === 'blocked') return { status: 'blocked', storyId, stage: 'implementation', implementation: implReports, questions: r.questions }
}

// ---------- 3–4. Weryfikacja i poprawki ----------
let round = 0
let passed = false
let lastQa = null
let lastReviews = []
let blocking = []
let prevQaFindings = []
let prevReviewFindings = {}
const fixLog = []
const history = []

while (round < MAX_ROUNDS) {
  round++
  phase('Weryfikacja')
  const qa = await agent(`${CTX}

KROK: WERYFIKACJA QA — runda ${round}.
Przeprowadź procedurę ze swojej definicji: macierz AC → testy, pełny zestaw testów i pokrycie (progi z docs/process/testing-strategy.md), macierz ról, przypadki brzegowe, krótka sesja eksploracyjna${appUrl ? ` (aplikacja: ${appUrl})` : ' (uruchom aplikację lokalnie wg CLAUDE.md, jeśli to możliwe)'}. Możesz dopisywać testy (commit z [${storyId}]); nie zmieniasz kodu produkcyjnego.
Rezultat to dokumenty → zweryfikuj każde AC przez inspekcję treści; gatesPassed = true, gdy nie ma kodu.
Status AC "manual" tylko dla kryteriów wymagających ręcznego sprawdzenia przez użytkownika (np. test terenowy).
${round > 1 ? `Ustalenia z poprzedniej rundy (sprawdź, czy naprawione): ${JSON.stringify(prevQaFindings)}` : ''}`,
    { agentType: 'qa-engineer', label: `qa:r${round}`, phase: 'Weryfikacja', schema: QA_SCHEMA })

  const reviews = (await parallel(reviewers.map((rv) => () =>
    agent(`${CTX}

KROK: PRZEGLĄD (${rv}) — runda ${round}.
Przejrzyj zmiany gałęzi względem main (git diff main...HEAD) zgodnie ze swoją checklistą${rv === 'ux-designer' ? `; przegląd UX / a11y na działającej aplikacji${appUrl ? ` (${appUrl})` : ''}, zrzuty w docs/ux/reviews/${storyId}/` : ''}. Nie modyfikuj kodu produkcyjnego.
${round > 1 ? `Twoje ustalenia z poprzedniej rundy: ${JSON.stringify(prevReviewFindings[rv] || [])}. Sprawdź, czy są naprawione, i przejrzyj zmiany od tamtej rundy. Nowe ustalenia zgłaszaj tylko, jeśli są istotne (blocker / major) albo wprowadzone poprawkami.` : ''}
Zwróć werdykt, krótkie podsumowanie i findings (severity, area, location plik:linia, issue, fix).`,
      reviewerOpts({ agentType: rv, label: `${rv}:r${round}`, phase: 'Weryfikacja', schema: REVIEW_SCHEMA }))
      .then((r) => r && Object.assign({ reviewer: rv }, r))))).filter(Boolean)

  lastQa = qa
  lastReviews = reviews
  const problems = []
  if (!qa) {
    problems.push({ severity: 'blocker', area: 'other', location: '-', issue: 'QA nie zwróciło wyniku', fix: 'Powtórz weryfikację', source: 'workflow' })
  } else {
    if (!qa.gatesPassed) {
      problems.push({ severity: 'blocker', area: 'tests', location: 'bramki jakości', issue: `Bramki nie przeszły: ${qa.gatesSummary}`, fix: 'Doprowadź lint / typy / testy / pokrycie do zielonego stanu', source: 'qa-engineer' })
    }
    for (const ac of qa.acceptanceCriteria.filter((x) => x.status === 'fail')) {
      problems.push({ severity: 'blocker', area: 'other', location: ac.id, issue: `AC niespełnione: ${ac.evidence}`, fix: 'Spełnij AC i pokryj je testem', source: 'qa-engineer' })
    }
    for (const f of qa.findings.filter(isBlocking)) problems.push(Object.assign({ source: 'qa-engineer' }, f))
  }
  for (const rv of reviewers.filter((x) => !reviews.some((r) => r.reviewer === x))) {
    problems.push({ severity: 'blocker', area: 'other', location: '-', issue: `${rv} nie zwrócił wyniku przeglądu`, fix: 'Powtórz przegląd', source: 'workflow' })
  }
  for (const r of reviews) {
    for (const f of r.findings.filter(isBlocking)) problems.push(Object.assign({ source: r.reviewer }, f))
    if (r.verdict === 'changes_required' && !r.findings.some(isBlocking)) {
      problems.push({ severity: 'major', area: 'other', location: '-', issue: `${r.reviewer} wymaga zmian: ${r.summary}`, fix: 'Wprowadź wskazane zmiany', source: r.reviewer })
    }
  }
  blocking = problems
  history.push({ round, qa: qa ? qa.verdict : 'brak', reviews: reviews.map((r) => `${r.reviewer}: ${r.verdict}`), blocking: problems.length })
  log(`Runda ${round}: ${problems.length} problemów blokujących`)

  if (!problems.length) { passed = true; break }
  if (problems.some((p) => p.source === 'workflow')) break
  if (round >= MAX_ROUNDS) break

  phase('Poprawki')
  const byFixer = {}
  for (const p of problems) {
    const who = fixerFor(p)
    if (!byFixer[who]) byFixer[who] = []
    byFixer[who].push(p)
  }
  const order = implementers.concat(Object.keys(byFixer).filter((w) => !implementers.includes(w))).filter((w) => byFixer[w])
  for (const who of order) {
    const mine = byFixer[who]
    const others = problems.filter((p) => !mine.includes(p))
    const r = await agent(`${CTX}

KROK: POPRAWKI — runda ${round} (${who}).
Napraw ustalenia przypisane do Ciebie (blocker i major są obowiązkowe). Gdy to możliwe: najpierw test odtwarzający problem, potem poprawka. Commity z [${storyId}].
Do naprawy: ${JSON.stringify(mine)}
Kontekst — pozostałe ustalenia tej rundy (naprawiają inni, nie ruszaj): ${JSON.stringify(others)}
Jeśli uważasz ustalenie za błędne — nie zmieniaj kodu, uzasadnij to w summary (zostanie zweryfikowane w kolejnej rundzie).
Uruchom bramkę jakości — musi być zielona.`,
      implementerOpts({ agentType: who, label: `fix:${who}:r${round}`, phase: 'Poprawki', schema: IMPL_SCHEMA }))
    fixLog.push({ round, who, status: r ? r.status : 'error', summary: r ? r.summary : 'brak wyniku' })
    if (r && r.status === 'blocked') {
      return { status: 'blocked', storyId, stage: 'fixes', rounds: round, openBlocking: problems, fixes: fixLog, questions: r.questions }
    }
  }
  prevQaFindings = problems.filter((p) => p.source === 'qa-engineer')
  prevReviewFindings = {}
  for (const rv of reviewers) prevReviewFindings[rv] = problems.filter((p) => p.source === rv)
}

// ---------- wynik ----------
const nonBlocking = []
if (lastQa) {
  for (const f of lastQa.findings.filter((x) => !isBlocking(x))) nonBlocking.push(Object.assign({ source: 'qa-engineer' }, f))
}
for (const r of lastReviews) {
  for (const f of r.findings.filter((x) => !isBlocking(x))) nonBlocking.push(Object.assign({ source: r.reviewer }, f))
}

return {
  status: passed ? 'passed' : 'needs-attention',
  storyId,
  model: model || null,
  rounds: round,
  plan: plan.summary,
  consultations: consultResults.map((r) => ({ who: r.who, verdict: r.verdict, notes: r.notes })),
  implementation: implReports.map((r) => ({ who: r.who, summary: r.summary, filesChanged: r.filesChanged, commits: r.commits || [], checks: r.checks })),
  fixes: fixLog,
  qa: lastQa
    ? { verdict: lastQa.verdict, acceptanceCriteria: lastQa.acceptanceCriteria, gatesSummary: lastQa.gatesSummary, coverage: lastQa.coverage || '', howToVerify: lastQa.howToVerify }
    : null,
  reviews: lastReviews.map((r) => ({ reviewer: r.reviewer, verdict: r.verdict, summary: r.summary })),
  openBlocking: passed ? [] : blocking,
  nonBlocking,
  history,
}
