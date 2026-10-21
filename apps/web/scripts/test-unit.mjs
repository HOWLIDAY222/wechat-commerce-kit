import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const names=fs.readdirSync('scripts/smoke').filter(n=>/\.test\.tsx?$/.test(n)&&!/(?:regression|integration)\.test\./.test(n));
const result=spawnSync(process.execPath,['--import','./scripts/network-guard.mjs','--import','tsx','--test',...names.map(n=>'scripts/smoke/'+n)],{stdio:'inherit',env:{...process.env,NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/merchantkit_test',COMMERCE_STORAGE:'runtime',SMS_PROVIDER:'mock',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'disabled',ENABLE_MOCK_ADMIN_LOGIN:'false',WECHAT_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_PAY_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_MINIPROGRAM_APP_ID:'qa-student-app',WECHAT_MINIPROGRAM_APP_SECRET:'fake-only',WECHAT_PAY_MCH_ID:'qa-merchant'}});
process.exit(result.status||0);
