import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { build } from 'esbuild';
import { format } from 'prettier';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'domains', 'telemetry', 'observation-contract.ts');
const output = path.join(root, 'docs', 'telemetry-reference.md');
const check = process.argv.includes('--check');

function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

const bundled = await build({
  entryPoints: [source],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { METRIC_COVERAGE, TELEMETRY_ATTRIBUTES, TELEMETRY_SIGNALS, validateObservationContract } =
  await import(moduleUrl);

const issues = validateObservationContract();
if (issues.length > 0) {
  throw new Error(`Telemetry observation contract is invalid:\n${issues.join('\n')}`);
}

const signalSections = ['resource', 'span', 'event', 'metric'].map((kind) => {
  const title = {
    resource: 'Resources',
    span: 'Spans',
    event: 'Events and logs',
    metric: 'Metrics',
  }[kind];
  const rows = TELEMETRY_SIGNALS.filter((item) => item.kind === kind).map((item) => [
    `\`${item.name}\``,
    item.unit ? `\`${item.unit}\`` : null,
    item.attributes.map((name) => `\`${name}\``).join('<br>'),
    item.description,
  ]);
  return `## ${title}\n\nThis section lists the public ${title.toLowerCase()} emitted by schema v1.\n\n${table(['Name', 'Unit', 'Attributes', 'Description'], rows)}`;
});

const document = `# Telemetry schema v1 reference

Use this generated reference to build SigNoz dashboards against Repoctopus's public OTLP protocol. Change the machine catalog in \`domains/telemetry/observation-contract.ts\`, then run \`npm run generate:telemetry-reference\`; don't edit this file by hand.

Field names are protocol, not deployment configuration. Configure the Collector address and authentication with standard OpenTelemetry environment variables.

${signalSections.join('\n\n')}

## Attributes

The attribute catalog defines each public field's type, source, cardinality, privacy class, and allowed values.

${table(
  ['Name', 'Type', 'Required', 'Source', 'Cardinality', 'Privacy', 'Allowed values', 'Description'],
  TELEMETRY_ATTRIBUTES.map((item) => [
    `\`${item.name}\``,
    item.type,
    item.required ? 'yes' : 'no',
    item.source,
    item.cardinality,
    item.privacy,
    item.values?.map((value) => `\`${value}\``).join('<br>') ?? null,
    item.description,
  ]),
)}

## Recommended metric coverage

Missing evidence always means \`unknown\`; it never becomes a synthetic zero. Skill outcome metrics express correlation between a consumed Skill and the same Work attempt. They don't prove that the Skill caused the result. Query ratios over one explicit time window and show the sample count beside each ratio.

${table(
  [
    'Module',
    'Metric',
    'ID',
    'Status',
    'Authoritative source',
    'Formula',
    'Missing',
    'External dependency',
  ],
  METRIC_COVERAGE.map((item) => [
    item.module,
    item.name,
    `\`${item.id}\``,
    `\`${item.status}\``,
    item.authoritativeSource,
    item.formula ? `\`${item.formula}\`` : null,
    `\`${item.missingSemantics}\``,
    item.externalDependency,
  ]),
)}

## Out-of-scope providers

The 13 out-of-scope metrics require evidence owned by another system: RAG evaluation sets, answer and fact evaluation, IDE completion and code attribution, identity directories, Rule-edit audit, or training and certification records. Add one only through a reviewed Provider that supplies durable identity, provenance, privacy bounds, and missing-data semantics. Repoctopus must not infer these metrics from workflow success.

## SigNoz query rules

Use the following formulas with one explicit time window. Deduplicate authoritative log facts by envelope ID before computing ratios whose backend query reads logs.

- Skill completion rate: divide \`repoctopus.skill.usage{repoctopus.skill.result=completed}\` by \`repoctopus.skill.usage{repoctopus.skill.result=consumed}\` in the same window and role/category group.
- Human correction rate: divide \`repoctopus.skill.result=corrected\` by \`repoctopus.skill.result=consumed\`.
- Skill error rate: divide \`repoctopus.skill.result=error\` by \`repoctopus.skill.result=consumed\`.
- Skill reuse rate: query the canonical Skill events, deduplicate by envelope ID, group consumed facts by exact Skill ID, then divide identities used more than once by all consumed identities.
- Rule hit rate: divide \`repoctopus.rule.evaluation{repoctopus.rule.result=triggered}\` by \`repoctopus.rule.evaluation{repoctopus.rule.result=expected}\`.
- Rule violation rate: divide \`repoctopus.rule.result=violated\` by evaluated receipts; don't include rules without a receipt.
- Workflow failure rate: divide failed terminal Runs by completed plus failed terminal Runs after deduplicating envelope IDs.
- Workflow reuse count: count \`repoctopus.workflow.run{repoctopus.workflow.run.result=started}\` by workflow name and version.
- Efficiency improvement: compare terminal \`repoctopus.workflow.run.duration\` distributions for the same workflow name/version and an explicit baseline window. With no compatible baseline, report \`unknown\`.

Never group Metrics by Run, Work, invocation, Skill ID, Rule ID, receipt, path, or free text. Use logs or spans to drill into those identities. Don't add field aliases, Collector Transform renames, or credentials to Resource attributes.
`;

const formatted = await format(`${document.trim()}\n`, { parser: 'markdown' });
if (check) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== formatted) {
    throw new Error(
      'docs/telemetry-reference.md is stale; run npm run generate:telemetry-reference',
    );
  }
} else {
  await writeFile(output, formatted);
}
