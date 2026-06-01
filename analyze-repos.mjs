#!/usr/bin/env node
/* eslint-disable */
/**
 * analyze-repos.mjs
 *
 * Scans a directory tree of git repos and reports the user's OWN commit activity
 * over a window, with momentum measured against the preceding equal-length window.
 * Local git only — no network, no GitHub API.
 *
 * Output is human-readable text by default; pass --json for the report blob the
 * repo-digest skill embeds in template.html.
 *
 * Usage:
 *   node analyze-repos.mjs [--dir <root>]
 *                          [--days N | --month YYYY-MM | --month last-month]
 *                          [--author <email>] [--churn-min N] [--json]
 *
 * Window:
 *   default  = last 30 days (rolling), prior = the 30 days before that
 *   --days N = last N days (rolling), prior = the N days before that
 *   --month  = a calendar month, prior = the calendar month before it
 *
 * Author: only commits whose author email matches are counted ("your work").
 *   Default per repo = its `git config user.email`, then the global one.
 *   --author <email> overrides for every repo.
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
function flag(name, dflt) {
  const i = argv.indexOf(name)
  if (i === -1) return dflt
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const ROOT = flag('--dir', process.cwd())
const AS_JSON = argv.includes('--json')
const AUTHOR_OVERRIDE = flag('--author', null)
const CHURN_MIN = parseInt(flag('--churn-min', '2'), 10)
const MAX_DEPTH = parseInt(flag('--max-depth', '4'), 10)
const MONTH = flag('--month', null)
const DAYS = parseInt(flag('--days', '30'), 10)

const COMMITS_LOG_CAP = 60 // most-recent window commits kept as prose fuel per repo
const BODY_CAP = 400 // chars of commit body kept
const EPS = 2 // commit count treated as "≈ none" for momentum classification

const GLOBAL_EMAIL = (() => {
  try {
    return execFileSync('git', ['config', '--global', 'user.email'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
})()

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------
function resolveWindow() {
  if (MONTH) {
    let y, mo
    if (MONTH === 'last-month' || MONTH === true) {
      const now = new Date()
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      y = d.getFullYear()
      mo = d.getMonth()
    } else {
      const m = /^(\d{4})-(\d{2})$/.exec(MONTH)
      if (!m) {
        console.error(`bad --month: ${MONTH} (expected YYYY-MM or last-month)`)
        process.exit(1)
      }
      y = +m[1]
      mo = +m[2] - 1
    }
    const from = new Date(y, mo, 1)
    return {
      mode: 'month',
      label: `${y}-${String(mo + 1).padStart(2, '0')}`,
      from,
      to: new Date(y, mo + 1, 1),
      prior_from: new Date(y, mo - 1, 1),
      prior_to: from,
    }
  }
  const to = new Date()
  const from = new Date(to.getTime() - DAYS * 86400000)
  return {
    mode: 'days',
    label: `last${DAYS}d`,
    from,
    to,
    prior_from: new Date(from.getTime() - DAYS * 86400000),
    prior_to: from,
  }
}
const W = resolveWindow()
const FROM_T = W.from.getTime()
const TO_T = W.to.getTime()
const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------
function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function repoAuthor(repo) {
  if (AUTHOR_OVERRIDE) return AUTHOR_OVERRIDE
  const e = git(repo, ['config', 'user.email'])
  return (e && e.trim()) || GLOBAL_EMAIL || null
}

// ---------------------------------------------------------------------------
// Repo discovery: yield each dir that contains a .git, don't descend into it
// ---------------------------------------------------------------------------
function* findRepos(dir, depth) {
  if (depth > MAX_DEPTH) return
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  if (ents.some(e => e.name === '.git')) {
    yield dir
    return
  }
  for (const e of ents) {
    if (!e.isDirectory()) continue
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    yield* findRepos(path.join(dir, e.name), depth + 1)
  }
}

// ---------------------------------------------------------------------------
// Per-repo analysis
// ---------------------------------------------------------------------------
function extOf(p) {
  // strip rename arrows ("old => new", "{a => b}/x") to the resulting path
  const clean = p.replace(/\{[^}]*=>\s*([^}]*)\}/g, '$1').split(' => ').pop()
  const base = clean.split('/').pop()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null
}

function streak(sortedDays) {
  // longest run of consecutive calendar days
  let best = sortedDays.length ? 1 : 0
  let run = best
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = Date.parse(sortedDays[i - 1] + 'T00:00:00')
    const cur = Date.parse(sortedDays[i] + 'T00:00:00')
    if (Math.round((cur - prev) / 86400000) === 1) run++
    else run = 1
    if (run > best) best = run
  }
  return best
}

function analyzeRepo(repo, sink) {
  const author = repoAuthor(repo)
  const authorArgs = author ? ['--author=' + author] : []
  const range = [
    '--all',
    '--since=' + W.prior_from.toISOString(),
    '--until=' + W.to.toISOString(),
    ...authorArgs,
  ]

  // metadata pass over [prior_from, to)
  const metaRaw = git(repo, [
    'log',
    ...range,
    '--date=iso-strict',
    '--pretty=format:%H%x1f%aI%x1f%ae%x1f%s%x1f%b%x1e',
  ])
  if (!metaRaw || !metaRaw.trim()) return null // no activity in either window

  const commits = {} // hash -> record
  for (const chunk of metaRaw.split('\x1e')) {
    const c = chunk.replace(/^\n+/, '')
    if (!c.trim()) continue
    const parts = c.split('\x1f')
    const hash = parts[0]
    const date = parts[1]
    const subject = parts[3] || ''
    const body = parts.slice(4).join('\x1f') || ''
    const t = Date.parse(date)
    if (!hash || isNaN(t)) continue
    commits[hash] = { hash, date, subject, body, t, files: 0, add: 0, del: 0, paths: [] }
  }

  // numstat pass over the same range
  const numRaw = git(repo, ['log', ...range, '--numstat', '--pretty=format:%x1e%H'])
  if (numRaw) {
    for (const chunk of numRaw.split('\x1e')) {
      const lines = chunk.split('\n')
      const hash = (lines[0] || '').trim()
      const c = commits[hash]
      if (!c) continue
      for (let i = 1; i < lines.length; i++) {
        const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(lines[i])
        if (!m) continue
        const a = m[1] === '-' ? 0 : +m[1]
        const d = m[2] === '-' ? 0 : +m[2]
        c.files++
        c.add += a
        c.del += d
        c.paths.push({ path: m[3], add: a, del: d })
      }
    }
  }

  // split into window vs prior
  const win = []
  let prior = 0
  for (const c of Object.values(commits)) {
    if (c.t >= FROM_T && c.t < TO_T) win.push(c)
    else if (c.t >= W.prior_from.getTime() && c.t < FROM_T) prior++
  }
  const n = win.length
  const p = prior
  if (n === 0 && !(p > EPS)) return null // dormant / trivial residue — not worth showing

  // history strictly before the window start → distinguishes new vs revived
  const beforeRaw = git(repo, ['rev-list', '--count', ...range.slice(0, 1), ...authorArgs, '--before=' + W.from.toISOString()])
  const everBefore = beforeRaw ? parseInt(beforeRaw.trim(), 10) || 0 : 0

  // momentum
  let momentum
  if (everBefore === 0 && n > 0) momentum = 'new'
  else if (n === 0 && p > EPS) momentum = 'cooled'
  else if (p <= EPS && n > EPS) momentum = 'revived'
  else if (p > 0 && n >= 1.5 * p) momentum = 'accelerating'
  else if (p > 0 && n > 0 && n <= 0.66 * p) momentum = 'cooling'
  else momentum = 'steady'

  // lines, churn, languages, cadence — window commits only
  let added = 0
  let removed = 0
  const fileAgg = {}
  const langs = {}
  const dayCount = {}
  for (const c of win) {
    added += c.add
    removed += c.del
    const day = c.date.slice(0, 10)
    dayCount[day] = (dayCount[day] || 0) + 1
    sink.push({ day, repo: path.basename(repo), add: c.add, del: c.del })
    for (const f of c.paths) {
      const a = fileAgg[f.path] || (fileAgg[f.path] = { touches: 0, add: 0, del: 0 })
      a.touches++
      a.add += f.add
      a.del += f.del
      const ext = extOf(f.path)
      if (ext) langs[ext] = (langs[ext] || 0) + 1
    }
  }
  const hot = Object.entries(fileAgg)
    .filter(([, a]) => a.touches >= CHURN_MIN)
    .sort((x, y) => y[1].touches - x[1].touches)
  const rework = hot.reduce((s, [, a]) => s + Math.min(a.add, a.del), 0)
  const hot_files = hot
    .slice(0, 10)
    .map(([pth, a]) => ({ path: pth, touches: a.touches, add: a.add, del: a.del }))

  const days = Object.keys(dayCount).sort()
  let busiest = { date: null, commits: 0 }
  for (const d of days) if (dayCount[d] > busiest.commits) busiest = { date: d, commits: dayCount[d] }

  // shipped: tags whose creation date falls in the window
  const shipped = []
  const tagsRaw = git(repo, [
    'for-each-ref',
    '--format=%(refname:short)%x1f%(creatordate:iso-strict)',
    'refs/tags',
  ])
  if (tagsRaw) {
    for (const line of tagsRaw.split('\n')) {
      if (!line.trim()) continue
      const [tag, cd] = line.split('\x1f')
      const t = Date.parse(cd)
      if (!isNaN(t) && t >= FROM_T && t < TO_T) shipped.push({ tag, date: (cd || '').slice(0, 10) })
    }
  }

  const commits_log = win
    .slice()
    .sort((a, b) => b.t - a.t)
    .slice(0, COMMITS_LOG_CAP)
    .map(c => ({
      hash: c.hash.slice(0, 9),
      date: c.date,
      subject: c.subject,
      body: c.body.trim().slice(0, BODY_CAP),
      files: c.files,
      add: c.add,
      del: c.del,
    }))

  return {
    path: repo,
    author,
    commits: n,
    prior_commits: p,
    momentum,
    lines: { added, removed, net: added - removed },
    churn: { rework_lines: rework, hot_files },
    languages: langs,
    shipped,
    cadence: {
      active_days: days.length,
      longest_streak: streak(days),
      busiest_day: busiest,
    },
    commits_total: n,
    commits_log,
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
function buildByDay(sink) {
  const days = {}
  for (const e of sink) {
    let d = days[e.day]
    if (!d) {
      const dt = new Date(e.day + 'T00:00:00')
      d = days[e.day] = { date: e.day, dow: DOW[dt.getDay()], commits: 0, add: 0, del: 0, repos: new Set() }
    }
    d.commits++
    d.add += e.add
    d.del += e.del
    d.repos.add(e.repo)
  }
  return Object.values(days)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, dow: d.dow, commits: d.commits, add: d.add, del: d.del, repos: [...d.repos] }))
}

function main() {
  const sink = [] // {day, repo, add, del} across all active repos
  const byRepo = {}
  for (const repo of findRepos(ROOT, 0)) {
    const r = analyzeRepo(repo, sink)
    if (r) byRepo[path.basename(repo)] = r
  }

  const repos = Object.values(byRepo)
  const active = repos.filter(r => r.commits > 0)
  const langTotal = {}
  for (const r of active) for (const [k, v] of Object.entries(r.languages)) langTotal[k] = (langTotal[k] || 0) + v
  const shippedRepos = active.filter(r => r.shipped.length).map(r => path.basename(r.path))
  const allDays = {}
  let bestDay = { date: null, commits: 0 }
  for (const e of sink) allDays[e.day] = (allDays[e.day] || 0) + 1
  for (const [d, c] of Object.entries(allDays)) if (c > bestDay.commits) bestDay = { date: d, commits: c }
  const sortedDays = Object.keys(allDays).sort()

  const overall = {
    active_repos: active.length,
    new_repos: active.filter(r => r.momentum === 'new').length,
    revived_repos: active.filter(r => r.momentum === 'revived').length,
    cooled_repos: repos.filter(r => r.momentum === 'cooled').length,
    commits: active.reduce((s, r) => s + r.commits, 0),
    prior_commits: repos.reduce((s, r) => s + r.prior_commits, 0),
    lines: {
      added: active.reduce((s, r) => s + r.lines.added, 0),
      removed: active.reduce((s, r) => s + r.lines.removed, 0),
      net: active.reduce((s, r) => s + r.lines.net, 0),
    },
    churn: {
      hot_file_count: active.reduce((s, r) => s + r.churn.hot_files.length, 0),
      rework_lines: active.reduce((s, r) => s + r.churn.rework_lines, 0),
    },
    shipped: { tags: active.reduce((s, r) => s + r.shipped.length, 0), repos: shippedRepos },
    languages: langTotal,
    cadence: {
      active_days: sortedDays.length,
      longest_streak: streak(sortedDays),
      busiest_day: bestDay,
    },
  }

  const top_repos = Object.keys(byRepo).sort((a, b) => byRepo[b].commits - byRepo[a].commits)

  const out = {
    root: ROOT,
    generated_at: new Date().toISOString(),
    window: {
      mode: W.mode,
      label: W.label,
      from: ymd(W.from),
      to: ymd(W.to),
      prior_from: ymd(W.prior_from),
      prior_to: ymd(W.prior_to),
    },
    overall,
    by_repo: byRepo,
    by_day: buildByDay(sink),
    top_repos,
  }

  if (AS_JSON) {
    // escape '<' so the blob is always safe to embed in an HTML <script> tag
    // (a commit body could contain "</script>" or "<!--"); < re-parses to '<'
    process.stdout.write(JSON.stringify(out, null, 2).replace(/</g, '\\u003c') + '\n')
  } else {
    printText(out)
  }
}

function printText(out) {
  const o = out.overall
  const L = (...a) => console.log(...a)
  L()
  L(`repo-digest — ${out.root}`)
  L(`window: ${out.window.label}  ${out.window.from} → ${out.window.to}  (prior from ${out.window.prior_from})`)
  L('─'.repeat(72))
  L(
    `${o.active_repos} active repos · ${o.commits} commits (prior ${o.prior_commits}) · ` +
      `${o.new_repos} new · ${o.revived_repos} revived · ${o.cooled_repos} cooled`,
  )
  L(
    `net ${o.lines.net >= 0 ? '+' : ''}${o.lines.net} lines (+${o.lines.added}/-${o.lines.removed}) · ` +
      `rework≈${o.churn.rework_lines} · shipped ${o.shipped.tags} tags`,
  )
  L(
    `cadence: ${o.cadence.active_days} active days, longest streak ${o.cadence.longest_streak}, ` +
      `busiest ${o.cadence.busiest_day.date || '—'} (${o.cadence.busiest_day.commits})`,
  )
  L('─'.repeat(72))
  for (const name of out.top_repos) {
    const r = out.by_repo[name]
    L(
      `  ${name.padEnd(22)} ${String(r.momentum).padEnd(13)} ` +
        `${String(r.commits).padStart(4)}c (prior ${r.prior_commits}) ` +
        `net ${r.lines.net >= 0 ? '+' : ''}${r.lines.net} ` +
        `rework≈${r.churn.rework_lines}` +
        (r.shipped.length ? `  ⚑${r.shipped.map(s => s.tag).join(',')}` : ''),
    )
  }
  L()
}

main()
