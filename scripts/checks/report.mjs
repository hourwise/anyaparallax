#!/usr/bin/env node
/**
 * Shared reporting helpers for the check scripts.
 */
const failures = [];
const notes = [];

export function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

export function note(message) {
  notes.push(message);
}

/** In-run property walk covering nested objects and arrays. */
export function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${path}.${key}`);
      walk(child, visit, `${path}.${key}`);
    }
  }
}

/** Fail the process if any check failed; otherwise print the summary. */
export function report(successMessage) {
  if (failures.length > 0) {
    console.error(`${successMessage.split(":")[0]} FAILED with ${failures.length} problem(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(successMessage);
  for (const message of notes) {
    console.log(`Note: ${message}`);
  }
}
