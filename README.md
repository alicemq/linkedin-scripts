# linkedin-scripts

Job-search tools for LinkedIn, CVbankas, CV-Online, CVMarket, CV.lt, Work in
Lithuania, and Užimtumo tarnyba. Install `linkedin_job_filter_extended.js` in a
userscript manager that supports `GM_getValue` and `GM_setValue`, then open a job
search on a supported site. Disable the previous standalone skills-highlighter
script when switching to this combined version.

The Job tools panel includes:

- Promoted, normal, viewed, hidden, applied, and blocked-list filtering.
- Editable lists for blocked phrases, employers, employer/position pairs, and positions.
- Skills highlighting organized in categories, with editable skills and per-skill
  colors; custom categories can be added.
- Salary filtering against a configurable monthly minimum, with a 10% tolerance.
  Supported currencies are compared numerically without exchange-rate conversion.
- When a minimum is set, the 90%-of-minimum floor is included in native searches
  as `min_salary` (CVbankas), `salaryFrom` with `ratePer=MONTHLY` (CV-Online),
  `search[salary]` and `search[job_salary]=3` (CVMarket and CV.lt), and
  `filter[salary]` (Work in Lithuania). Užimtumo tarnyba's app serializes
  `salaryFrom` and `salaryTypes=["MONTHLY"]` into its search state. LinkedIn uses
  local filtering.
- The “About the job” section automatically expands when a “More” button is
  available; other job-description sections stay unchanged.
- Main content width (70–140% of the viewport), centered as it grows, and
  job-details pane width controls on desktop layouts.
- A 500px list editor (responsive on narrow screens) and a tools panel capped at
  1000px tall.
- Per-card actions to block an employer, an employer/position pair, or a position
  across supported job boards.
- On desktop search pages for CVbankas, CV-Online, CVMarket, CV.lt, and Užimtumo
  tarnyba, selecting a vacancy keeps results on the left and opens its details on
  the right in a viewport-height pane. The UZT pane hides the site header.
  LinkedIn keeps its native split view; Work in Lithuania and narrower screens
  keep the board's normal navigation.

Job filters and list navigation are in the right column. Viewed, hidden, and
applied status filters are LinkedIn-specific. Blocked phrases, employers, and
positions match case-insensitively against listing text; employer and position
pairs require both values to match. Selecting a list opens its editor in the left
column; entries can be added, edited, and removed. Skills
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
