import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const cli='node_modules/next/dist/bin/next';
const result=spawnSync(process.execPath,[cli,'build'],{stdio:'inherit',env:{...process.env,COMMUNITY_BUILD_ONLY:'true',SESSION_SECRET:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'}});
process.exit(result.status||0);
