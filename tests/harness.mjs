// The four lines every suite needs, in one place.
//
// The crash guard is the point. These suites run top to bottom with state
// flowing between assertions, so one unexpected throw takes the rest of the
// file with it — and a bare stack trace with no summary reads like the runner
// broke rather than the code. Reverting one line of app.js was enough to prove
// it: the run died in the middle and never reached the section that was
// supposed to catch the regression.
let pass = 0, fail = 0, current = '(start)', done = false;

export function section(name) {
  current = name;
  console.log(`\n── ${name}`);
}

export function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? '✓' : '✗'} ${label}` +
      (ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)
  );
  ok ? pass++ : fail++;
  return ok;
}

/* A handler that throws leaves the UI frozen with no console anyone will read,
 * so interactions are driven through here. */
export function noThrow(label, fn) {
  try {
    fn();
    return check(label, 'ok', 'ok');
  } catch (e) {
    return check(label, `threw: ${e.message}`, 'ok');
  }
}

export function report() {
  done = true;
  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/* If the file dies before report(), say where — and still exit non-zero. */
process.on('exit', (code) => {
  if (done) return;
  console.log(`\n✗ CRASHED during “${current}” after ${pass} passing assertions`);
  console.log(`  ${fail} had already failed. Everything after this section did not run.`);
  if (code === 0) process.exitCode = 1;
});
