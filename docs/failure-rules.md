# Failure rules: the mistakes behind the production locks and the rule that stops each one

Source: a launch film that was delivered slow, had to be remade, and whose remake was cancelled after two days with nothing delivered, with several times more paid frames than an earlier film needed.

Every rule below is **general**: it holds for every format and vertical, unless the row says it is specific to one. Each rule is enforced in code (engine, flow gate or the Claude Code guard) and has a check in `npm run check`. When no code can enforce a rule, the row says so, and the rule lives in `CLAUDE.md` and the studio skill.

## The rules

| Rule | What it stops | Where | Check |
|---|---|---|---|
| **ENGINE FREEZE** | Changing the engine mid-production. A project records the engine fingerprint at intake and at a remake. Any paid job refuses to run once the engine code has changed, until the creator agrees in their words (`studio.mjs engine-update <slug> --said`). | `lib/freeze.mjs`, `gen.mjs job()` | check-flow: engine freeze |
| **CANCELLED** | Spending on a stopped project. `studio.mjs cancel <slug> --said`; every paid job refuses it. | `lib/freeze.mjs`, `studio.mjs` | check-flow: cancelled |
| **ATTEMPT STOP** | Paying for the same asset a third time. The third attempt needs the creator's yes. | `gen.mjs job()` | check-flow |
| **REWORK STOP** | A production redoing more than it makes. From 10 paid jobs on, more than two per asset stops until the creator's yes. | `gen.mjs job()` | check-flow |
| **REDRAW STOP** | A change that silently discards paid frames or takes. It names how many, gives the redraw cost, and waits for `--said`. | `launch.mjs apply` | check-launch |
| **PRICE STOP** | Quoting costs before the live model analysis of this production. | `gen.mjs estimate` | check-flow |
| **BALANCE STOP** | Spending without checking the live balance (existing). | `gen.mjs job()` | check-flow |
| **Parallel budget** | Parallel runs passing the budget lock together. Claims sit under a project mutex. | `gen.mjs job()` | check.mjs |
| **Measured time** | Promising times. Every paid job records its seconds; batch commands quote the measured median. | `gen.mjs finish()`, `frame-chain` | check-flow |
| **Production clock** | Drifting for hours or days unseen. `studio.mjs status` shows time since intake, time since the book was approved (limit 15 min to delivery), and paid jobs per asset. | `studio.mjs status` | check-flow |
| **Batch commands only** | Shell loops of single paid jobs (out of order, stale inputs, no preview). The guard refuses them; `gen.mjs frame-chain` runs a film's frames in order, previews count, cost and time, retries only provider timeouts and stops on the first failure. | guard rule 6, `gen.mjs frame-chain` | check-flow: guard |
| **Questions get answers** | Acting when the creator asked a question. The guard refuses paid commands while the creator's last message is a question. | guard rule 7, `hooks/creator.mjs` | check-flow: guard |
| **The creator's words** | Approvals invented, paraphrased or read into anger. Every `--said` must be literal text from a message the creator wrote (never a notification or another session). Retries and extra spend need a yes word. | guard rule 8 | check-flow: guard |
| **Checked commits** | Committing untested code. A commit in the factory repo needs `npm run check` to have passed on exactly that code. | guard rule 9, `hooks/stamp.mjs` | check-flow |
| **Product facts** | False features and missing key points in the script. Every format that sells something (launch, UGC, influencer) records what the product does NOT do and what every video must say; the script gate refuses violations. | `lib/flow.mjs productFacts`, `lib/launch.mjs` (brief) | check-flow, check-launch |
| **Chained frames** | Joins that jump. A chained shot opens on a copy of the previous shot's judged last frame. A copy from an unjudged frame is refused. A new first frame drops its stale last frame. The board refuses mismatches. | `gen.mjs frame`, `lib/flow.mjs` board | check-launch |
| **Insert boundaries** | Opening on a green screen, or copying the wrong screen into an insert shot. Where a screen insert starts or ends, the first frame is drawn from the previous frame (same set, the shot's own framing). | `gen.mjs frame` | check-launch |
| **Screen states** | Screens drawn as anything. Every screen in a set map states what it shows. States are never conditional; changes are a timeline (`changes: [{from: "S8:last"}]`). An insert shot must turn the screen green. | `lib/launch.mjs styleRules` | check-launch |
| **Judge sees the timeline** | Frames judged against the wrong state. The frame judge gets each item's state at that frame. | `gen.mjs frameEvalOf` | check-launch |
| **End frames lead with the change** | End frames copying the opening pose. The end state goes first in the prompt, with what must change and what must stay. | `gen.mjs frame` | check-launch |
| **Stuck jobs** | Each new frame waiting minutes on dead provider tasks. Old locks get one short look and are dropped after hours. | `gen.mjs recover()` | check.mjs |
| **MODEL RESEARCH** | Choosing a video model only among the ones the engine already runs. `studio.mjs prices` reads both catalogs (Kie's price list and APIMart's docs index). Every family on sale that the engine doesn't run needs a researched profile from its documentation (inputs, sound, length, resolutions, price, use, verdict, formats, reason), refreshed every 60 days. A missing or stale profile is a warning on every status and in the price analysis (a book gate once proven). Candidates for the format are listed for testing. | `lib/pricing.mjs`, `lib/apimart.mjs catalog`, `studio.mjs prices` and `model-research`, book gate | check-flow |
| **LIVE CATALOG CHECK** | Starting a production on a stale picture of the market. Every intake fetches both catalogs and every price fresh, reports new models and every price move, and updates the researched prices; a project without it shows a warning (a concept gate once proven) (`studio.mjs catalog <slug>` re-runs it). | `lib/pricing.mjs liveCatalogCheck`, `studio.mjs new` and `catalog`, concept gate | check-flow |
| **Empty wallet** | Asking for a top-up. A provider's "top up" text is never relayed; jobs route to the other provider. | `lib/providers.mjs`, `gen.mjs credits` | check-flow |

## The 51 mistakes, mapped

| # | Mistake | Rule |
|---|---|---|
| 1 | Changed the engine mid-production | ENGINE FREEZE |
| 2 | Tested new rules on a live production | ENGINE FREEZE |
| 3 | Missed the 15-minute delivery limit by days | Production clock, REWORK STOP |
| 4 | Acted on the creator's questions | Questions get answers |
| 5 | Added notes instead of fixing | Behavior: CLAUDE.md "Talking to the creator" |
| 6 | Kept agreeing instead of working | Behavior: CLAUDE.md "Talking to the creator" |
| 7 | Mentioned a provider top-up | Empty wallet |
| 8 | Quoted prices before the model analysis | PRICE STOP |
| 9 | Analyzed only the models the engine knew | MODEL RESEARCH |
| 10 | Didn't research provider docs unprompted | Behavior: CLAUDE.md |
| 11 | Spent the Kie balance without checking it | BALANCE STOP |
| 12 | Painted image after image without saying how many or the cost | Batch commands only (preview), ATTEMPT STOP |
| 13 | Filmed v1 with continuity errors | Existing: frame judge, board gate, pilot gate |
| 14 | Money spent on frames rerolled in the first version | ATTEMPT STOP, REWORK STOP |
| 15 | Model tests run twice | Existing: test allowance (TEST_CAP); REWORK STOP |
| 16 | A test prompt over the model's limit | Existing: PROMPT STOP, prompt fitting |
| 17 | Several times more frames than needed | REWORK STOP |
| 18 | Style built wrong at first | Existing: look test approval |
| 19 | Creator's reference images sent to the model | Existing: own references required |
| 20 | A feature the product doesn't have in the script | Product facts |
| 21 | Copy the creator had removed | Product facts (does not) |
| 22 | Main job undersold | Product facts (must say) |
| 23 | Copy formula not followed | Existing: copy structure rules |
| 24 | Music brief method not followed | Existing: MUSIC STOP |
| 25 | Brand pronunciation mismatch | Existing: `voice.pronounce` |
| 26 | Voices proposed before the right one | Existing: voice blueprint, cast gate |
| 27–30 | Props changing between shots | Existing: set maps, anchors, props sheet, frame judge |
| 31 | A slow, stiff v1 | Existing: motion band, rhythm rules |
| 32 | Apply wiped last frames and evals | Fixed; REDRAW STOP |
| 33 | Chain lost, so first frames were drawn instead of copied | Chained frames |
| 34 | Joins that didn't match | Chained frames (board check) |
| 35 | Conditional screen states | Screen states |
| 36 | A monitor with no state | Screen states |
| 37 | Each set change redrew everything | REDRAW STOP |
| 38 | End frames copied the opening pose | End frames lead with the change |
| 39 | A shot opening on the green insert screen | Insert boundaries |
| 40 | A fix that covered only one direction | Insert boundaries (both directions, tested) |
| 41 | Judge used the opening state | Judge sees the timeline |
| 42 | Framing order contradicting the plan | Insert boundaries (the shot's framing) |
| 43 | A shot copied from a stale frame after a timeout | Chained frames (no copy from unjudged), batch commands only |
| 44 | Dead provider tasks stalled every frame | Stuck jobs |
| 45 | Budget lock blind to parallel runs | Parallel budget |
| 46 | Typos in my own code | Checked commits |
| 47 | Time promises that didn't hold | Measured time |
| 48 | No Production Book in two days | Production clock |
| 49 | Approvals requested again and again for my own errors | ENGINE FREEZE, REDRAW STOP, ATTEMPT STOP |
| 50 | Anger read as an authorization | The creator's words |
| 51 | Never warned that new rules mid-production cost time and money | ENGINE FREEZE (the stop explains it) |
