Vault — Full Master Plan
1. Product definition

Vault is a local-first AI memory operating system for coding agents and humans.

Its purpose is to solve one painful problem:

fresh AI sessions start too cold.

Claude, Codex, and later other agents are strong thinkers, but they do not naturally carry structured, project-specific, reusable memory across sessions in a reliable way. Vault solves that by becoming the dedicated place where important work is:

saved
structured
tagged
classified
organized
linked
recalled
surfaced at the right time

Vault is not meant to be “the AI that does everything.”
Vault is the memory layer that makes other AIs more effective.

The simplest description is:

Vault stores structured project memory and returns the most relevant past context when a new session starts or when an agent needs continuity, certainty, decisions, plans, or handoff knowledge.

2. Final product vision

At the highest level, Vault should become this:

A local Windows app with its own controlled workspace where Claude, Codex, OpenClaw, and a human user can save and retrieve structured memory. It exposes local tools through MCP and optionally a local API. It maintains a registry/database as the source of truth, organizes files under a dedicated Vault root, helps agents decide what to save and when, and gives both humans and agents a rich interface for search, chat, visual memory browsing, map exploration, analytics, and logs.

The final experience should feel like a mix of:

a memory-aware ChatGPT
an Obsidian-like local workspace
a structured knowledge graph
a debugging and project continuity dashboard
an agent memory router
3. The problem Vault solves

Without Vault, agents in new sessions often:

restart from zero
repeat analysis
forget decisions
re-open too many files
search too broadly
lose implementation history
miss architecture context
fail to continue naturally

Without a memory system, every session becomes too dependent on:

user re-explanation
oversized prompts
huge context windows
random old files
manual recollection

Vault solves this by turning raw history into structured reusable memory.

Its job is not to dump everything back.
Its job is to filter and rank memory so the right context appears at the right time.

4. Core design philosophy

This is the philosophy the whole product must follow.

4.1 Deterministic core, intelligent enrichment

Anything that can be done safely and predictably with system logic should be done without AI.

Examples:

save files
create directories
move/rename/archive
register metadata
path lookup
filtering
timestamping
source tracking
logging
fixed rule application

AI should only be used where interpretation helps:

summaries
tags
classifications
semantic recall boosts
related-item suggestions
handoff cleanup
next-step extraction
4.2 Registry is the source of truth

The filesystem is not the source of truth. The registry/database is.

Paths may change. Files may be renamed. Tags may evolve. The registry should always remain the authoritative memory map.

4.3 Memory should be curated, not dumped

Not every session deserves long-term memory.

Vault must distinguish between:

temporary/working memory
structured summary memory
promoted long-term memory
canonical project knowledge
4.4 Recall quality matters more than storage volume

The product wins when a fresh session becomes better, not when the database gets larger.

4.5 Skills are as important as tools

A tool alone is not enough. Claude and Codex must be taught:

when to recall
when to save
what fields to include
how to label memory well

This means the Vault protocol and skills are foundational, not optional.

5. The five system layers

Vault should be designed as five distinct layers.

Layer 1: Skill / behavior layer

This is where Claude and Codex are taught how to behave with memory.

It defines:

when to query Vault
when to save
how to structure a memory item
how to choose subject, keywords, tags, type, and project
how to use retrieved memory intelligently

This layer is different per client:

Claude skill
Codex skill
later OpenClaw skill
later human assistant behavior in chat UI
Layer 2: MCP / tool layer

This is the bridge between agents and Vault.

It exposes functions like:

save memory
find memory
recall context
get latest
update metadata
suggest save path
promote memory
archive memory

MCP executes. It does not decide.

Layer 3: Vault core

This is the engine.

It includes:

registry/database
file operations
save logic
retrieval logic
ranking logic
logs
rules
project structure
client tracking
Layer 4: AI enrichment layer

This is optional but powerful.

It adds:

summary cleanup
classification
tags
semantic grouping
subject refinement
recall refinement
duplicate detection suggestions
long-term memory promotion suggestions
Layer 5: UI layer

This is the human-facing product.

It includes:

chat interface
memory cells
memory details
visual map
settings
client usage graphs
project graphs
activity feed
logs
analytics
6. What Vault is not

To avoid architectural confusion, Vault is not:

a general-purpose whole-computer file manager
a vector database-first app
a chatbot pretending to be memory
a cloud-first SaaS in v1
a replacement for Claude or Codex
a system where the model itself “holds the map”

Vault should own its own root directory, its own registry, and its own rules.

That keeps it focused, safe, and buildable.

7. Vault’s dedicated local workspace

Vault should manage a dedicated root directory, not your entire machine.

A good root could be:

Vault/

Within that root, Vault should structure memory by projects and memory types.

Recommended initial structure:

Vault/
  projects/
    SwiftFlow/
      sessions/
      summaries/
      decisions/
      plans/
      artifacts/
      references/
      handoffs/
      archive/
    Talabie/
      sessions/
      summaries/
      decisions/
      plans/
      artifacts/
      references/
      handoffs/
      archive/
  shared/
  registry/
  logs/
  settings/
  temp/

This structure should be created and maintained programmatically.

A file should never just be “somewhere.”
It should belong to a project, type, and lifecycle state.

8. Memory model

A memory item is the main unit of the system.

Each item should represent one meaningful saved piece of reusable context.

Examples:

a session summary
a decision note
an implementation plan
a bug investigation result
a handoff
an artifact reference
a reusable reference note

A memory item must be structured enough to:

save cleanly
retrieve accurately
rank meaningfully
be reused later
9. Canonical schema design

This is one of the most important parts of the whole app.

Main memory item fields

Each memory_item should include at least:

id
item_uid
title
project
source_app
source_session_id
memory_type
subject
summary
keywords_json
tags_json
routine_type
status
priority
promoted
next_steps_json
related_item_ids_json
related_files_json
vault_path
created_at
updated_at
last_accessed_at
access_count
What these fields mean

title
A human-readable title for the saved memory item.

project
The project or workspace this memory belongs to.

source_app
Which client created it: claude, codex, openclaw, manual, or other.

source_session_id
The originating client session ID, if available.

memory_type
The category of memory item.

subject
The main named topic. This should be specific.

summary
A concise reusable description of what the item contains.

keywords_json
Search-oriented terms extracted or provided.

tags_json
Controlled classification labels.

routine_type
The type of work this memory came from.

status
Lifecycle state.

priority
Importance of the memory.

promoted
Whether it has been promoted to long-term/canonical memory.

next_steps_json
Outstanding work or follow-up actions.

related_item_ids_json
Links to other memory items.

related_files_json
File paths or file references related to this memory.

vault_path
Where the stored representation lives inside Vault.

created_at, updated_at, last_accessed_at, access_count
Used for ranking, recency, and usage analytics.

10. Controlled values

These should be standardized from early on.

Memory types

Start with:

session
summary
decision
plan
artifact
handoff
reference
Routine types

Start with:

debugging
planning
implementation
review
testing
brainstorming
refactor
deployment
Status values

Start with:

active
resolved
draft
archived
promoted
Priority values

Start with:

low
normal
high
critical
canonical

These should be enforced by validation and UI controls, not left fully free-form.

11. Subject, keywords, and tags — the critical distinction

This is worth being explicit about.

Subject

The one main topic name.

Examples:

SwiftFlow login redirect bug
onboarding flow redesign
auth middleware decision
Keywords

Short search-friendly terms.

Examples:

login
redirect
auth
middleware
onboarding
Tags

Controlled classification labels.

Examples:

bug
backend
auth
decision
session
important

The system should not confuse these.
This distinction is central to retrieval quality.

12. The save protocol

This is the universal save behavior.

When Claude, Codex, or the human UI wants to save memory, the workflow should be:

Step 1: Decide if saving is warranted

Save when the result contains:

a significant decision
a session conclusion
a useful summary
a plan
a bug finding
implementation progress
a handoff
an artifact worth future reuse

Do not save:

trivial filler
duplicates
noise
incomplete random fragments unless intentionally kept
Step 2: Determine the project

This should be required whenever possible.

Step 3: Determine memory type

Use the controlled list.

Step 4: Determine the subject

Choose a specific main subject.

Step 5: Determine keywords

Usually 3 to 8 good keywords.

Step 6: Determine tags

Prefer controlled tags, optionally with extra semantic tags.

Step 7: Write summary

A short reusable summary.

Step 8: Add next steps if relevant

This is especially valuable for continuity.

Step 9: Determine save path

Based on project + memory type.

Step 10: Save file + register metadata

The file is stored under the Vault root. The registry is updated.

Step 11: Optional enrichment

AI can:

clean summary
improve tags
classify uncertain fields
suggest promotion
Step 12: Write log entry

Every save should be logged.

13. The recall protocol

This is the universal recall behavior.

When a fresh session starts or an agent becomes uncertain, the workflow should be:

Step 1: Read the current task or first user message

Extract:

project clues
subject clues
feature names
bug names
uncertainty signals
continuity signals
Step 2: Decide whether Vault should be queried

Triggers include:

“continue”
“last time”
“we already worked on this”
project-specific ongoing work
uncertainty about prior decisions
likely prior bugs/plans/architecture
Step 3: Search candidates

Filter by:

project
matching subject/keywords
tags
memory type
status
recency
Step 4: Rank candidates

Use deterministic ranking first:

project match
exact subject overlap
keyword overlap
tag overlap
recentness
promoted status
memory type priority
priority level
usage/access history
Step 5: Return a memory pack

Do not return everything. Return:

top summaries
top decisions
top plans
optional artifacts/references
Step 6: Let the client use it

Claude/Codex should continue with the retrieved context.

Step 7: Log the recall

Store:

who queried
what they queried
what was returned
whether AI refinement was used
later, whether it was useful
14. Recall ranking logic

Vault must be a smart filter.

A good scoring model can start like this:

project exact match: strong boost
subject exact match: strong boost
subject partial match: medium boost
keyword overlap: medium boost
controlled tag overlap: medium boost
promoted/canonical memory: strong boost
decision type: higher than raw session
summary type: higher than raw session
very recent items: recency boost
archived items: penalty unless asked
heavily accessed/used items: slight boost
critical/canonical priority: strong boost

Then return the top few.

Later, AI can refine ranking for ambiguous cases.

15. Memory layers

This is essential for long-term quality.

Vault should distinguish between:

Raw memory

Raw saved sessions and immediate outputs.

Structured memory

Clean summaries, decisions, plans, handoffs.

Promoted memory

Important distilled knowledge worth prioritizing during recall.

Canonical memory

Long-term stable project truths:

architecture decisions
important conventions
final workflows
core references

This layered approach prevents the system from becoming noisy.

16. Vault protocol layer — the missing core

This is the major addition we discovered.

This phase deserves to be treated as a first-class architecture phase.

It contains three things:

The universal Vault memory protocol

Defines:

what counts as memory
when to save
when not to save
how to structure memory
how recall should happen
Claude Vault skill

Defines Claude’s behavior around memory.

Codex Vault skill

Defines Codex’s behavior around memory.

Without this phase, the system can technically work but the quality of memory will degrade.

17. Claude skill design

Claude should be optimized for:

reasoning continuity
summaries
decisions
plans
architecture
handoffs

Claude’s Vault behavior should be:

on new sessions, inspect for continuity or uncertainty and query Vault when relevant
before major reasoning or design work, check for related decisions/plans if likely
save session summaries when useful conclusions are reached
save decisions whenever meaningful choices are made
save plans when clear implementation or strategic plans are produced
write strong summaries, clear subjects, and useful next steps

Claude should not over-save. It should prefer quality over quantity.

18. Codex skill design

Codex should be optimized for:

implementation continuity
debugging outcomes
file references
patch summaries
practical handoffs

Codex’s Vault behavior should be:

on new coding sessions, check for prior implementation notes, bug findings, decisions, or plans before editing
save useful implementation summaries
save bug-fix results
save file references and touched-file context when helpful
save next steps when work is incomplete
save handoffs that help a future coding session continue without rediscovery

Codex’s memory tends to be more execution-focused than Claude’s.

19. MCP layer design

Vault should expose tools over MCP for local use by Claude and Codex.

Recommended initial MCP tools:

vault_save_memory
vault_find_memory
vault_recall_context
vault_get_latest
vault_get_memory_detail
vault_update_memory
vault_promote_memory
vault_archive_memory
vault_suggest_save_path

Each should use structured JSON input/output and return deterministic results.

The key rule is:

skills decide; MCP executes.

20. Vault core modules

The backend should be modular from the start.

Registry module

Handles:

memory item storage
metadata updates
indexing
relations
access tracking
File operations module

Handles:

save
move
rename
archive
path generation
folder creation
Retrieval module

Handles:

filtering
ranking
memory pack assembly
candidate scoring
Rules module

Handles:

controlled values
naming rules
save validation
promotion rules
tag normalization rules
Logging module

Handles:

activity logs
errors
query logs
save logs
per-client usage
Enrichment module

Handles optional AI operations.

Integration module

Handles:

MCP service
local API
optional CLI
later OpenClaw integration
21. AI enrichment design

Vault should not depend on AI to function.

AI should be optional and used for semantic enhancement only.

Good AI enrichment tasks:

summary cleanup
tags suggestion
memory type classification when uncertain
subject refinement
next-step extraction
duplicate similarity suggestion
related-memory suggestion
promotion suggestion

A cost-effective OpenRouter model is a strong fit here.

A good rule is:

system for structure, AI for meaning.

22. Database design beyond the main table

Beyond memory_items, the app should likely include these tables.

projects
id
name
description
created_at
updated_at
tags
id
name
normalized_name
category
created_at
memory_links
id
source_item_id
target_item_id
link_type
created_at
activity_logs
id
timestamp
source_client
project
action_type
target_item_id
status
latency_ms
ai_used
message
metadata_json
settings
id
key
value_json
updated_at
optional later tables
enrichment_jobs
recall_feedback
saved_queries
file_snapshots
sessions
23. File representation

Each memory item should also be saved as a file, not only in the DB.

A good approach is Markdown with structured frontmatter or JSON + Markdown hybrid.

This keeps it:

human-readable
durable
portable
inspectable
useful outside the app if needed

So:

DB for fast retrieval and structure
files for portability and readability
24. Logging and analytics model

You specifically wanted client usage graphs and logs activity. That should absolutely be core.

Vault should track:

who saved memory
who recalled memory
what project was involved
which memory types were used
how many saves occurred over time
how many recalls occurred over time
what tags/subjects are hottest
what errors occurred
what memories are used most
how often AI enrichment ran
which client is most active
recall patterns over time

This turns Vault into an operational dashboard, not just a memory box.

25. UI vision

The UI should make Vault feel alive, not technical and cold.

The best framing is:

Chat + memory cells + visual map + analytics + settings

Main UI modes
Chat mode

A conversational interface for human interaction.

Use cases:

“What did we decide about auth?”
“Show recent SwiftFlow onboarding work”
“Summarize the last 3 sessions about login redirect”
“Save this as a decision”
Memory mode

A browsable memory cells view.

Each cell shows:

title
project
type
summary
tags
timestamp
source client
Detail mode

Shows one full memory item:

metadata
file path
summary
keywords
tags
related items
usage history
Map mode

A graph-like visualization of memory relationships.

Analytics mode

Shows client usage, project activity, saves/recalls over time, and distribution charts.

Logs mode

Shows live or historical activity logs with filters.

Settings mode

Controls:

Vault root
AI settings
tag rules
save rules
promotion rules
client integration settings
recall sensitivity
26. UI layout

A strong desktop layout could be:

Left sidebar
projects
filters
memory types
tags
clients
views
Center main panel

Switchable between:

chat
memory cells
map
analytics
logs
Right detail panel

Shows:

selected item details
metadata editor
related items
activity for selected item
Top bar
global search
quick save
quick recall
active project
sync/enrichment status
27. UI screens in detail
Screen 1: Dashboard

This is the first screen the user sees.

It should show:

total memories
saves today
recalls today
active projects
promoted memories
failed queries
recent activity feed
top clients
top projects
memory distribution
Screen 2: Chat

A conversational UI to interact with Vault.

Screen 3: Memory cells

A visual list/grid of memory items.

Screen 4: Memory detail

Rich detail for a selected item.

Screen 5: Map

Graph of relationships.

Screen 6: Activity and logs

A filterable event log:

save
recall
update
archive
enrich
error
promotion
Screen 7: Analytics

Graphs and charts.

Screen 8: Settings

Control center.

28. Graphs and analytics to include

At minimum:

Usage over time

Line graph:

saves/day
recalls/day
enrichments/day
Client usage split

Bar or donut:

Claude
Codex
OpenClaw
human UI
Memory type distribution

Bar or donut:

session
decision
plan
artifact
handoff
reference
Project activity

Bar chart:

number of memories by project
recalls by project
recent activity
Recent important memory

Small widgets/cards:

newly promoted
high-priority items
most accessed
Error / failed query metrics

Cards or chart:

failed recalls
invalid saves
missing paths
enrichment failures
29. Activity feed

A dedicated live feed is very valuable.

Examples:

Claude saved session “SwiftFlow login redirect investigation”
Codex recalled context for “auth middleware”
decision promoted to long-term memory
tag normalization merged authentication into auth
AI enrichment completed
duplicate candidate detected
failed recall query for project Talabie

This makes the system feel operational and inspectable.

30. Visual memory map

This is not mandatory for the first MVP, but it is a major phase.

The graph should show:

projects
memory items
tags or subjects
links between decisions, sessions, plans, and artifacts

Relationship types can include:

same project
same subject
same tags
linked item
decision informs plan
session led to decision
plan led to artifact

This will become one of the most impressive UI features later.

31. Product stages and roadmap

Now the most important part: what to build first, and how to scale upward.

Stage 0 — Product lock

Before building, finalize:

Vault scope
local-first decision
controlled root folder
schema rules
memory types
save and recall protocol

Output:

one written product spec
one schema spec
one protocol spec
Stage 1 — Core backend MVP

Build the minimum system without UI glamour.

Must include:

Vault root folder creation
SQLite registry
memory_items table
file save logic
file retrieval logic
simple recall filtering and ranking
logging
basic CLI/testing interface

Goal:
Save a memory item and retrieve relevant items by project + keywords.

Stage 2 — Protocol layer

Build the universal Vault protocol.

Must include:

save rules
recall rules
subject/keywords/tags rules
memory type rules
promotion rules
anti-noise rules

Goal:
Establish memory discipline before widespread use.

Stage 3 — Skills layer

Write:

Claude Vault skill
Codex Vault skill

Must include:

when to recall
when to save
how to classify
how to write structured payloads

Goal:
Make clients behave consistently.

Stage 4 — MCP layer

Expose Vault through local MCP tools.

Goal:
Claude and Codex can use Vault in real sessions.

First breakthrough:
Start a fresh Claude or Codex session, mention a past feature/bug, and get useful related memory before continuing.

Stage 5 — Basic UI MVP

Build the first desktop UI.

Must include:

dashboard
memory list/cells
item detail
simple chat
settings
activity feed

Goal:
Vault becomes usable by a human directly.

Stage 6 — AI enrichment

Add optional OpenRouter-based enrichment.

Goal:
Improve summaries, tags, and classification without changing core logic.

Stage 7 — Smart recall engine

Improve ranking and memory packs.

Add:

promoted memory weighting
better type prioritization
related-item boosts
better project handling
optional semantic refinement

Goal:
Make recall noticeably sharper.

Stage 8 — Analytics and logs expansion

Add:

usage graphs
client usage
project activity
error metrics
detailed logs screen

Goal:
Turn Vault into an inspectable operating dashboard.

Stage 9 — Memory structure upgrade

Add:

tag normalization
canonical memory
related-item editing
manual promotion/demotion
richer metadata controls

Goal:
Long-term memory quality.

Stage 10 — Visual map

Add:

graph view
node exploration
filters
relationship editing

Goal:
Human understanding and memory exploration.

Stage 11 — Automation and maintenance

Add:

cleanup routines
stale memory archive rules
duplicate detection workflow
scheduled enrichment
promotion suggestions
optional recall feedback loop

Goal:
Vault becomes semi-self-maintaining.

Stage 12 — Company OS integration

Connect Vault to OpenClaw and the larger AI company system.

Goal:
Vault becomes the memory backbone for multi-agent workflows and company operations.

32. What to build first, exactly

If you want the shortest practical answer:

Build in this exact order:

schema
Vault root structure
save function
retrieve/recall function
logging
CLI or local test harness
Vault protocol
Claude/Codex skills
MCP server
basic desktop UI
AI enrichment
analytics
map
automation
OpenClaw/company integration

That is the cleanest order.

33. Recommended MVP scope

For the first usable version, keep it tight.

Vault v1 must do:
manage its own root folder
save memory items
register them in SQLite
retrieve top related memory by project/subject/keywords
expose local tools through MCP
support Claude and Codex skills
provide a basic desktop UI with dashboard, memory list, detail, and logs

That is enough for a real MVP.

34. What success looks like

You know Vault is working when this happens:

You open a fresh Claude or Codex session and say:

continue SwiftFlow onboarding login redirect work

And instead of starting blind, the system can immediately surface:

the last session summary
the related decision note
the latest implementation plan
perhaps the related artifact or file references

Then the new session continues naturally.

That is the product’s first true magic moment.

35. Long-term best version

The best version of Vault eventually becomes:

a local-first memory operating system
a human-readable AI memory workspace
a reliable context engine for coding agents
a visual memory graph
a usage and activity dashboard
a multi-agent memory backbone
the memory core of your future AI company OS
36. Final one-paragraph summary

Vault is a local-first memory operating system that gives Claude, Codex, and humans a structured place to save and recall project knowledge across sessions. It uses a deterministic registry and file system core, an explicit save/recall protocol, skill-based client behavior, MCP tools for access, optional AI enrichment for summaries and tags, and a rich desktop UI with chat, memory cells, visual maps, analytics, client usage graphs, and logs. It starts as a focused memory continuity tool and grows into the memory backbone of a larger multi-agent operating system.

37. Best next move

The right next step is not more brainstorming.
It is to turn this plan into the first build documents.

The most useful order is:

Vault canonical schema
Vault protocol spec
Claude skill
Codex skill
MCP tool spec
UI wireframe/spec

Start with schema first, because everything depends on it.