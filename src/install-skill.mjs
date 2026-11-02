import { cp, lstat, mkdir, rename, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function installSkill({ agent, destination, userHome = homedir() }) {
  if (!['codex', 'claude'].includes(agent)) throw Error('Use --agent codex or --agent claude.');
  const base = destination ? path.resolve(destination) : agent === 'codex'
    ? path.join(userHome, '.agents', 'skills') : path.join(userHome, '.claude', 'skills');
  const target = path.join(base, 'push9-notify');
  try { await lstat(target); throw Error('Skill already exists. Review and remove the old directory before reinstalling.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(base, { recursive: true });
  const stage = await mkdtemp(path.join(base, '.push9-install-'));
  try {
    await cp(fileURLToPath(new URL('../skills/push9-notify/', import.meta.url)), path.join(stage, 'push9-notify'), { recursive: true, errorOnExist: true });
    await rename(path.join(stage, 'push9-notify'), target);
  } finally { await rm(stage, { recursive: true, force: true }); }
  return target;
}
