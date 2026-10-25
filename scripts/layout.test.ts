// What names a folder outside the type system: CI filters and commands, the root manifest, path
// literals, Tailwind sources. Each fails silently when a folder moves: a filter glob that matches
// nothing skips the pipeline, `bun test a b` passes when `a` is gone, `git diff --exit-code <stale>`
// exits 0. Everything here holds on the tree as it is, so it can land before any move it guards.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Glob, YAML } from 'bun';
import ts from 'typescript';
import {
  ownerOf,
  readManifest,
  repo,
  resolveRelative,
  SCRIPT,
  tracked,
  type Workspace,
  workspaces,
} from './workspace-graph.ts';

const files = await tracked();
const all = workspaces(files);
const ROOTS = ['packages', 'apps', 'protocol', 'tools'];
// Anywhere in a word, so `./packages/x` and `DIR=packages/x` are seen too.
const NAMES_FOLDER = new RegExp(`(^|[^A-Za-z0-9_.-])(${ROOTS.join('|')})/`);
const inWorkspaceRoot = (token: string): boolean => NAMES_FOLDER.test(token);
const plain = (word: string): string => word.replace(/^\.\//, '');
/** A tracked file, or a folder that holds one. */
const exists = (path: string): boolean => {
  const p = path.replace(/\/+$/, '');
  return files.some((f) => f === p || f.startsWith(`${p}/`));
};

interface Step {
  if?: string;
  'continue-on-error'?: boolean;
  /** The `if` of the job the step belongs to. */
  jobIf?: string;
  run?: string;
  shell?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  'continue-on-error'?: boolean;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  uses?: string;
  with?: { filters?: string };
  steps?: Step[];
}
interface Workflow {
  file: string;
  pullRequest: boolean;
  /** The `pull_request` trigger's own settings; null when it fires on every pull request. */
  pullRequestFilter: unknown;
  filter: string[];
  steps: Step[];
  jobs: Job[];
  byId: Record<string, Job>;
}

const ciDir = (dir: string): string[] => readdirSync(join(repo, dir)).map((f) => `${dir}/${f}`);
const workflows: Workflow[] = ciDir('.github/workflows').map((file) => {
  const doc = YAML.parse(readFileSync(join(repo, file), 'utf8')) as {
    on?: Record<string, unknown>;
    jobs?: Record<string, Job>;
  };
  const jobs = Object.values(doc.jobs ?? {});
  const filter = jobs.flatMap((j) =>
    j.with?.filters ? ((YAML.parse(j.with.filters) as { relevant?: string[] }).relevant ?? []) : [],
  );
  return {
    file,
    pullRequest: 'pull_request' in (doc.on ?? {}),
    pullRequestFilter: doc.on?.pull_request,
    filter,
    steps: jobs.flatMap((j) =>
      (j.steps ?? []).map((st) => ({
        ...st,
        jobIf: j.if,
        'continue-on-error': st['continue-on-error'] || j['continue-on-error'],
      })),
    ),
    jobs,
    byId: doc.jobs ?? {},
  };
});
const actionSteps: Step[] = ciDir('.github/actions').flatMap(
  (dir) =>
    (YAML.parse(readFileSync(join(repo, dir, 'action.yml'), 'utf8')) as { runs: { steps: Step[] } }).runs
      .steps,
);

/** One shell command per `&&`, `;`, `|` or line, as words with their quotes removed. */
const commands = (run: string): string[][] =>
  run
    .split(/\n|&&|;|\|/)
    .map((c) =>
      c
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/^["']?\$\(|\)+["']?$/g, '').replace(/^['"]|['"]$/g, '')),
    )
    .filter((c) => c[0]);

/** The words of a command that a supported form reads as checked-in paths. */
function pathArguments(words: string[]): string[] {
  const out: string[] = [];
  const cwd = words.indexOf('--cwd');
  if (cwd >= 0 && words[cwd + 1]) out.push(words[cwd + 1] as string);
  const [a, b] = words;
  if (a === 'bun' && b === 'test') out.push(...words.slice(2).filter((w) => !w.startsWith('-')));
  // A script and whatever it is handed: `bun <path>.ts <folder>`.
  else if (a === 'bun' && b?.endsWith('.ts'))
    out.push(...words.slice(1).filter((w) => !w.startsWith('-') && w.includes('/')));
  else if (a === 'bash' && b && !b.startsWith('$')) out.push(b);
  else if (a === 'git' && b === 'diff') out.push(...words.slice(2).filter((w) => !w.startsWith('-')));
  // `jq <filter> <file>`, alone or inside a command substitution (`x=$(jq … file)`).
  const jq = words.findIndex((w) => /(^|\()jq$/.test(w));
  if (jq >= 0) out.push(...words.slice(jq + 1).filter((w) => w.includes('/')));
  return out.map(plain);
}

/** A checked-in path must exist; a folder a command writes into need not, but its workspace must. */
function commandProblems(where: string, words: string[]): string[] {
  const read = pathArguments(words);
  const said = words.join(' ');
  const script = words[0] === 'bun' && words[1]?.endsWith('.ts') ? plain(words[1]) : undefined;
  const missing = read.filter(
    (p) => !exists(script && p !== script ? p.split('/').slice(0, 2).join('/') : p),
  );
  const unread = words.filter((w) => inWorkspaceRoot(w) && !read.includes(plain(w)));
  return [
    ...missing.map((p) => `${where}: ${p} does not exist (${said})`),
    ...unread.map((w) => `${where}: unsupported form names ${w} (${said})`),
  ];
}

function stepProblems(where: string, s: Step): string[] {
  const out = commands(s.run ?? '').flatMap((words) => commandProblems(where, words));
  const dir = s['working-directory'];
  if (dir && !exists(dir)) out.push(`${where}: working-directory ${dir} does not exist`);
  if (s.uses?.startsWith('./') && !exists(s.uses.slice(2)))
    out.push(`${where}: uses ${s.uses} does not exist`);
  // An uploaded report does not exist in a clean checkout; the workspace that writes it does.
  const uploaded = s.uses?.includes('upload-artifact') ? String(s.with?.path ?? '').split('\n') : [];
  for (const p of uploaded.map((x) => x.trim()).filter(inWorkspaceRoot)) {
    const owner = p.split('/').slice(0, 2).join('/');
    if (!exists(owner)) out.push(`${where}: artifact path ${p} is under ${owner}, which does not exist`);
  }
  return out;
}

// The one condition a gated job carries; any other `if`, on the job or the step, may be false.
const CHANGES_GATE = "needs.changes.outputs.relevant == 'true'";
const alwaysRuns = (s: Step): boolean =>
  s.if === undefined && !s['continue-on-error'] && (s.jobIf === undefined || s.jobIf === CHANGES_GATE);

/** The commands of a step that run and whose failure fails it: none after an `exit`, none before `||`. */
function gating(s: Step): string[][] {
  if (!alwaysRuns(s)) return [];
  const lines = (s.run ?? '').split('\n');
  const stop = lines.findIndex((l) => /(^|;|&&)\s*exit\b/.test(l));
  return (stop < 0 ? lines : lines.slice(0, stop)).filter((l) => !l.includes('||')).flatMap(commands);
}

const testInvocations = (w: Workflow): string[][] =>
  w.steps
    .flatMap(gating)
    .filter((c) => c[0] === 'bun' && c[1] === 'test')
    .map((c) => c.slice(2).filter((x) => !x.startsWith('-')));

/** The production build, by the root script, the site's own, or the assembler itself. */
const buildsSite = (c: string[]): boolean =>
  c.join(' ') === 'bun run site:build' ||
  (c.includes('build') && c[c.indexOf('--cwd') + 1] === 'apps/site') ||
  (c[0] === 'bun' && plain(c[1] ?? '') === 'apps/site/src/assemble.ts');

/** The workspace and everything it needs in production, through `dependencies`. */
function closure(w: Workspace, seen = new Set<Workspace>()): Set<Workspace> {
  if (seen.has(w)) return seen;
  seen.add(w);
  for (const name of Object.keys(w.manifest.dependencies ?? {})) {
    const dep = all.find((x) => x.name === name);
    if (dep) closure(dep, seen);
  }
  return seen;
}
// The tests these workflows run import the portal's generated ABI and nothing else of it.
const WATCHED_NARROWLY: Record<string, string> = { 'protocol/portal': 'protocol/portal/abi/**' };

/** The whole folder, or the one listed narrower glob for a dependency. */
function covers(filter: string[], dir: string, own: boolean): boolean {
  if (filter.includes(`${dir}/**`)) return true;
  const narrow = WATCHED_NARROWLY[dir];
  return !own && narrow !== undefined && filter.includes(narrow);
}

/** Run as a whole, a workspace is watched as a whole; run file by file, those files are. */
function filterGaps(w: Workflow): string[] {
  // `bun test <paths>`, and a workspace's Vitest run, which tests the whole of it.
  const components = w.steps
    .flatMap(gating)
    .filter((c) => c.includes('test:components') && c.includes('--cwd'))
    .map((c) => c[c.indexOf('--cwd') + 1] ?? '');
  // A production build reads everything it assembles: it counts as running the whole site.
  const builds = w.steps.flatMap(gating).some(buildsSite) ? ['apps/site'] : [];
  const args = [...testInvocations(w).flat(), ...components, ...builds];
  const watched = (a: string): boolean => w.filter.some((g) => !g.startsWith('!') && new Glob(g).match(a));
  // The build's configuration is outside every workspace: the env file, the profile's record, the witnesses.
  const config =
    builds.length && !w.filter.includes('deployments/**')
      ? [`${w.file}: runs the production build, filter lacks deployments/**`]
      : [];
  const gaps = all
    .filter((ws) => args.some((a) => a === ws.dir || a.startsWith(`${ws.dir}/`)))
    .flatMap((t) => {
      const whole = args.includes(t.dir);
      const files = whole ? [] : args.filter((a) => a.startsWith(`${t.dir}/`) && !watched(a));
      const folders = [...closure(t)].filter((need) => !covers(w.filter, need.dir, whole && need === t));
      return [
        ...files.map((a) => `${w.file}: runs ${a}, which no filter glob matches`),
        ...folders.map((need) => `${w.file}: runs ${t.dir}'s tests or build, filter lacks ${need.dir}/**`),
      ];
    });
  return [...config, ...gaps];
}

/** Whether the Vitest config of the file's workspace picks the file up: an invocation alone does not. */
function vitestIncludes(f: string): boolean {
  const dir = all.find((w) => f.startsWith(`${w.dir}/`))?.dir;
  if (!dir || !exists(`${dir}/vitest.config.ts`)) return false;
  const lists = testGlobs(readFileSync(join(repo, dir, 'vitest.config.ts'), 'utf8'));
  const rel = f.slice(dir.length + 1);
  const hit = (globs: string[]): boolean => globs.some((g) => new Glob(g).match(rel));
  return lists !== undefined && hit(lists.include) && !hit(lists.exclude);
}

/** A literal list of strings, or nothing when the list is built any other way. */
function literalList(node: ts.Expression): string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const texts = node.elements.map((e) => (ts.isStringLiteralLike(e) ? e.text : undefined));
  return texts.every((t) => t !== undefined) ? (texts as string[]) : undefined;
}

/**
 * The config's `include` and `exclude`, read from the syntax tree so a commented-out list is not the
 * list. One literal `include` and at most one literal `exclude`; any other shape reads as nothing.
 */
function testGlobs(config: string): { include: string[]; exclude: string[] } | undefined {
  const tree = ts.createSourceFile('vitest.config.ts', config, ts.ScriptTarget.Latest);
  const found: Record<string, ts.Expression[]> = { include: [], exclude: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) found[node.name.getText(tree)]?.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const [include, more] = found.include ?? [];
  const [exclude, extra] = found.exclude ?? [];
  if (!include || more || extra) return undefined;
  const lists = { include: literalList(include), exclude: exclude ? literalList(exclude) : [] };
  return lists.include && lists.exclude ? { include: lists.include, exclude: lists.exclude } : undefined;
}

// The required checks are the `status` jobs. Protection reads a skipped job as passed, so each must always run,
// need every other job and hand their results unaltered to scripts/ci-status.ts, which reads a job as gated
// exactly when its workflow has a `changes` job.
const STATUS = 'status';
const statusName = (file: string): string => `${file.replace(/^.*\//, '').replace(/\.yml$/, '')}-status`;
const needsOf = (j: Job): string[] => (j.needs === undefined ? [] : [j.needs].flat());

/** What would make the verdict misread a job: a gate other than the change filter, or a failure read as success. */
function coverageProblems(w: Workflow): string[] {
  const filtered = 'changes' in w.byId;
  return Object.entries(w.byId)
    .filter(([id]) => id !== STATUS && id !== 'changes')
    .flatMap(([id, j]) => {
      const gated = j.if === CHANGES_GATE && needsOf(j).includes('changes');
      const out: string[] = [];
      if (filtered ? !gated : j.if !== undefined)
        out.push(`${w.file}: ${id} is gated by more than the change filter`);
      // A job that continues on error reports `success` when it fails.
      if (j['continue-on-error'] !== undefined && j['continue-on-error'] !== false)
        out.push(`${w.file}: ${id} continues on error`);
      return out;
    });
}

// Suites that need a network the pull-request lanes do not boot: the rig's cases run through
// `bun run rig`, the rest skip without their environment and run in the e2e workflow.
const NOT_IN_A_PR_LANE = [/^tools\/harness\/tests\//];

describe('workflows', () => {
  test('every filter glob matches a tracked file', () => {
    const dead = workflows.flatMap((w) =>
      w.filter
        .filter((g) => !g.startsWith('!') && !files.some((f) => new Glob(g).match(f)))
        .map((g) => `${w.file}: ${g}`),
    );
    expect(dead).toEqual([]);
  });

  test('every path a command names exists, in a form this guard can read', () => {
    const problems = [
      ...workflows.flatMap((w) => [
        ...w.steps.flatMap((s) => stepProblems(w.file, s)),
        ...w.jobs
          .filter((j) => j.uses?.startsWith('./') && !exists(j.uses.slice(2)))
          .map((j) => `${w.file}: uses ${j.uses}`),
      ]),
      ...actionSteps.flatMap((s) => stepProblems('.github/actions', s)),
    ];
    expect(problems).toEqual([]);
  });

  test('every test file runs in a pull-request workflow, under the runner it is written for', () => {
    const lanes = workflows.filter((w) => w.pullRequest);
    const bunArgs = lanes.flatMap(testInvocations);
    // Vitest runs through a workspace's `test:components`, or the root script over all of them.
    const vitestDirs = lanes
      .flatMap((w) => w.steps.flatMap(gating))
      .filter((c) => c.includes('test:components'))
      .map((c) => (c.includes('--cwd') ? (c[c.indexOf('--cwd') + 1] ?? '') : ''));
    const forVitest = (f: string): boolean =>
      ts
        .preProcessFile(readFileSync(join(repo, f), 'utf8'))
        .importedFiles.some((i) => i.fileName === 'vitest');
    // Bun discovers `.test.` and `.spec.` names; a folder argument does not make it run any other.
    const runs = (f: string): boolean =>
      forVitest(f)
        ? vitestDirs.some((d) => d === '' || f.startsWith(`${d}/`)) && vitestIncludes(f)
        : /[._](test|spec)\.tsx?$/.test(f) &&
          bunArgs.some((args) => args.length === 0 || args.some((a) => f.includes(a)));
    const orphans = files
      .filter((f) => /\.(test|spec|vitest)\.tsx?$/.test(f) && !NOT_IN_A_PR_LANE.some((x) => x.test(f)))
      .filter((f) => !runs(f));
    expect(orphans).toEqual([]);
  });

  test('a filter takes nothing but documentation back out', () => {
    const taken = workflows.flatMap((w) =>
      w.filter
        .filter((g) => g.startsWith('!'))
        .flatMap((g) => files.filter((f) => !f.endsWith('.md') && new Glob(g.slice(1)).match(f)).slice(0, 1))
        .map((f) => `${w.file}: an exclusion takes out ${f}`),
    );
    expect(taken).toEqual([]);
  });

  test("a workflow's filter names every workspace whose tests it runs, and what those depend on", () => {
    const gaps = workflows.filter((w) => w.filter.length).flatMap(filterGaps);
    expect([...new Set(gaps)]).toEqual([]);
  });

  test('a pull-request lane builds the production site', () => {
    const lanes = workflows.filter((w) => w.pullRequest && w.steps.flatMap(gating).some(buildsSite));
    expect(lanes.map((w) => w.file)).not.toEqual([]);
    expect(readManifest('.').scripts?.['site:build']).toBe('bun apps/site/src/assemble.ts');
  });

  test('a pull-request workflow runs on every pull request, so its status check always appears', () => {
    const filtered = workflows
      .filter((w) => w.pullRequest && w.pullRequestFilter !== null)
      .map((w) => w.file);
    expect(filtered).toEqual([]);
  });

  test('every pull-request workflow has a status job that always runs and needs every other job', () => {
    for (const w of workflows.filter((x) => x.pullRequest)) {
      const job = w.byId[STATUS];
      const others = Object.keys(w.byId).filter((id) => id !== STATUS);
      expect({ file: w.file, job: job && { ...job, needs: needsOf(job).sort() } }).toEqual({
        file: w.file,
        job: {
          name: statusName(w.file),
          needs: others.sort(),
          if: 'always()',
          'runs-on': expect.any(String),
          'timeout-minutes': expect.any(Number),
          steps: [
            { uses: expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/) },
            { uses: './.github/actions/status', with: { needs: `\${{ toJSON(needs) }}` } },
          ],
        },
      });
    }
    const status = YAML.parse(readFileSync(join(repo, '.github/actions/status/action.yml'), 'utf8')) as {
      runs: { steps: Step[] };
    };
    expect(status.runs.steps).toEqual([
      { uses: './.github/actions/setup-bun', with: { install: 'false' } },
      { shell: 'bash', run: 'bun scripts/ci-status.ts', env: { NEEDS: `\${{ inputs.needs }}` } },
    ]);
    const names = workflows.flatMap((w) => Object.values(w.byId).map((j) => j.name));
    const shared = workflows
      .filter((w) => w.pullRequest)
      .map((w) => statusName(w.file))
      .filter((n) => names.filter((x) => x === n).length !== 1);
    expect(shared).toEqual([]);
  });

  test('a job the status covers is gated by the change filter alone, or not at all, and never hides a failure', () => {
    expect(workflows.filter((w) => w.pullRequest).flatMap(coverageProblems)).toEqual([]);
  });

  test("the root's test:components reaches every workspace with a Vitest config", () => {
    const script = readManifest('.').scripts?.['test:components'] ?? '';
    const globs = [...script.matchAll(/--filter\s+(['"]?)(\S+?)\1(?=\s|$)/g)].map((m) => plain(m[2] ?? ''));
    const missed = all
      .filter((w) => exists(`${w.dir}/vitest.config.ts`))
      .filter((w) => !globs.some((g) => new Glob(g).match(w.dir)))
      .map((w) => w.dir);
    expect(script.endsWith(' test:components')).toBe(true);
    expect(globs.filter((g) => g.startsWith('!'))).toEqual([]);
    expect(missed).toEqual([]);
  });

  test("a workspace's test:components runs its whole Vitest config", () => {
    // A workspace without the script is skipped by the root's filtered run, and its specs with it.
    const narrowed = all
      .map((w) => ({ dir: w.dir, script: w.manifest.scripts?.['test:components'] }))
      .filter(
        (w) => (w.script !== undefined || exists(`${w.dir}/vitest.config.ts`)) && w.script !== 'vitest run',
      )
      .map((w) => `${w.dir}: test:components is ${JSON.stringify(w.script ?? null)}, not "vitest run"`);
    expect(narrowed).toEqual([]);
  });

  test('the toolchain lanes require the toolchain and watch its resolver', () => {
    const problems: string[] = [];
    for (const name of ['contracts', 'work-circuit', 'portal', 'harness']) {
      const w = workflows.find((x) => x.file.endsWith(`/${name}.yml`));
      const step = w?.steps.find((s) => s.run?.includes('tools/localnet/src/toolchain.test.ts'));
      if (!step) problems.push(`${name}.yml does not run tools/localnet/src/toolchain.test.ts`);
      else if (!step.env?.YACANA_REQUIRE_TOOLCHAIN)
        problems.push(`${name}.yml: the toolchain test may skip (no YACANA_REQUIRE_TOOLCHAIN)`);
      // The resolver, not only its test: a change to how the pin is read must run the lane.
      if (
        w &&
        !w.filter.some((g) => !g.startsWith('!') && new Glob(g).match('tools/localnet/src/toolchain.ts'))
      )
        problems.push(`${name}.yml: the filter does not watch tools/localnet/src/toolchain.ts`);
    }
    expect(problems).toEqual([]);
  });

  test('the header, guard and config suites run in a pull-request lane that watches their folder', () => {
    const critical = files.filter((f) => /\/(headers|node-guard|config)\.test\.ts$/.test(f));
    expect(critical.length).toBeGreaterThanOrEqual(3);
    const unwatched = critical.filter(
      (f) =>
        !workflows.some(
          (w) =>
            w.pullRequest &&
            testInvocations(w).some((args) => args.some((a) => f.includes(a))) &&
            w.filter.some((g) => !g.startsWith('!') && new Glob(g).match(f)),
        ),
    );
    expect(unwatched).toEqual([]);
  });
});

describe('the root manifest', () => {
  const root = readManifest('.') as ReturnType<typeof readManifest> & { scripts: Record<string, string> };

  test('the workspaces globs cover exactly the workspace manifests', () => {
    const globs = (root.workspaces ?? []).map((g) => new Glob(`${g}/package.json`));
    const manifests = files.filter(
      (f) => /^[^/]+\/[^/]+\/package\.json$/.test(f) && ROOTS.some((r) => f.startsWith(`${r}/`)),
    );
    expect(manifests.filter((m) => !globs.some((g) => g.match(m)))).toEqual([]);
    expect(
      (root.workspaces ?? []).filter((g) => !files.some((f) => new Glob(`${g}/package.json`).match(f))),
    ).toEqual([]);
  });

  test('every folder a script names exists', () => {
    const missing = Object.entries(root.scripts).flatMap(([name, script]) =>
      commands(script).flatMap((words) => {
        const named = [...pathArguments(words), ...words.filter(inWorkspaceRoot)];
        const filter = words.indexOf('--filter');
        const glob = filter >= 0 ? (words[filter + 1] ?? '').replace(/^\.\//, '') : '';
        const dead = glob && !all.some((w) => new Glob(glob).match(w.dir)) ? [glob] : [];
        return [...named.filter((p) => !p.includes('*') && !exists(p)), ...dead].map((p) => `${name}: ${p}`);
      }),
    );
    expect(missing).toEqual([]);
  });
});

describe('sources', () => {
  // Two segments only, and only a literal that starts with them: a constructed path is not seen
  // here, and fails loudly on its own.
  const LITERAL = new RegExp(`(['"\`])((?:${ROOTS.join('|')})/[a-z][a-z0-9-]*)(?:/[^'"\`\\n]*)?\\1`, 'g');
  // The guards' own fixtures name folders that need not exist.
  const FIXTURES = [/^scripts\/(layout|boundaries)\.test\.ts$/, /^implementations-plan\//];

  test('a path literal that starts with a workspace folder names one that exists', () => {
    const stale = files
      .filter((f) => SCRIPT.test(f) && !FIXTURES.some((x) => x.test(f)))
      .flatMap((f) =>
        [...readFileSync(join(repo, f), 'utf8').matchAll(LITERAL)]
          .filter((m) => !exists(m[2] ?? ''))
          .map((m) => `${f}: ${m[0]}`),
      );
    expect(stale).toEqual([]);
  });

  test('every Tailwind @source path exists', () => {
    const missing = files
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) =>
        [...readFileSync(join(repo, f), 'utf8').matchAll(/@source\s+["'](\.[^"']+)["']/g)]
          .filter((m) => !resolveRelative(f, m[1] ?? '') && !exists(join(dirname(f), m[1] ?? '')))
          .map((m) => `${f}: ${m[1]}`),
      );
    expect(missing).toEqual([]);
  });
});

describe('the typecheck solution', () => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  };
  /** Every project `tsc -b <cfg>` builds: the config's own root files, and the projects it references. */
  const leaves = (cfg: string): { cfg: string; files: string[] }[] => {
    const parsed = ts.getParsedCommandLineOfConfigFile(cfg, {}, host);
    if (!parsed) throw new Error(`${cfg}: unreadable`);
    const own = { cfg: relative(repo, cfg), files: parsed.fileNames.map((f) => relative(repo, f)) };
    const below = (parsed.projectReferences ?? []).flatMap((r) => leaves(ts.resolveProjectReferencePath(r)));
    return own.files.length ? [own, ...below] : below;
  };
  const root = ts.getParsedCommandLineOfConfigFile(join(repo, 'tsconfig.json'), {}, host);
  const referenced = (root?.projectReferences ?? []).map((r) => relative(repo, r.path));
  const projects = leaves(join(repo, 'tsconfig.json'));
  const typescript = files.filter((f) => /\.tsx?$/.test(f) && !f.startsWith('implementations-plan/'));
  /** The folder whose project must root the file: its workspace; `scripts` for the root scripts and root files. */
  const home = (f: string): string =>
    ownerOf(f, all)?.dir ??
    (f.startsWith('scripts/') || !f.includes('/') ? 'scripts' : (f.split('/')[0] ?? ''));
  /** The projects that may root a file: its home's, and for an app's ambient module types the app and tests projects. */
  const expectedOwners = (f: string): string[] | undefined => {
    const m = /^(apps\/[^/]+)\/src\/vite-env\.d\.ts$/.exec(f);
    return m ? [`${m[1]}/tsconfig.app.json`, `${m[1]}/tsconfig.tests.json`] : undefined;
  };

  const homes = [...new Set(typescript.map(home))];

  test('the root references every workspace with TypeScript and the root scripts, and nothing else', () => {
    expect(homes.filter((dir) => !referenced.includes(dir))).toEqual([]);
    expect(referenced.filter((dir) => !homes.includes(dir))).toEqual([]);
    expect(referenced.filter((dir) => !exists(`${dir}/tsconfig.json`))).toEqual([]);
  });

  test("every tracked TypeScript file is a root file of exactly one project, reached from its workspace's", () => {
    const owners = new Map<string, string[]>();
    for (const p of projects) for (const f of p.files) owners.set(f, [...(owners.get(f) ?? []), p.cfg]);
    // A project under the right folder is not enough: `bun run --cwd <ws> typecheck` builds what the
    // workspace's own config reaches, so the owner must be one of those.
    const reached = new Map<string, string[]>();
    for (const h of homes)
      for (const p of leaves(join(repo, h, 'tsconfig.json')))
        reached.set(p.cfg, [...(reached.get(p.cfg) ?? []), h]);
    /** Reached from the file's own home and from no other. */
    const own = (cfg: string, f: string): boolean => reached.get(cfg)?.join() === home(f);
    const off = typescript
      .filter((f) => {
        const have = (owners.get(f) ?? []).sort();
        const want = expectedOwners(f);
        if (!have.every((cfg) => own(cfg, f))) return true;
        return want ? have.join() !== want.join() : have.length !== 1;
      })
      .map((f) => `${f}: ${owners.get(f)?.join(', ') || 'no project'}`);
    expect(off).toEqual([]);
    expect([...owners.keys()].filter((f) => !files.includes(f))).toEqual([]);
  });
});
