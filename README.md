# linkedin-scripts

Job-search tools for LinkedIn, CVbankas, CV-Online, CVMarket, CV.lt, Pinokis.com,
Work in Lithuania, and Užimtumo tarnyba. Install `linkedin_job_filter_extended.js`
in a userscript manager that supports `GM_getValue` and `GM_setValue`, then open a
job search on a supported site. Disable the previous standalone skills-highlighter
script when switching to this combined version.

## Classifieds Toolkit

Install `classifieds_toolkit.js` separately in a userscript manager that supports
`GM_getValue` and `GM_setValue`. Its portal-adapter structure is intended for
multiple classifieds sites; **Skelbiu.lt is the only implemented portal so far**,
on its search/category result pages.

The Skelbiu adapter provides promoted/normal, viewed, hidden, and contacted
filters; block lists for phrases, titles, sellers, and seller/title pairs; and
per-ad contacted/hidden controls. “Contacted” is the classifieds equivalent of
the job toolkit's applied marker. A local EUR price range filter also populates
Skelbiu's native `cost_min`/`cost_max` search fields when those controls exist.
Listings without a detectable price remain visible to the local price filter.
When filters hide every result, the script can continue through Skelbiu's next
pages. Settings can be imported/exported as JSON and are stored separately from
the job toolkit's settings. Promotion and seller matching depend on markers or
seller text present in a result card; title and phrase blocking remain available
when the card does not expose a seller.

The **Classifieds tools** button opens the job toolkit-style two-column panel.
Filters, price bounds, layout controls, and list navigation are in the right
column; the selected block-list editor opens in the left column. List entries
can be added, edited, and removed there, with edits saved when focus leaves an
entry. Import/export remains available from the panel.

At viewport widths of at least 1200 px, selecting an ad keeps results on the
left and opens a details panel on the right; the results share is adjustable
separately per portal. The panel displays the original Skelbiu ad page in a
desktop-width iframe scaled to fit the pane, hiding the page header,
recommendations, and footer; the rest of the original page and its interactions
remain intact. Skill highlighting and salary highlighting are not included.
Other classifieds portals are not supported until their adapters and userscript
match entries are implemented.

The Job tools panel includes:

- Promoted, normal, viewed, hidden, applied, and blocked-list filtering.
- The applied filter also respects the saved applied checkbox on non-LinkedIn
  boards.
- “Hide hidden” also respects the saved crossed-eye marker on non-LinkedIn boards.
- Editable lists for blocked phrases, employers, employer/position pairs, and positions.
- Import or export all settings as JSON from the Job tools panel; export selects
  and copies the JSON when clipboard access is available, and import validates
  and saves it to userscript storage.
- On Pinokis, choose a preferred CV in **Import/export** settings. Supported
  browsers remember a file handle without moving or copying the file and attach
  it automatically to the direct vacancy page or selected split-view details
  when permission is available; the script never submits the application. The
  handle is stored on the Pinokis origin, is not included in JSON export, and
  may be accessible to Pinokis page scripts when browser permission is granted.
  Selecting the preferred CV is required; a separate access prompt may not
  appear if the browser grants access immediately. Browsers that cannot persist
  file handles cannot use this feature.
- On Pinokis, the successful CV-upload confirmation automatically marks the
  associated vacancy as applied, including when it appears in the selected
  split-view details.
- Skills highlighting organized in categories, with editable skills and per-skill
  colors; custom categories can be added. Right-click selected text in vacancy
  details to add it as a skill in “Other” using one of six quick-pick colors or
  a custom color.
- Salary filtering against a configurable monthly minimum, with a 10% tolerance.
  Supported currencies are compared numerically without exchange-rate conversion.
- When a minimum is set, the 90%-of-minimum floor is included in native searches
  as `min_salary` (CVbankas), `salaryFrom` with `ratePer=MONTHLY` (CV-Online),
  `search[salary]` and `search[job_salary]=3` (CVMarket and CV.lt), the nearest
  lower available `salary` tier (Pinokis.com), and `filter[salary]` (Work in
  Lithuania). Užimtumo tarnyba's app serializes
  `salaryFrom` and `salaryTypes=["MONTHLY"]` into its search state. LinkedIn uses
  local filtering.
- The “About the job” section automatically expands when a “More” button is
  available; other job-description sections stay unchanged.
- LinkedIn main-content width controls (70–140% of the viewport), centered as it
  grows, plus per-board results/details pane ratios for each supported desktop
  split-view board. The results share is adjustable from 30–70%; the details pane
  takes the remaining width.
- A 500px list editor (responsive on narrow screens) and a tools panel capped at
  1000px tall.
- Per-card actions to block an employer, an employer/position pair, a position,
  or an editable phrase prefilled with the position across supported job boards,
  plus saved applied and hidden markers on non-LinkedIn boards (LinkedIn uses its
  native applied status).
- On desktop search pages for CVbankas, CV-Online, CVMarket, CV.lt, Pinokis.com,
  and Užimtumo tarnyba, selecting a vacancy keeps results on the left and opens
  its details on the right in a viewport-height pane. Its title shows the position,
  company, location, and salary range as icon-led pills when available. Right-click
  the position or company pill for its blocking action; position and selected text
  blocks can be edited before saving. If the selected result becomes hidden by a
  filter or block, the next visible result opens automatically. The preview hides
  the board header and navigation while
  retaining skill and salary highlights in accessible
  same-origin content; cross-origin embedded content cannot be modified. Links
  in the preview open in a new tab. CV.lt previews show the vacancy description
  and keep the original apply button floating at the bottom-left. LinkedIn keeps
  its native split view; Work in Lithuania and narrower screens keep the board's
  normal navigation.

Job filters and list navigation are in the right column. Viewed, hidden, and
applied status filters are LinkedIn-specific. Blocked phrases, employers, and
positions match case-insensitively against listing text; employer and position
pairs require both values to match. Selecting a list opens its editor in the left
column; entries can be added and removed, and edits save automatically when focus
leaves an entry. When filters leave no visible results, the script follows
available next-page controls (including sequential numbered links from the current
page) until it finds results or reaches the last page.
Skills
remain organized in the original categories, and new categories and skills can be
added; each skill has an editable color. The selected editor uses the available
panel height within the 1000px panel cap; list entries use placeholder fields with
save and remove icon buttons. The salary filter uses 90% of the configured minimum as its floor and
keeps listings without a detectable salary visible in the local filter. Native
board filters can still omit listings without salary data. Pay ranges are
compared numerically in monthly amounts; currencies are not converted. Ranges
support common currency symbols or codes, comma/space-separated amounts,
`k`/`m` suffixes, and hyphen or “to” separators. Hourly, weekly, yearly, and
daily periods are converted, including ranges that repeat the period on both
endpoints. Ranges without an explicit period default to monthly; a preceding
phrase such as “monthly salary,” a trailing “per month,” and Lithuanian `mėn.`
are also recognized as monthly. Hourly `val.`, `/h`, and `per hour` rates are
converted using 160 hours per month; explicit yearly periods are converted to
monthly. The configured minimum is
compared with the numeric monthly range regardless of its currency, without
exchange-rate conversion. Examples include `$100k-$120k`, `$100,000-$120,000`,
`$100k to $120k`, and `$100,000 to $120,000`. A Lithuanian `nuo … iki … EUR` range is also recognized as
monthly. A salary range
is highlighted green in full when its upper end meets the configured minimum,
and red in full when the entire range is below it.

Settings are stored by the userscript manager on the current browser profile.
Use **Import/export** in the Job tools panel to back up all settings as JSON or
restore them; imported settings replace the current settings only after validation
and a successful save. If clipboard access is unavailable, the export remains
selected for manual copying.
