import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  computeFileDiff,
  assembleContent,
  acceptAllHunks,
} from '../extension/src/diffEngine';

console.log('Running Task B Verification Suite (Agent Mode: flask config across 3+ files)...\n');

const flaskDir = path.resolve('D:\\flask');
const cliPyPath = path.join(flaskDir, 'src', 'flask', 'cli.py');
const testCliPath = path.join(flaskDir, 'tests', 'test_cli.py');
const docsCliPath = path.join(flaskDir, 'docs', 'cli.rst');
const pythonExe = path.join(flaskDir, '.venv', 'Scripts', 'python.exe');
const pytestExe = path.join(flaskDir, '.venv', 'Scripts', 'pytest.exe');

assert.ok(fs.existsSync(cliPyPath), `cli.py must exist at ${cliPyPath}`);
assert.ok(fs.existsSync(testCliPath), `test_cli.py must exist at ${testCliPath}`);
assert.ok(fs.existsSync(docsCliPath), `cli.rst must exist at ${docsCliPath}`);

const originalCliPy = fs.readFileSync(cliPyPath, 'utf-8');
const originalTestCli = fs.readFileSync(testCliPath, 'utf-8');
const originalDocsCli = fs.readFileSync(docsCliPath, 'utf-8');

const cliPyEol = originalCliPy.includes('\r\n') ? '\r\n' : '\n';
const testCliEol = originalTestCli.includes('\r\n') ? '\r\n' : '\n';
const docsCliEol = originalDocsCli.includes('\r\n') ? '\r\n' : '\n';

// ---------------------------------------------------------------------------
// Step 1: Formulate proposed edits across 3 files
// ---------------------------------------------------------------------------
console.log('Step 1: Formulating proposed edits across 3 files (cli.py, test_cli.py, docs/cli.rst)');

// 1. In src/flask/cli.py:
// Add config_command to add_default_commands and define config_command before cli = FlaskGroup(
const regOld = [
  '        if add_default_commands:',
  '            self.add_command(run_command)',
  '            self.add_command(shell_command)',
  '            self.add_command(routes_command)',
].join(cliPyEol);

const regNew = [
  '        if add_default_commands:',
  '            self.add_command(run_command)',
  '            self.add_command(shell_command)',
  '            self.add_command(routes_command)',
  '            self.add_command(config_command)',
].join(cliPyEol);

assert.ok(originalCliPy.includes(regOld), 'cli.py must contain add_default_commands block');

const configCommandDef = [
  '@click.command("config", short_help="Show the configuration for the app.")',
  '@with_appcontext',
  'def config_command() -> None:',
  '    """Print the loaded application\'s configuration as JSON, masking',
  '    the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \'***\'.',
  '    """',
  '    import json',
  '',
  '    mask_patterns = ("SECRET", "PASSWORD", "TOKEN", "KEY")',
  '    data = {}',
  '    for key, value in current_app.config.items():',
  '        if any(pat in key.upper() for pat in mask_patterns):',
  '            data[key] = "***"',
  '        else:',
  '            try:',
  '                json.dumps(value)',
  '                data[key] = value',
  '            except (TypeError, OverflowError):',
  '                data[key] = str(value)',
  '',
  '    click.echo(json.dumps(data, indent=2, sort_keys=True))',
  '',
  '',
  'cli = FlaskGroup(',
].join(cliPyEol);

const cliGroupAnchor = 'cli = FlaskGroup(';
assert.ok(originalCliPy.includes(cliGroupAnchor), 'cli.py must contain cli = FlaskGroup(');

const proposedCliPy = originalCliPy
  .replace(regOld, regNew)
  .replace(cliGroupAnchor, configCommandDef);

// 2. In tests/test_cli.py:
// Add test_config_command test
const configTestDef = [
  '',
  '',
  'def test_config_command(runner):',
  '    app = Flask(__name__)',
  '    app.config["TESTING"] = True',
  '    app.config["MY_SECRET_KEY"] = "super-secret-123"',
  '    app.config["API_TOKEN"] = "xyz-token"',
  '    app.config["USER_PASSWORD"] = "pass123"',
  '    app.config["REGULAR_KEY"] = "val"',
  '    cli = FlaskGroup(create_app=lambda: app)',
  '    result = runner.invoke(cli, ["config"])',
  '    assert result.exit_code == 0',
  '    import json',
  '    data = json.loads(result.output)',
  '    assert data["MY_SECRET_KEY"] == "***"',
  '    assert data["API_TOKEN"] == "***"',
  '    assert data["USER_PASSWORD"] == "***"',
  '    assert data["REGULAR_KEY"] == "***"',
  '    assert data["TESTING"] is True',
].join(testCliEol);

const proposedTestCli = originalTestCli + configTestDef + testCliEol;

// 3. In docs/cli.rst:
// Add documentation section for flask config
const shellDocTarget = [
  '    $ flask shell',
  '    Python 3.10.0 (default, Oct 27 2021, 06:59:51) [GCC 11.1.0] on linux',
  '    App: example [production]',
  '    Instance: /home/david/Projects/pallets/flask/instance',
  '    >>>',
].join(docsCliEol);

const configDocAddition = [
  shellDocTarget,
  '',
  '',
  'Print Configuration',
  '-------------------',
  '',
  'To print the loaded application\'s configuration as JSON, use the ``flask config``',
  'command. Sensitive values containing "SECRET", "PASSWORD", "TOKEN", or "KEY" in',
  'their name are automatically masked as ``***``.',
  '',
  '.. code-block:: console',
  '',
  '    $ flask config',
  '    {',
  '      "DEBUG": false,',
  '      "SECRET_KEY": "***",',
  '      "TESTING": false',
  '    }',
].join(docsCliEol);

assert.ok(originalDocsCli.includes(shellDocTarget), 'docs/cli.rst must contain shellDocTarget');
const proposedDocsCli = originalDocsCli.replace(shellDocTarget, configDocAddition);

// ---------------------------------------------------------------------------
// Step 2: Compute diff hunks for all 3 files
// ---------------------------------------------------------------------------
console.log('Step 2: Computing isolated Myers diff hunks for 3 files');
const diff1 = computeFileDiff('src/flask/cli.py', originalCliPy, proposedCliPy, 'Task B: cli.py');
const diff2 = computeFileDiff('tests/test_cli.py', originalTestCli, proposedTestCli, 'Task B: test_cli.py');
const diff3 = computeFileDiff('docs/cli.rst', originalDocsCli, proposedDocsCli, 'Task B: docs/cli.rst');

console.log(`  cli.py hunks: ${diff1.hunks.length}`);
console.log(`  test_cli.py hunks: ${diff2.hunks.length}`);
console.log(`  docs/cli.rst hunks: ${diff3.hunks.length}`);

assert.ok(diff1.hunks.length > 0, 'cli.py must have hunks');
assert.ok(diff2.hunks.length > 0, 'test_cli.py must have hunks');
assert.ok(diff3.hunks.length > 0, 'docs/cli.rst must have hunks');

// ---------------------------------------------------------------------------
// Step 3: Accept all hunks across all 3 files
// ---------------------------------------------------------------------------
console.log('Step 3: Accepting all hunks and generating applied content');
acceptAllHunks(diff1);
acceptAllHunks(diff2);
acceptAllHunks(diff3);

const applied1 = assembleContent(diff1, 'applied');
const applied2 = assembleContent(diff2, 'applied');
const applied3 = assembleContent(diff3, 'applied');

// ---------------------------------------------------------------------------
// Step 4: Write applied changes to disk and execute live verifications
// ---------------------------------------------------------------------------
console.log('Step 4: Writing applied changes to disk');
fs.writeFileSync(cliPyPath, applied1, 'utf-8');
fs.writeFileSync(testCliPath, applied2, 'utf-8');
fs.writeFileSync(docsCliPath, applied3, 'utf-8');

try {
  // 1. Verify git diff --stat touches at least 3 files
  console.log('\nStep 5: Verifying git diff touches 3+ files');
  const statOutput = execSync('git diff --stat', { cwd: flaskDir }).toString().trim();
  console.log(statOutput);
  assert.ok(statOutput.includes('src/flask/cli.py'), 'cli.py must be modified');
  assert.ok(statOutput.includes('tests/test_cli.py'), 'test_cli.py must be modified');
  assert.ok(statOutput.includes('docs/cli.rst'), 'docs/cli.rst must be modified');

  // 2. Verify flask --help lists config command
  console.log('\nStep 6: Verifying "flask --help" lists "config" command');
  const helpOutput = execSync(`"${pythonExe}" -m flask --help`, { cwd: flaskDir }).toString();
  assert.ok(helpOutput.includes('config'), 'flask --help must list config command');
  assert.ok(helpOutput.includes('Show the configuration for the app.'), 'flask --help must show short help');
  console.log('  ✓ "flask --help" successfully lists "config" command');

  // 3. Verify flask config prints JSON with masked secrets
  console.log('\nStep 7: Verifying "flask config" outputs masked JSON');
  const configOutput = execSync(
    `"${pythonExe}" -c "from flask import Flask; from flask.cli import FlaskGroup; from click.testing import CliRunner; app = Flask('demo'); app.config['APP_SECRET']='12345'; app.config['DB_PASSWORD']='pass'; app.config['AUTH_TOKEN']='tok'; app.config['API_KEY']='key1'; app.config['PUBLIC_NAME']='myapp'; res = CliRunner().invoke(FlaskGroup(create_app=lambda: app), ['config']); print(res.output)"`,
    { cwd: flaskDir }
  ).toString().trim();

  console.log(`  Raw Output:\n${configOutput}`);
  const parsedJson = JSON.parse(configOutput);
  assert.strictEqual(parsedJson['APP_SECRET'], '***', 'SECRET must be masked as ***');
  assert.strictEqual(parsedJson['DB_PASSWORD'], '***', 'PASSWORD must be masked as ***');
  assert.strictEqual(parsedJson['AUTH_TOKEN'], '***', 'TOKEN must be masked as ***');
  assert.strictEqual(parsedJson['API_KEY'], '***', 'KEY must be masked as ***');
  assert.strictEqual(parsedJson['PUBLIC_NAME'], 'myapp', 'PUBLIC_NAME must NOT be masked');
  console.log('  ✓ "flask config" correctly masks SECRET, PASSWORD, TOKEN, KEY as "***"');

  // 4. Verify pytest passes including new test
  console.log('\nStep 8: Running pytest tests/test_cli.py -q');
  const pytestOutput = execSync(`"${pytestExe}" tests/test_cli.py -q`, { cwd: flaskDir }).toString().trim();
  console.log(`  ✓ Pytest output: ${pytestOutput}`);
  assert.ok(pytestOutput.includes('56 passed'), '56 tests must pass (was 55)');

} finally {
  // ---------------------------------------------------------------------------
  // Step 5: Clean rollback and git status check
  // ---------------------------------------------------------------------------
  console.log('\nStep 9: Rolling back all 3 files and verifying clean git status');
  fs.writeFileSync(cliPyPath, originalCliPy, 'utf-8');
  fs.writeFileSync(testCliPath, originalTestCli, 'utf-8');
  fs.writeFileSync(docsCliPath, originalDocsCli, 'utf-8');

  const cleanStatus = execSync('git status --porcelain', { cwd: flaskDir }).toString().trim();
  assert.strictEqual(cleanStatus, '', 'Flask working tree must be 100% clean after rollback');
  console.log('  ✓ Flask git status clean after rollback.');
}

console.log('\nTask B (Agent Mode: flask config across 3+ files) verified successfully! 🚀\n');
