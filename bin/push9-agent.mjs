#!/usr/bin/env node
const args = process.argv.slice(2);
try {
  if (args[0] === 'install-skill') {
    const values = {};
    for (let i = 1; i < args.length; i += 2) {
      if (!['--agent', '--dir'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw Error('Use install-skill --agent codex|claude [--dir skill-parent-directory].');
      values[args[i]] = args[i + 1];
    }
    const { installSkill } = await import('../src/install-skill.mjs');
    console.log('Installed: ' + await installSkill({ agent: values['--agent'], destination: values['--dir'] }));
    console.log('Configure PUSH9_TOKEN and PUSH9_TOPIC, then restart your Agent. No notification was sent.');
  } else if (args[0] === 'mcp') {
    if (args.length > 1) throw Error('Configure MCP transport through PUSH9_MCP_TRANSPORT=stdio|http.');
    const { start } = await import('../src/server.mjs');
    await start();
  } else if (args.length === 0 || args[0] === '--help') {
    console.log('push9-agent install-skill --agent codex|claude [--dir path]\npush9-agent mcp\nSee README.md for environment variables.');
  } else throw Error('Unknown command. Use --help.');
} catch {
  console.error('Push9 Agent could not start or install. Check command options, environment and destination permissions. See README.md.');
  process.exitCode = 1;
}
