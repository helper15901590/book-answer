// 把数据库中已存的协议正文重置为代码里的最新版本。
//
// 背景：协议正文保存在 system_config 的 llm_config 中，后台「协议」页可编辑。
// 因此修改 src/data/initialData.ts 里的 DEFAULT_* 只对**新建的库**生效，
// 已部署的实例读的是库里存的那一份，必须靠本脚本（或后台手动粘贴）才会更新。
//
// 用法：CONFIRM_AGREEMENT_SYNC=SYNC npm run agreements:sync
import { db } from '../server/db.js';
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../src/data/initialData.js';

const current = db.getLLMConfig();
const before = current.agreements;

if (!before) {
  console.error('❌ 库中没有协议配置。请先启动一次服务完成初始化，再运行本脚本。');
  process.exit(1);
}

const alreadyLatest =
  before.userAgreementContent === DEFAULT_USER_AGREEMENT &&
  before.privacyPolicyContent === DEFAULT_PRIVACY_POLICY;

if (alreadyLatest) {
  console.log('✅ 数据库中的协议已是最新版本，无需更新。');
  db.close();
  process.exit(0);
}

if (process.env.CONFIRM_AGREEMENT_SYNC !== 'SYNC') {
  console.error('即将用代码中的版本覆盖数据库里的协议正文：');
  console.error(`  用户服务协议：${before.userAgreementContent.length} → ${DEFAULT_USER_AGREEMENT.length} 字符`);
  console.error(`  隐私政策：    ${before.privacyPolicyContent.length} → ${DEFAULT_PRIVACY_POLICY.length} 字符`);
  console.error('\n⚠️  若你曾在后台「协议」页手动改过正文，那些改动会被覆盖。');
  console.error('如需继续，请带上确认变量重跑：');
  console.error('  CONFIRM_AGREEMENT_SYNC=SYNC npm run agreements:sync');
  db.close();
  process.exit(1);
}

db.saveLLMConfig({
  ...current,
  agreements: {
    ...before,
    userAgreementContent: DEFAULT_USER_AGREEMENT,
    privacyPolicyContent: DEFAULT_PRIVACY_POLICY,
  },
});

const after = db.getLLMConfig().agreements!;
console.log('✅ 协议已更新');
console.log(`  用户服务协议：${DEFAULT_USER_AGREEMENT.length} 字符`);
console.log(`  隐私政策：    ${DEFAULT_PRIVACY_POLICY.length} 字符`);
console.log(`  生效日期：${before.updatedAt} → ${after.updatedAt}`);
db.close();
