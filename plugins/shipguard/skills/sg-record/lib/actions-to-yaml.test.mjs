import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { actionsToYaml } from './actions-to-yaml.mjs';

describe('actionsToYaml', () => {
  test('converts open action', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/notaire-chat' }];
    const yaml = actionsToYaml(actions, { name: 'test-open', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('name: "test-open"'));
    assert.ok(yaml.includes('source: recorded'));
    assert.ok(yaml.includes('action: open'));
    assert.ok(yaml.includes('url: "{base_url}/notaire-chat"'));
  });

  test('converts click action with text target', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'click', text: 'Se connecter', selector: 'button.login-btn' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-click', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: click'));
    assert.ok(yaml.includes('target: "Se connecter"'));
  });

  test('converts fill action', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'fill', text: "Nom d'utilisateur", selector: '#username', value: 'vlad' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-fill', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: fill'));
    assert.ok(yaml.includes("target: \"Nom d'utilisateur\""));
    assert.ok(yaml.includes('value: "vlad"'));
  });

  test('converts check assertion with short text', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/dashboard' },
      { type: 'check', text: 'Dossier créé', elementTag: 'span' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-check', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: assert_text'));
    assert.ok(yaml.includes('expected: "Dossier créé"'));
  });

  test('converts check assertion with long text to llm-check', () => {
    const longText = 'This is a very long dynamic text that exceeds the threshold for simple assertion and should be converted to an llm-check instead of assert_text';
    const actions = [
      { type: 'open', url: 'http://localhost:6969/dashboard' },
      { type: 'check', text: longText, elementTag: 'div' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-llm', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: llm-check'));
    assert.ok(yaml.includes('description: "Verify element content"'));
    assert.ok(yaml.includes('severity: medium'));
  });

  test('inserts screenshot after each check', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/page' },
      { type: 'check', text: 'OK', elementTag: 'span' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-screenshot', baseUrl: 'http://localhost:6969' });
    const lines = yaml.split('\n');
    const checkIdx = lines.findIndex(l => l.includes('action: assert_text'));
    const screenshotIdx = lines.findIndex((l, i) => i > checkIdx && l.includes('action: screenshot'));
    assert.ok(screenshotIdx > checkIdx, 'screenshot should follow check');
  });

  test('converts upload action with file field', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/upload' },
      { type: 'upload', selector: 'input[type=file]', files: ['doc.pdf'] },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-upload', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: upload'));
    assert.ok(yaml.includes('file: "doc.pdf"'));
    assert.ok(!yaml.includes('selector:'), 'should NOT emit selector — runner finds input via snapshot');
    assert.ok(!yaml.includes('files:'), 'should use file: (singular) not files: (array)');
  });

  test('strips base_url from open URLs', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/notaire-chat' }];
    const yaml = actionsToYaml(actions, { name: 'test-strip', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('url: "{base_url}/notaire-chat"'));
    assert.ok(!yaml.includes('localhost:6969/notaire-chat'));
  });

  test('adds trailing screenshot', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/page' },
      { type: 'click', text: 'Button', selector: 'button' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-trailing', baseUrl: 'http://localhost:6969' });
    const lines = yaml.trim().split('\n');
    assert.ok(lines[lines.length - 1].includes('screenshot') || lines[lines.length - 2].includes('screenshot'));
  });

  test('converts select action', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/form' },
      { type: 'select', text: 'Type de dossier', selector: '#type', value: 'Vente immobilière' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-select', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: select'));
    assert.ok(yaml.includes('target: "Type de dossier"'));
    assert.ok(yaml.includes('value: "Vente immobilière"'));
  });

  test('generates valid manifest header', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/' }];
    const yaml = actionsToYaml(actions, { name: 'header-test', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('name: "header-test"'));
    assert.ok(yaml.includes('source: recorded'));
    assert.ok(yaml.includes('recorded_at:'));
    assert.ok(yaml.includes('priority: medium'));
    assert.ok(yaml.includes('tags: [recorded]'));
    assert.ok(yaml.includes('steps:'));
  });
});
