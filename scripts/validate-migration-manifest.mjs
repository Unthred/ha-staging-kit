#!/usr/bin/env node
/**
 * Validate migration manifest YAML against migrations/schema/migration-manifest.schema.json
 * Usage: node scripts/validate-migration-manifest.mjs <file.yaml> [file2.yaml ...]
 *
 * Requires: npm install yaml (from ha-staging-kit repo root)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

let parseYaml;
try {
  const yamlMod = require(resolve(__dirname, 'node_modules/yaml'));
  parseYaml = yamlMod.parse ?? yamlMod.default?.parse;
  if (!parseYaml) throw new Error('yaml.parse not found');
} catch {
  console.error('Missing dependency: run `npm install` in ha-staging-kit/scripts/');
  process.exit(2);
}

const SCHEMA_PATH = resolve(__dirname, '../../config-repo/migrations/schema/migration-manifest.schema.json');
const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_][a-z0-9_]*$/;
const MANIFEST_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function err(file, path, msg) {
  return `${file}${path}: ${msg}`;
}

function requireEntity(obj, key, file, path, errors) {
  const v = obj?.[key];
  if (!v || !ENTITY_ID.test(v)) errors.push(err(file, `${path}.${key}`, `invalid entity id: ${v}`));
}

function validateManifest(doc, file) {
  const errors = [];

  if (doc.apiVersion !== 'ha-staging-kit/v1')
    errors.push(err(file, '', 'apiVersion must be ha-staging-kit/v1'));
  if (doc.kind !== 'Migration') errors.push(err(file, '', 'kind must be Migration'));

  const md = doc.metadata;
  if (!md || typeof md !== 'object') errors.push(err(file, '', 'metadata required'));
  else {
    if (!md.id || !MANIFEST_ID.test(md.id)) errors.push(err(file, '.metadata.id', 'invalid kebab-case id'));
    if (!md.title || typeof md.title !== 'string') errors.push(err(file, '.metadata.title', 'required string'));
  }

  const spec = doc.spec;
  if (!spec || typeof spec !== 'object') errors.push(err(file, '', 'spec required'));
  else {
    if (!Array.isArray(spec.steps) || spec.steps.length === 0)
      errors.push(err(file, '.spec.steps', 'at least one step required'));

    for (const [i, step] of (spec.steps || []).entries()) {
      const sp = `.spec.steps[${i}]`;
      if (!step?.name) errors.push(err(file, sp, 'name required'));
      const params = step?.params || {};
      switch (step?.action) {
        case 'registry.suffix_collision_fix':
          requireEntity(params, 'expectedEntityId', file, sp + '.params', errors);
          requireEntity(params, 'suffixEntityId', file, sp + '.params', errors);
          break;
        case 'registry.rename_entity':
          requireEntity(params, 'fromEntityId', file, sp + '.params', errors);
          requireEntity(params, 'toEntityId', file, sp + '.params', errors);
          break;
        case 'registry.purge_deleted_tombstones':
          requireEntity(params, 'expectedEntityId', file, sp + '.params', errors);
          break;
        case 'config.replace_entity_id':
          requireEntity(params, 'fromEntityId', file, sp + '.params', errors);
          requireEntity(params, 'toEntityId', file, sp + '.params', errors);
          if (!Array.isArray(params.paths) || params.paths.length === 0)
            errors.push(err(file, sp + '.params.paths', 'non-empty array required'));
          break;
        default:
          errors.push(err(file, sp + '.action', `unknown action: ${step?.action}`));
      }
    }

    for (const [i, pre] of (spec.preconditions || []).entries()) {
      const pp = `.spec.preconditions[${i}]`;
      switch (pre?.type) {
        case 'entity_exists':
        case 'entity_not_exists':
        case 'entity_disabled':
          requireEntity(pre, 'entityId', file, pp, errors);
          break;
        case 'file_contains_entity':
          if (!pre.path) errors.push(err(file, pp, 'path required'));
          if (!pre.text) errors.push(err(file, pp, 'text required'));
          break;
        default:
          errors.push(err(file, pp, `unknown precondition type: ${pre?.type}`));
      }
    }
  }

  return errors;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: validate-migration-manifest.mjs <file.yaml> [...]');
    process.exit(2);
  }
  if (!existsSync(SCHEMA_PATH)) {
    console.warn(`Note: JSON Schema at ${SCHEMA_PATH} (validator uses inline rules)`);
  }

  let failed = false;
  for (const f of files) {
    const path = resolve(f);
    let doc;
    try {
      doc = parseYaml(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`${path}: YAML parse error: ${e.message}`);
      failed = true;
      continue;
    }
    const errors = validateManifest(doc, path);
    if (errors.length) {
      failed = true;
      console.error(`${path}: INVALID`);
      for (const e of errors) console.error('  -', e);
    } else {
      console.log(`${path}: OK (${doc.metadata?.id})`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
