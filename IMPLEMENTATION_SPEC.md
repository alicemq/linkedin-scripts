# Job Search Toolkit implementation specification

## Purpose and scope

This document describes the behavior implemented by
[`linkedin_job_filter_extended.js`](linkedin_job_filter_extended.js), reverse
engineered from source version 6.24. It is an implementation snapshot, not a
statement that every supported site or browser has been tested end to end.

The userscript adds job-list filtering, saved vacancy markers, block lists,
salary and skill highlighting, search-form salary integration, split-view
vacancy previews, automatic pagination when filters leave no results, and
settings import/export. On Pinokis, it can also remember a preferred CV file
handle and attach that file to a vacancy upload field.

The script does not submit applications. It changes pages locally in the
browser, updates native salary search controls when supported, and stores
settings through userscript-manager storage.

## Runtime and site coverage

The userscript runs at `document-end` on these URL patterns:

| Site key | Match pattern | Listing and detail support |
| --- | --- | --- |
| `linkedin` | `https://www.linkedin.com/jobs/*` | LinkedIn job cards and native split view |
| `cvbankas` | `https://www.cvbankas.lt/*` | Listing cards, salary search, split view |
| `cvonline` | `https://www.cvonline.lt/*` | Vacancy cards, salary search, split view |
| `cvmarket` | `https://www.cvmarket.lt/*` | Job cards, salary search, split view |
| `cvlt` | `https://www.cv.lt/*` | Job cards, salary search, split view |
| `pinokis` | `https://pinokis.com/*` | Job cards, salary search, split view, preferred CV |
| `workinlithuania` | `https://jobs.workinlithuania.com/*` | Job cards, salary search |
| `uzt` | `https://uzt.lt/app/laisvos-darbo-vietos*` | Job cards, salary search, split view |

Embedded executions return immediately; the top-level page is the primary
execution context. Same-origin preview documents are accessed through the
script's iframe reference. Cross-origin embedded documents cannot be modified.

The script identifies sites from `location.hostname`, discovers cards with
site-specific selectors, and uses shared functions to filter and enhance those
cards. A `MutationObserver` on the top-level body schedules processing after
page changes; processing is debounced by 120 ms. The observer does not itself
guarantee that every site's asynchronous content lifecycle is handled.

## Settings and persistence

Most settings are serialized under the userscript-manager key
`linkedinJobFilterSettings`. The manager APIs are `GM_getValue` and
`GM_setValue`. Loading and saving failures are logged; loading falls back to
defaults, while save failures are reported in the interface where applicable.

| Setting | Default | Meaning |
| --- | --- | --- |
| `activeFilter` | `SHOW_ALL` | Show all, promoted only, or normal jobs only |
| `onlyUnviewed` | `false` | Hide cards recognized as viewed, except the active card |
| `onlyUnhidden` | `false` | Hide cards marked hidden by LinkedIn or the saved hidden list |
| `onlyUnapplied` | `false` | Hide cards recognized as applied or in the saved applied list |
| `blockedPhrases` | `[]` | Case-insensitive listing-text substrings to exclude |
| `blockedEmployers` | `[]` | Employer names or listing-text substrings to exclude |
| `blockedEmployerPositions` | `[]` | Employer-and-position pairs to exclude |
| `blockedPositions` | `[]` | Position names or listing-text substrings to exclude |
| `appliedJobs` | `[]` | Saved applied vacancy keys for non-LinkedIn boards |
| `hiddenJobs` | `[]` | Saved hidden vacancy keys for non-LinkedIn boards |
| `skillsEnabled` | `true` | Enable or disable skill highlights |
| `skills` | Built-in catalog | Skill names, colors, and category IDs |
| `skillCategories` | Built-in categories | Category IDs and display labels |
| `salaryMinimum` | `0` | Configured monthly minimum; zero disables salary filtering |
| `mainWidth` | `100` | LinkedIn main-content width as a percentage of viewport width |
| `detailsWidth` | `65` | LinkedIn details-pane width as a percentage |
| `splitViewWidths` | `55%` results per split-view site | Results-pane share; detail pane uses the remainder |

Settings import accepts JSON objects up to 5,000,000 characters. It ignores
unknown keys and normalizes recognized values. Invalid JSON, non-object JSON,
or a failed storage save does not replace the persisted settings. The importer
rebuilds controls and reapplies filtering after a successful save. Export
serializes the settings object as formatted JSON, selects it, and attempts to
copy it through the Clipboard API.

The preferred Pinokis CV is separate from the settings object and JSON backup.
The userscript stores a file-system handle in IndexedDB database
`jobSearchToolkitPreferredCV`, object store `files`, record `pinokis`. It does
not copy the file contents into IndexedDB. This storage is on the Pinokis
origin, so page scripts on that origin may be able to access the stored handle.

Automatic-pagination progress is temporary and uses `sessionStorage` key
`liJobToolsEmptyResultsPagination`. An in-memory set also prevents repeated
page attempts during the current page lifecycle.

## Filtering behavior

`applyFilter()` evaluates every discovered card. A card is visible only if it
passes all applicable block, salary, status, and promoted/normal checks:

1. A card matching a block rule is hidden.
2. A card below the salary floor is hidden when a salary range is detected.
3. Optional viewed, hidden, and applied filters are applied.
4. The promoted/normal mode is applied.

Block matching normalizes whitespace and case. Phrase and position rules match
listing text by substring. Employer rules match either the extracted employer
or listing text. Employer/position rules require both values to match, either
as extracted fields or as substrings in the card text.

Promoted recognition checks LinkedIn's highlighted footer class or the terms
`promoted`, `vip`, or `premium` in card text. Viewed and applied recognition
checks the word `viewed` or `applied` in card text. LinkedIn hidden recognition
also checks its hidden-job notice text. These are text/DOM heuristics, not
board APIs.

For non-LinkedIn sites, saved applied and hidden markers are keyed by site and
the vacancy URL origin plus pathname. If no URL is available, the applied key
falls back to normalized employer and position. The visible card controls let
the user toggle these markers. LinkedIn uses its native applied state instead
of these saved markers.

The active LinkedIn card is exempt from the `onlyUnviewed` exclusion. If the
selected split-view card becomes filtered out, the script opens the next
visible card with a URL when one exists.

## Salary filtering and search integration

### Local filtering and highlighting

The salary parser recognizes currency symbols and a broad list of currency
codes, comma- or space-separated numbers, decimal separators, `k` and `m`
suffixes, and range separators `-`, en dash, em dash, `to`, and Lithuanian
`iki`. A single salary amount may also be recognized. Context such as salary,
pay, wage, income, or a salary period helps identify bare amounts as salary
values.

The local floor is 90% of the configured minimum. A detected range passes if
its upper endpoint is at least that floor. A card with no detectable salary
range remains visible. If a listing contains multiple detected ranges, any
range meeting the floor is sufficient.

Monthly conversions are numeric and do not convert currencies:

| Period | Multiplier |
| --- | ---: |
| Hourly (`hour`, `hr`, `h`, `val.`) | 160 |
| Weekly (`week`, `wk`) | 52 / 12 |
| Daily (`day`, `daily`) | 260 / 12 |
| Yearly (`year`, `yr`, `annum`, annual context) | 1 / 12 |
| Monthly or unspecified | 1 |

When enabled, detected salary text is highlighted green when its upper range
meets the configured minimum and red when it does not. The local filter uses
the lower 90% tolerance floor, while the highlight class comparison uses the
configured minimum itself.

### Native board search controls

When the minimum is greater than zero, the script updates native search fields
on form submission and handles some board-specific filter buttons. The value
sent is the floored 90%-of-minimum amount.

| Site | Native salary integration |
| --- | --- |
| CVbankas | `min_salary` |
| CV-Online | `salaryFrom` and `ratePer=MONTHLY`; the “show results” action also places these values in the URL |
| CVMarket | `search[salary]` and `search[job_salary]=3` |
| CV.lt | Creates or updates hidden `search[salary]` and `search[job_salary]=3`; preserves URL `dir` and `sort` values when missing from the form |
| Pinokis | Selects the greatest positive `salary` option no greater than the floor, unless the current selection is already at least the floor |
| Work in Lithuania | Sets the “From” control and `filter[salary]` on “Apply filters” |
| Užimtumo tarnyba | Sets `salaryFrom`, enables monthly, and disables hourly controls when those controls are found |
| LinkedIn | Local filtering only |

The native integrations depend on the expected form controls and names being
present. Missing controls are logged or cause the corresponding integration to
be skipped. Native board filters can omit listings without salary metadata even
though the local filter leaves undetected salaries visible.

## Skill highlighting and editing

The built-in skills are grouped into core languages, frameworks and APIs,
technologies, leadership, behaviors, IT management, governance, and compensation.
The default category `custom` is labeled “Other.” Users can add categories and
skills, edit skill names and colors, and remove entries.

Highlights are applied to text nodes, longest skill names first, with
case-insensitive matching and word-boundary checks against ASCII letters,
digits, and underscores. Text inside controls and userscript-owned elements is
excluded. Highlights are rebuilt when the text or skill configuration changes.

Right-clicking selected text in supported details content opens a skill menu.
The menu supports a custom color and six swatches: bright green, red, yellow,
pink, light blue, and light yellow. Saving adds the selection to “Other.”
Selection menus are installed in accessible same-origin frames.

## Vacancy cards and split view

On desktop widths of at least 1200 px, CVbankas, CV-Online, CVMarket, CV.lt,
Pinokis, and Užimtumo tarnyba use a split view. Selecting a supported listing
opens its same-origin detail URL in a right-side iframe while keeping results
visible on the left. LinkedIn retains its native split view. Work in Lithuania
and narrower viewports keep normal board navigation.

The selected vacancy is reflected in the URL hash parameter
`li-job-tools-job` and browser history. Back/forward and hash changes resync the
preview. The preview hides selected board chrome and opens its links in new
tabs. Skill and salary highlights are applied in accessible same-origin
content; cross-origin frames are not modified.

The preview title uses the extracted position, employer, location, and salary
when available. Position and employer pills expose block actions through a
context menu. Right-clicking selected title text opens a block-phrase editor.

CV.lt has additional preview styling for its description and keeps its native
apply action floating at the lower left. Preview and site styling are
selector-based and may need updates when a board changes its markup.

## Block and status actions

Each supported card receives a Job tools menu with actions to block its
employer, employer/position pair, or position, or to open an editable phrase or
position block dialog. LinkedIn's native listing overflow menu is also enhanced
when recognized. Non-LinkedIn cards receive applied and hidden checkboxes.
Changes are saved to userscript storage and filtering is reapplied.
On Pinokis, the exact successful CV-upload confirmation automatically marks
the current vacancy as applied. The vacancy is identified from a direct
vacancy URL or the selected vacancy in split view; the marker uses the same
origin-and-path key as the card checkbox and is persisted in userscript
storage.

The list editor supports adding and removing entries. Existing entries are
editable and save when focus leaves the row or the save control is activated.
Duplicate and blank values are rejected after normalized comparison.

## Empty-results pagination

When filtering leaves no visible cards, the script waits 500 ms and searches
for an enabled next-page control. It recognizes explicit `rel=next`, exact
next-page labels in several languages, pagination-contained arrows, and a
sequential numbered control. It ignores hidden and disabled controls and
cross-origin links.

Pagination progress is scoped to a base URL with common page/offset query keys
removed. The script records attempted page identities and visited URLs in
session storage to avoid repeated navigation. It follows page controls until
results appear or no new page is available. If results appear after navigation,
the first result opens in split view on supported desktop boards. Pagination
discovery is generic and is not guaranteed to match every board's markup.

## Pinokis preferred CV lifecycle

The preferred-CV UI appears in **Import/export** settings on Pinokis pages.
Choosing a file uses the File System Access API with PDF, DOC, or DOCX filters.
The script rejects empty files and files larger than 30 MiB, stores the handle
in Pinokis-origin IndexedDB, and keeps the file at its original path.

On direct vacancy pages, processing looks for
`form#cv-upload-form input[type="file"][accept*=".pdf"]`. On a Pinokis
split-view vacancy, preview enhancement runs the same check in the iframe
document. If the handle already has read permission, the script reads the file,
assigns it to the upload input, and dispatches `input` and `change` events.
It does not submit the form.

On page load, permission is checked with `queryPermission()` only; automatic
processing does not prompt for permission. If permission is not already
granted, the direct vacancy form receives an **Allow access and attach preferred
CV** button. The settings dialog also provides an action to request permission
and attach the saved CV. The access prompt may not appear when the browser
already grants access. The automatic permission fallback in the preview
document is limited by the current implementation's placement of its access
button in that document.

The picker is invoked through `unsafeWindow` to reach the page's native
`showOpenFilePicker()` method, because userscript wrappers can reject a call
with an illegal invocation. IndexedDB must support storing file-system handles,
and the browser/userscript manager must allow the picker and page-origin APIs.
If either requirement fails, the UI reports an error; a per-vacancy file picker
is not implemented as a substitute for remembering the CV.

## Layout and interface

The Job tools button opens a fixed panel. It has a list editor column and a
controls column, with settings for job filters, salary, skill highlighting,
and layout. The list editor is 500 px wide where possible; the panel is capped
at 1000 px high and switches to a column layout below 700 px.

LinkedIn layout controls adjust main content from 70% to 140% of viewport width
and details width from 50% to 85%. Split-view board controls adjust the results
share from 30% to 70%; the preview uses the remainder. Site-specific CSS
selectors adapt existing page layouts.

Dialogs and inserted controls use native buttons, fields, labels, and dialog
elements where possible. Focus outlines and forced-colors styles are included.
The source implementation has not received a full keyboard, screen-reader,
contrast, or reflow audit as part of this reverse-engineering specification.

## Known boundaries

- Site integration depends on DOM selectors and text heuristics, not stable
  board APIs. Markup changes can break extraction and controls.
- The source checks syntax, but this repository snapshot contains no automated
  test suite. Live end-to-end behavior is not established by this document.
- CV permission persistence depends on browser, userscript-manager, and origin
  storage support. File-handle access is distinct from the ordinary file input.
- CV handles are excluded from JSON export and do not migrate with exported
  settings to another browser profile or device.
- Salary values are compared numerically without currency conversion.
- Cross-origin frames cannot be enhanced by this userscript.
- The supported-site list in the metadata is broader than split-view support;
  Work in Lithuania has no custom split-view preview.
